/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  mental_engine.js
   Mental-Health Intelligence Module

   Scientific basis:
     Emotions are NOT instantaneous labels — they are evolving
     probabilistic processes driven by facial muscle activation
     (Action Units, Ekman FACS system) observed across time.

   Pipeline:
     Landmark geometry → AU activation vectors (spatial CNN sim)
     → Temporal emotion trajectory (Transformer attention sim)
     → Stress inference (probabilistic, not threshold-based)
     → Cognitive fatigue, anxiety, stability, engagement

   Model architecture simulated:
     Spatial: CNN feature extractor (represented as geometric
              descriptor extraction from 468-point landmark mesh)
     Temporal: Transformer self-attention over 30-frame window
               (represented as weighted history aggregation)
══════════════════════════════════════════════════════════════ */

'use strict';

class MentalEngine extends EventTarget {

  /* ── Construction ─────────────────────────────────────── */
  constructor() {
    super();

    // Emotion labels (Ekman 6 + neutral + contempt)
    this.EMOTIONS = ['Neutral','Happy','Sad','Angry','Fearful','Disgusted','Surprised','Contempt'];

    // Action Unit indices we track (FACS subset relevant to affect)
    // AU1=InnerBrowRaise, AU2=OuterBrowRaise, AU4=BrowLowerer,
    // AU6=CheekRaiser, AU7=LidTightener, AU12=LipCornerPuller,
    // AU17=ChinRaiser, AU20=LipStretcher, AU25=LipPart, AU26=JawDrop
    this.AU_LABELS = ['AU1','AU2','AU4','AU6','AU7','AU12','AU17','AU20','AU25','AU26'];

    // Temporal emotion history (Transformer "memory window")
    this.WINDOW = 30; // frames
    this.emotionHistory = []; // Array<{probs: Float32Array, aus: Float32Array, ts: number}>

    // Smoothing for display
    this.smaStress     = new Utils.SMA(10);
    this.smaEngagement = new Utils.SMA(8);
    this.smaAnxiety    = new Utils.SMA(10);
    this.smaStability  = new Utils.SMA(12);

    // Personalized affective baseline (neutral expression reference)
    // Learned over first 60 frames of a session
    this.affectiveBaseline = null;
    this.baselineSamples   = [];
    this.baselineLocked    = false;

    // Temporal attention weights (simulate learned attention)
    this.attentionWeights = this._buildAttentionWeights(this.WINDOW);

    // Output
    this.result = {
      dominantEmotion:     'Neutral',
      emotionProbs:        Object.fromEntries(this.EMOTIONS.map(e => [e, 0])),
      auActivations:       Object.fromEntries(this.AU_LABELS.map(a => [a, 0])),
      stressIndex:         null,
      anxietyIndex:        null,
      stabilityScore:      null,
      engagementScore:     null,
      cognitiveFatigue:    null,
      confidences: {
        stress: 0, anxiety: 0, stability: 0, engagement: 0, cognitiveFatigue: 0,
      },
    };

    this.frameCount = 0;
    this.active     = false;
    this._landmarkCache = null;
  }

  /* ── Lifecycle ───────────────────────────────────────── */
  start() {
    this.active        = true;
    this.frameCount    = 0;
    this.emotionHistory = [];
    this.baselineSamples = [];
    this.baselineLocked  = false;
    this.affectiveBaseline = null;
    [this.smaStress, this.smaEngagement, this.smaAnxiety, this.smaStability]
      .forEach(s => s.reset());
  }

  stop() {
    this.active = false;
    return { ...this.result };
  }

  /* ── External landmark input (from FaceMesh module) ─── */
  setLandmarks(landmarks) {
    // landmarks: Array<{x,y,z}> normalized [0,1] — 468 MediaPipe points
    this._landmarkCache = landmarks;
  }

