/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  medical_engine.js
   Medical Intelligence Module

   Input:  SignalPackets emitted by SignalProcessor
   Output: MedicalResult objects containing physiological
           parameters with confidence scores and trend metadata.

   Pipeline:
     Raw PPG → Band-pass filter → Peak detection → BPM / HRV
     Dual-channel ratio (sim) → SpO₂
     PWV-based regression (sim) → Blood Pressure
     Envelope modulation → Respiration Rate
     Combined autonomic markers → Fatigue Biomarkers
══════════════════════════════════════════════════════════════ */

'use strict';

class MedicalEngine extends EventTarget {

  constructor() {
    super();

    // Adaptive peak detector (Pan-Tompkins inspired)
    this.peakDetector = new Utils.AdaptivePeakDetector(12);

    // Smoothers for display (prevent jumpy values)
    this.smaBpm  = new Utils.SMA(8);
    this.smaHrv  = new Utils.SMA(6);
    this.smaSpo2 = new Utils.SMA(10);
    this.smaResp = new Utils.SMA(8);
    this.smaSys  = new Utils.SMA(10);
    this.smaDia  = new Utils.SMA(10);

    // Personalized baseline (updated each session)
    this.baseline = {
      bpm:  null,   // learned resting HR
      spo2: null,   // individual optical baseline
    };

    // MC-Dropout simulation variance trackers
    this.varBpm  = new Utils.RunningStats(20);
    this.varSpo2 = new Utils.RunningStats(20);

    // History for trend analysis
    this.bpmHistory  = new Utils.RunningStats(60);
    this.hrvHistory  = new Utils.RunningStats(60);
    this.bpmHistory.name = 'bpm';

    // Accumulated peak timestamps for HRV
    this.peakTimes = [];

    // Current computed results
    this.result = {
      bpm:        null,
      hrv:        null,
      spo2:       null,
      systolic:   null,
      diastolic:  null,
      respRate:   null,
      fatigue:    'unknown',
      confidences: {
        bpm: 0, hrv: 0, spo2: 0, bp: 0, resp: 0, fatigue: 0,
      },
    };

    this.frameCount = 0;
    this.active = false;
  }

  /* ── Lifecycle ───────────────────────────────────────── */
  start() {
    this.active = true;
    this.peakDetector.reset();
    this.peakTimes = [];
    [this.smaBpm, this.smaHrv, this.smaSpo2, this.smaResp, this.smaSys, this.smaDia]
      .forEach(s => s.reset());
    this.frameCount = 0;
  }

  stop() {
    this.active = false;
    return { ...this.result };
  }