  /* ── Main per-frame inference ─────────────────────────── */
  processFrame(quality = 0.8) {
    if (!this.active) return;
    this.frameCount++;

    const lm = this._landmarkCache;
    if (!lm || lm.length < 100) {
      // No face detected — inject uncertainty
      this._emitResult(quality * 0.2);
      return;
    }

    // ── STAGE 1: Spatial feature extraction (CNN sim) ────
    // Extract geometric Action Unit descriptors from landmarks.
    // Each AU is computed from distances / angles between specific
    // facial landmark indices — mirroring CNN feature map output.
    const auVec = this._extractAUsfromLandmarks(lm);

    // ── STAGE 2: Emotion probability distribution ─────────
    // Map AU activations to emotion probabilities via a
    // learned (here: rule-encoded) AU→emotion mapping table.
    // In production: this is a CNN+FC output layer.
    const rawProbs  = this._auToEmotionProbs(auVec);
    const softmax   = this._softmax(rawProbs);

    // ── STAGE 3: Temporal Reasoning (Transformer sim) ────
    // Store current frame in history window.
    this.emotionHistory.push({ probs: softmax, aus: auVec, ts: performance.now() });
    if (this.emotionHistory.length > this.WINDOW) this.emotionHistory.shift();

    // Apply attention-weighted aggregation across history
    // (simulates multi-head self-attention temporal cognition)
    const temporalProbs = this._applyTemporalAttention();

    // ── STAGE 4: Affective Baseline Learning ─────────────
    if (!this.baselineLocked && this.frameCount <= 60) {
      this.baselineSamples.push([...temporalProbs]);
      if (this.frameCount === 60) {
        this.affectiveBaseline = this._meanProbVector(this.baselineSamples);
        this.baselineLocked    = true;
      }
    }

    // ── STAGE 5: Stress as probabilistic inference ────────
    // Stress is NOT a threshold — it is the posterior probability
    // P(stressed | AU activations, emotion trajectory, deviation from baseline).
    const stressLogit  = this._deriveStress(temporalProbs, auVec);
    const rawStress    = this._sigmoid(stressLogit);
    const stressIndex  = this.smaStress.next(rawStress);

    // ── STAGE 6: Auxiliary indices ────────────────────────
    const anxietyIndex    = this.smaAnxiety.next(this._deriveAnxiety(auVec, temporalProbs));
    const stabilityScore  = this.smaStability.next(this._deriveStability());
    const engagementScore = this.smaEngagement.next(this._deriveEngagement(auVec));
    const cognitiveFatigue= this._deriveCognitiveFatigue(auVec, stressIndex);

    // ── Populate result ───────────────────────────────────
    const emProbs = {};
    this.EMOTIONS.forEach((e, i) => { emProbs[e] = temporalProbs[i] ?? 0; });
    const auActs  = {};
    this.AU_LABELS.forEach((a, i) => { auActs[a] = auVec[i] ?? 0; });

    const domIdx   = temporalProbs.indexOf(Math.max(...temporalProbs));
    const conf = Utils.clamp(quality * (0.5 + stabilityScore * 0.5), 0, 1);

    this.result = {
      dominantEmotion:  this.EMOTIONS[domIdx],
      emotionProbs:     emProbs,
      auActivations:    auActs,
      stressIndex,
      anxietyIndex,
      stabilityScore,
      engagementScore,
      cognitiveFatigue,
      confidences: {
        stress:          conf,
        anxiety:         conf * 0.9,
        stability:       conf,
        engagement:      conf * 0.85,
        cognitiveFatigue: conf * 0.8,
      },
    };

    this._emitResult(conf);
  }

  /* ── STAGE 1: AU extraction from 468 landmarks ──────── */
  _extractAUsfromLandmarks(lm) {
    // Helper: Euclidean distance between two landmark indices
    const dist = (i, j) => {
      const dx = lm[i].x - lm[j].x;
      const dy = lm[i].y - lm[j].y;
      return Math.sqrt(dx*dx + dy*dy);
    };
    // Helper: normalise by interocular distance (makes scale-invariant)
    const iod = dist(33, 263) || 0.1;
    const n   = v => v / iod;

    // AU1  — Inner Brow Raise: landmark 107↔9 vertical distance
    const au1  = Utils.clamp(n(dist(107,  9)),  0, 1);
    // AU2  — Outer Brow Raise: 70↔105
    const au2  = Utils.clamp(n(dist(70,  105)), 0, 1);
    // AU4  — Brow Lowerer: measure brow-eye proximity (225↔23)
    const au4  = Utils.clamp(1 - n(dist(225, 23)) * 2, 0, 1);
    // AU6  — Cheek Raiser: 117↔118 upward movement proxy
    const au6  = Utils.clamp(n(dist(117, 118)) * 3, 0, 1);
    // AU7  — Lid Tightener: eyelid aperture reduction
    const au7  = Utils.clamp(1 - n(dist(159, 145)) * 4, 0, 1);
    // AU12 — Lip Corner Puller (smile): corners width
    const au12 = Utils.clamp(n(dist(61,  291)) * 2 - 0.8, 0, 1);
    // AU17 — Chin Raiser: chin-lip proximity 200↔170
    const au17 = Utils.clamp(1 - n(dist(200, 170)) * 3, 0, 1);
    // AU20 — Lip Stretcher: horizontal lip width
    const au20 = Utils.clamp(n(dist(78,  308)) * 1.5 - 0.6, 0, 1);
    // AU25 — Lip Part: vertical lip opening
    const au25 = Utils.clamp(n(dist(13,  14))  * 6,  0, 1);
    // AU26 — Jaw Drop: chin distance from nose
    const au26 = Utils.clamp(n(dist(152, 1))   * 1.2 - 0.5, 0, 1);

    return [au1, au2, au4, au6, au7, au12, au17, au20, au25, au26];
  }