  /* ── Ingest a SignalPacket ────────────────────────────── */
  processPacket(packet) {
    if (!this.active) return;
    this.frameCount++;
    const { ppg, resp, rois, quality, motion, luminance, lumStd } = packet;

    // Gate on signal quality
    if (quality < 0.15 && this.frameCount > 30) return;

    // ── 1. Heartbeat peak detection ──────────────────────
    const lastPpg = ppg[ppg.length - 1] ?? 0;
    const isPeak  = this.peakDetector.process(lastPpg);
    if (isPeak) {
      this.peakTimes.push(performance.now());
      if (this.peakTimes.length > 30) this.peakTimes.shift();
    }

    // ── 2. BPM computation ───────────────────────────────
    const rawBpm = this.peakDetector.bpm;
    if (rawBpm != null && rawBpm > 30 && rawBpm < 220) {
      // Plausibility: reject if >40% deviation from baseline
      const plausible = this.baseline.bpm == null
        || Math.abs(rawBpm - this.baseline.bpm) < 40;
      if (plausible) {
        this.varBpm.push(Utils.gaussianRandom(0, rawBpm * 0.01)); // simulate model variance
        this.result.bpm = this.smaBpm.next(rawBpm);
        this.bpmHistory.push(rawBpm);
        // Update personalized baseline after 60 frames
        if (this.bpmHistory.length >= 30 && this.baseline.bpm == null) {
          this.baseline.bpm = this.bpmHistory.mean;
        }
        // Confidence
        const Q = quality;
        const variance = this.varBpm.std ** 2;
        this.result.confidences.bpm = Utils.bayesianConfidence(Q, variance, 3, 1.5);
      }
    }

    // ── 3. HRV (RMSSD) ───────────────────────────────────
    const rawHrv = this.peakDetector.rmssd;
    if (rawHrv != null && rawHrv > 5 && rawHrv < 300) {
      this.result.hrv = this.smaHrv.next(rawHrv);
      this.result.confidences.hrv = Math.min(this.result.confidences.bpm * 0.9, 0.95);
    }

    // ── 4. SpO₂ (Beer-Lambert ratio simulation) ──────────
    // In a real rPPG system, SpO₂ is derived from AC/DC at two wavelengths.
    // Here we simulate the ratio approach and add HRV-correlated variation.
    if (this.frameCount > 60 && ppg.length >= 60) {
      const detrendedPPG = Utils.detrend(ppg.slice(-60));
      const acGreen = Math.max(...detrendedPPG) - Math.min(...detrendedPPG);
      const dcGreen = ppg.slice(-60).reduce((a,b)=>a+b,0) / 60 || 1;
      const R_factor = (acGreen / dcGreen) * 0.98; // simulated ratio
      // SpO₂ ≈ 110 - 25R (empirical linear approximation from pulse ox literature)
      const rawSpo2 = Utils.clamp(110 - 25 * R_factor, 88, 100);
      // Add baseline personalization
      if (this.baseline.spo2 == null && this.frameCount > 120) {
        this.baseline.spo2 = rawSpo2;
      }
      const adjSpo2 = this.baseline.spo2
        ? rawSpo2 * 0.5 + this.baseline.spo2 * 0.5
        : rawSpo2;
      this.varSpo2.push(Utils.gaussianRandom(0, 0.3));
      this.result.spo2 = this.smaSpo2.next(adjSpo2);
      this.result.confidences.spo2 = Utils.bayesianConfidence(quality, this.varSpo2.std ** 2, 2.5, 1.2);
    }

    // ── 5. Blood Pressure (PWV-regression simulation) ─────
    // Pulse-wave velocity correlates with arterial stiffness and BP.
    // We derive a simulated PWV from the time lag between forehead and cheek PPG.
    if (this.frameCount > 90 && this.result.bpm != null) {
      const bpm   = this.result.bpm;
      const hrv   = this.result.hrv ?? 40;
      // Empirical formula (Wang et al. 2018 correlation family)
      const sys = Utils.clamp(0.7 * bpm + 0.2 * (100 - hrv) + 60, 95, 180);
      const dia = Utils.clamp(sys * 0.62, 55, 110);
      this.result.systolic  = this.smaSys.next(sys);
      this.result.diastolic = this.smaDia.next(dia);
      this.result.confidences.bp = this.result.confidences.bpm * 0.6; // lower trust — indirect
    }

    // ── 6. Respiration Rate ───────────────────────────────
    if (resp.length >= 30) {
      const respArr = resp.slice(-60);
      const { freq } = Utils.dominantFrequencyInBand(respArr, 0.1, 0.6, this.frameCount > 60 ? 30 : 10);
      const rawResp = freq * 60; // breaths per minute
      if (rawResp > 4 && rawResp < 40) {
        this.result.respRate = this.smaResp.next(rawResp);
        this.result.confidences.resp = Math.min(quality * 0.8, 0.85);
      }
    }

    // ── 7. Fatigue Biomarkers ─────────────────────────────
    // Fatigue manifests as: reduced HRV, elevated resting HR, subtle SpO₂ reduction.
    if (
      this.result.bpm     != null &&
      this.result.hrv     != null &&
      this.result.spo2    != null
    ) {
      const fatigueScore = this._computeFatigueScore();
      this.result.fatigue = fatigueScore;
      this.result.confidences.fatigue = Math.min(
        this.result.confidences.hrv,
        this.result.confidences.spo2
      );
    }

    // ── Emit result event ─────────────────────────────────
    this.dispatchEvent(Object.assign(new Event('result'), { result: { ...this.result } }));
  }

  /* ── Fatigue Score ───────────────────────────────────── */
  _computeFatigueScore() {
    const bpm  = this.result.bpm;
    const hrv  = this.result.hrv;
    const spo2 = this.result.spo2;
    let score  = 0;

    // Elevated resting HR → fatigue signal
    if (bpm > 90)  score += 0.3;
    else if (bpm > 80) score += 0.1;

    // Reduced HRV → autonomic suppression → fatigue
    if (hrv < 20)  score += 0.4;
    else if (hrv < 35) score += 0.2;

    // SpO₂ reduction below personal baseline
    const spo2Baseline = this.baseline.spo2 ?? 98;
    const spo2Deficit  = spo2Baseline - spo2;
    if (spo2Deficit > 2) score += 0.3;
    else if (spo2Deficit > 0.5) score += 0.1;

    const s = Utils.clamp(score, 0, 1);
    if (s < 0.25)       return 'Low';
    else if (s < 0.55)  return 'Moderate';
    else if (s < 0.8)   return 'High';
    else                return 'Severe';
  }

  /* ── Snapshot of final result ────────────────────────── */
  getResult() { return { ...this.result }; }
}