  /* ── STAGE 2: AU → emotion probability logits ─────────
     Rows: [Neutral, Happy, Sad, Angry, Fearful, Disgusted, Surprised, Contempt]
     Cols: AU1, AU2, AU4, AU6, AU7, AU12, AU17, AU20, AU25, AU26
     Weights from FACS literature (Ekman & Friesen, 1978; Tian et al. 2001).
  ────────────────────────────────────────────────────── */
  _auToEmotionProbs(aus) {
    const W = [
    // AU1   AU2   AU4   AU6   AU7   AU12  AU17  AU20  AU25  AU26
      [ 0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0 ], // Neutral
      [ 0.1,  0.1,  0.0,  0.9,  0.0,  1.2,  0.0,  0.0,  0.3,  0.0 ], // Happy
      [ 0.8,  0.0,  0.6,  0.0,  0.0,  0.0,  0.7,  0.2,  0.4,  0.3 ], // Sad
      [ 0.0,  0.0,  1.1,  0.0,  0.8,  0.0,  0.3,  0.6,  0.2,  0.3 ], // Angry
      [ 1.0,  1.0,  0.0,  0.0,  0.9,  0.0,  0.0,  0.8,  0.6,  0.8 ], // Fearful
      [ 0.0,  0.0,  0.4,  0.4,  0.5,  0.0,  0.8,  0.2,  0.4,  0.1 ], // Disgusted
      [ 0.8,  0.8,  0.0,  0.0,  0.3,  0.0,  0.0,  0.3,  0.8,  1.0 ], // Surprised
      [ 0.0,  0.0,  0.3,  0.5,  0.3,  0.5,  0.3,  0.0,  0.0,  0.0 ], // Contempt
    ];
    const bias = [0.4, 0.0,-0.2,-0.2,-0.3,-0.2,-0.2,-0.4]; // prior toward Neutral
    return W.map((row, e) => bias[e] + row.reduce((s, w, i) => s + w * (aus[i] ?? 0), 0));
  }

  /* ── Softmax ─────────────────────────────────────────── */
  _softmax(logits) {
    const maxL = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - maxL));
    const sum  = exps.reduce((a,b)=>a+b,0) || 1;
    return exps.map(e => e/sum);
  }

  _sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  /* ── Temporal Attention (Transformer sim) ──────────────
     Computes attention scores as recency-weighted cosine
     similarity between current frame and each past frame.
     Re-weights emotion probability history by these scores.
  ────────────────────────────────────────────────────── */
  _applyTemporalAttention() {
    if (this.emotionHistory.length === 0) return new Array(8).fill(1/8);
    const T   = this.emotionHistory.length;
    const cur = this.emotionHistory[T - 1].probs;

    // Compute attention score per past frame (dot-product attention simplified)
    const scores = this.emotionHistory.map((frame, t) => {
      const dot = frame.probs.reduce((s, p, i) => s + p * (cur[i]??0), 0);
      const recencyWeight = this.attentionWeights[T - 1 - t] ?? 0.01;
      return dot * recencyWeight;
    });

    // Softmax over scores
    const maxS = Math.max(...scores);
    const expS = scores.map(s => Math.exp(s - maxS));
    const sumS = expS.reduce((a,b)=>a+b,0) || 1;
    const attn = expS.map(e => e / sumS);

    // Weighted sum of emotion probability vectors
    const out = new Array(8).fill(0);
    this.emotionHistory.forEach((frame, t) => {
      frame.probs.forEach((p, e) => { out[e] += attn[t] * p; });
    });
    return out;
  }

  _buildAttentionWeights(size) {
    // Recency bias: exponential decay favouring recent frames
    return Array.from({length: size}, (_, i) => Math.exp(-0.08 * i));
  }

  _meanProbVector(samples) {
    const n = samples.length;
    const out = new Array(this.EMOTIONS.length).fill(0);
    samples.forEach(s => s.forEach((p,i)=>{ out[i]+=p; }));
    return out.map(v=>v/n);
  }

  /* ── Stress derivation (probabilistic inference) ────────
     Stress = P(physiologically aroused & negatively valenced)
     Sources: AU4 (brow lowerer), AU7 (lid tightener), AU20 (lip
     stretcher), temporal emotion variance, baseline deviation.
  ────────────────────────────────────────────────────── */
  _deriveStress(temporalProbs, aus) {
    const negativeEmoWeight =
      0.35 * temporalProbs[2]  // Sad
    + 0.50 * temporalProbs[3]  // Angry
    + 0.45 * temporalProbs[4]  // Fearful
    + 0.30 * temporalProbs[5]  // Disgusted
    + 0.20 * temporalProbs[7]; // Contempt

    const auArousal = 0.8 * aus[2] + 0.7 * aus[4] + 0.5 * aus[7]; // AU4, AU7, AU20

    let baselineDev = 0;
    if (this.affectiveBaseline) {
      const dev = temporalProbs.reduce((s,p,i) => s + Math.abs(p - this.affectiveBaseline[i]), 0);
      baselineDev = dev / 2; // normalised [0,1]
    }

    // Temporal variance (emotional instability amplifies stress)
    const variance = this._emotionTemporalVariance();

    return 2 * negativeEmoWeight + 1.5 * auArousal + baselineDev + 0.5 * variance - 1.0;
  }

  /* ── Anxiety: fear + uncertainty + brow activation ───── */
  _deriveAnxiety(aus, temporalProbs) {
    const fearComponent   = temporalProbs[4]; // Fearful
    const surpriseComp    = temporalProbs[6] * 0.4;
    const browComponent   = (aus[0] + aus[1]) * 0.5; // AU1 + AU2
    const lidComponent    = aus[4]; // AU7
    return Utils.clamp(fearComponent * 0.6 + surpriseComp + browComponent * 0.3 + lidComponent * 0.2, 0, 1);
  }

  /* ── Emotional Stability: inverse of temporal variance ── */
  _deriveStability() {
    const variance = this._emotionTemporalVariance();
    return Utils.clamp(1 - variance * 4, 0, 1);
  }

  /* ── Engagement: combination of eye opening, brow raise, lip activity */
  _deriveEngagement(aus) {
    const eyeOpen    = 1 - aus[4]; // inverse lid tightener
    const browRaise  = (aus[0] + aus[1]) * 0.5;
    const lipAct     = (aus[7] + aus[8]) * 0.5; // AU25 + AU26
    return Utils.clamp(0.4 * eyeOpen + 0.35 * browRaise + 0.25 * lipAct, 0, 1);
  }

  /* ── Cognitive Fatigue: sustained stress + low engagement + high AU7 */
  _deriveCognitiveFatigue(aus, stressIndex) {
    const lidTightness = aus[4];
    const lowEngagement = 1 - this.result.engagementScore ?? 0.5;
    const sustainedStress = stressIndex > 0.6 ? (stressIndex - 0.6) * 2.5 : 0;
    return Utils.clamp(0.4 * lidTightness + 0.35 * lowEngagement + 0.25 * sustainedStress, 0, 1);
  }

  /* ── Temporal variance of dominant emotion probabilities */
  _emotionTemporalVariance() {
    if (this.emotionHistory.length < 3) return 0;
    const recent = this.emotionHistory.slice(-10);
    // Variance of the max probability (dominant emotion confidence)
    const maxProbs = recent.map(f => Math.max(...f.probs));
    const mean     = maxProbs.reduce((a,b)=>a+b,0) / maxProbs.length;
    const variance = maxProbs.reduce((s,v) => s + (v - mean)**2, 0) / maxProbs.length;
    return Math.sqrt(variance);
  }

  /* ── Emit result ─────────────────────────────────────── */
  _emitResult(confidence) {
    this.dispatchEvent(Object.assign(new Event('result'), {
      result: { ...this.result, confidence },
    }));
  }

  getResult() { return { ...this.result }; }
}
