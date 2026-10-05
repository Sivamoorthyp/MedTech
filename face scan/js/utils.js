/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  utils.js
   Shared mathematical, signal-processing, and timing utilities
   used across all pipeline modules.
══════════════════════════════════════════════════════════════ */

'use strict';

const Utils = (() => {

  /* ── Session ID ─────────────────────────────────────── */
  function generateSessionId() {
    const ts  = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `SES-${ts}-${rnd}`;
  }

  /* ── Clamp / Map ────────────────────────────────────── */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp  = (a, b, t)   => a + (b - a) * t;
  const mapRange = (v, inLo, inHi, outLo, outHi) =>
    outLo + ((v - inLo) / (inHi - inLo)) * (outHi - outLo);

  /* ── Running statistics ─────────────────────────────── */
  class RunningStats {
    constructor(windowSize = 60) {
      this.win  = windowSize;
      this.data = [];
    }
    push(v) {
      this.data.push(v);
      if (this.data.length > this.win) this.data.shift();
    }
    get mean() {
      if (!this.data.length) return 0;
      return this.data.reduce((a, b) => a + b, 0) / this.data.length;
    }
    get std() {
      if (this.data.length < 2) return 0;
      const m = this.mean;
      const variance = this.data.reduce((a, b) => a + (b - m) ** 2, 0) / this.data.length;
      return Math.sqrt(variance);
    }
    get last() { return this.data[this.data.length - 1] ?? 0; }
    get length() { return this.data.length; }
    clear() { this.data = []; }
  }

  /* ── Circular Buffer ────────────────────────────────── */
  class CircularBuffer {
    constructor(size) {
      this.size = size;
      this.buf  = new Float32Array(size);
      this.head = 0;
      this.count = 0;
    }
    push(v) {
      this.buf[this.head] = v;
      this.head = (this.head + 1) % this.size;
      if (this.count < this.size) this.count++;
    }
    toArray() {
      if (this.count < this.size) return Array.from(this.buf.slice(0, this.count));
      const out = [];
      for (let i = 0; i < this.size; i++) {
        out.push(this.buf[(this.head + i) % this.size]);
      }
      return out;
    }
    get length() { return this.count; }
  }

  /* ── Butterworth Band-Pass (2nd order IIR, two cascaded biquads) ─
     Coefficients pre-computed for:
       fs = 30 Hz (camera frame rate)
       lo = 0.5 Hz  (removes DC / slow illumination drift)
       hi = 4.0 Hz  (captures cardiac up to ~240 BPM)
     Using bilinear transform. Values computed analytically.
  ─────────────────────────────────────────────────────────────── */
  class ButterworthBPF {
    constructor() {
      // Biquad section 1 — high-pass stage
      this.b1 = [ 0.9360, -1.8720, 0.9360];
      this.a1 = [-1.8686,  0.8752];
      // Biquad section 2 — low-pass stage
      this.b2 = [ 0.3343,  0.6686, 0.3343];
      this.a2 = [-0.1872, -0.0603];
      // State
      this.z1 = [0, 0];
      this.z2 = [0, 0];
    }
    filter(x) {
      // Stage 1
      const w1 = x - this.a1[0] * this.z1[0] - this.a1[1] * this.z1[1];
      let y1    = this.b1[0] * w1 + this.b1[1] * this.z1[0] + this.b1[2] * this.z1[1];
      this.z1[1] = this.z1[0]; this.z1[0] = w1;
      // Stage 2
      const w2 = y1 - this.a2[0] * this.z2[0] - this.a2[1] * this.z2[1];
      let y2    = this.b2[0] * w2 + this.b2[1] * this.z2[0] + this.b2[2] * this.z2[1];
      this.z2[1] = this.z2[0]; this.z2[0] = w2;
      return y2;
    }
    reset() { this.z1 = [0,0]; this.z2 = [0,0]; }
  }

  /* ── Simple moving average (smoothing display values) ── */
  class SMA {
    constructor(n = 8) { this.n = n; this.data = []; }
    next(v) {
      this.data.push(v);
      if (this.data.length > this.n) this.data.shift();
      return this.data.reduce((a, b) => a + b, 0) / this.data.length;
    }
    reset() { this.data = []; }
  }

  /* ── Peak Detector (Pan-Tompkins inspired for PPG) ─────
     Adaptive threshold: tracks signal envelope and fires
     when signal crosses 60 % of running max amplitude.
  ─────────────────────────────────────────────────────── */
  class AdaptivePeakDetector {
    constructor(minDistSamples = 15) {
      this.minDist = minDistSamples;   // at 30 fps → ~500 ms refractory
      this.threshold = 0.5;
      this.peakAmp   = 0;
      this.lastPeak  = -minDistSamples;
      this.sampleIdx = 0;
      this.ibis      = [];             // inter-beat intervals in samples
    }
    process(v) {
      this.sampleIdx++;
      // Update running peak amplitude with fast-rise / slow-fall
      if (v > this.peakAmp) this.peakAmp = v * 0.9 + this.peakAmp * 0.1;
      else this.peakAmp = this.peakAmp * 0.998;

      this.threshold = 0.6 * this.peakAmp;

      const dist = this.sampleIdx - this.lastPeak;
      if (v > this.threshold && dist >= this.minDist) {
        if (this.lastPeak > 0) {
          this.ibis.push(dist);
          if (this.ibis.length > 20) this.ibis.shift();
        }
        this.lastPeak = this.sampleIdx;
        return true; // peak detected
      }
      return false;
    }
    get bpm() {
      if (this.ibis.length < 2) return null;
      const meanIBI = this.ibis.reduce((a, b) => a + b, 0) / this.ibis.length;
      return 60 / (meanIBI / 30); // 30 fps
    }
    get rmssd() {
      if (this.ibis.length < 3) return null;
      let sumSq = 0;
      for (let i = 1; i < this.ibis.length; i++) {
        const diff = this.ibis[i] - this.ibis[i - 1];
        sumSq += diff * diff;
      }
      const msPerSample = 1000 / 30;
      return Math.sqrt(sumSq / (this.ibis.length - 1)) * msPerSample;
    }
    reset() { this.ibis = []; this.lastPeak = -this.minDist; this.sampleIdx = 0; this.peakAmp = 0; }
  }

  /* ── FFT (power spectrum via Goertzel for specific bins) ──
     We only need a few frequency bins, not a full FFT.
     Goertzel algorithm is O(N) per target frequency — ideal.
  ─────────────────────────────────────────────────────────── */
  function goertzel(signal, targetFreq, sampleRate) {
    const N = signal.length;
    const k = Math.round((N * targetFreq) / sampleRate);
    const w = (2 * Math.PI * k) / N;
    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const coeff = 2 * cosW;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let n = 0; n < N; n++) {
      s0 = signal[n] + coeff * s1 - s2;
      s2 = s1; s1 = s0;
    }
    const real = s1 - s2 * cosW;
    const imag = s2 * sinW;
    return Math.sqrt(real * real + imag * imag) / N;
  }

  /* ── Dominant Frequency in Band ─────────────────────── */
  function dominantFrequencyInBand(signal, fLo, fHi, sampleRate) {
    let bestPower = -Infinity, bestFreq = (fLo + fHi) / 2;
    const step = 0.025; // 0.025 Hz resolution
    for (let f = fLo; f <= fHi; f += step) {
      const p = goertzel(signal, f, sampleRate);
      if (p > bestPower) { bestPower = p; bestFreq = f; }
    }
    return { freq: bestFreq, power: bestPower };
  }

  /* ── Signal Quality Score Q ─────────────────────────── */
  function signalQuality(rawSignal, sampleRate = 30) {
    if (rawSignal.length < 30) return 0;
    const cardiac = dominantFrequencyInBand(rawSignal, 0.7, 3.5, sampleRate);
    const total   = rawSignal.reduce((a, v) => a + v * v, 0) / rawSignal.length;
    if (total < 1e-10) return 0;
    return clamp(cardiac.power / Math.sqrt(total), 0, 1);
  }

  /* ── Normalize signal to [-1, 1] ────────────────────── */
  function normalize(arr) {
    const mn = Math.min(...arr), mx = Math.max(...arr);
    const range = mx - mn || 1;
    return arr.map(v => ((v - mn) / range) * 2 - 1);
  }

  /* ── Detrend (remove linear trend) ─────────────────── */
  function detrend(arr) {
    const N = arr.length;
    const xMean = (N - 1) / 2;
    const yMean = arr.reduce((a, b) => a + b, 0) / N;
    let num = 0, den = 0;
    for (let i = 0; i < N; i++) {
      num += (i - xMean) * (arr[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den ? num / den : 0;
    const intercept = yMean - slope * xMean;
    return arr.map((v, i) => v - (slope * i + intercept));
  }

  /* ── CHROM algorithm (de Haan & Jeanne 2013) ────────── */
  function chromPPG(rArr, gArr, bArr) {
    const N = rArr.length;
    const out = new Float32Array(N);
    let sigX_std = 0, sigY_std = 0;
    const xArr = new Float32Array(N);
    const yArr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      xArr[i] = 3 * rArr[i] - 2 * gArr[i];
      yArr[i] = 1.5 * rArr[i] + gArr[i] - 1.5 * bArr[i];
    }
    // Compute std
    const xMean = xArr.reduce((a, b) => a + b, 0) / N;
    const yMean = yArr.reduce((a, b) => a + b, 0) / N;
    xArr.forEach(v => sigX_std += (v - xMean) ** 2);
    yArr.forEach(v => sigY_std += (v - yMean) ** 2);
    sigX_std = Math.sqrt(sigX_std / N) || 1;
    sigY_std = Math.sqrt(sigY_std / N) || 1;
    for (let i = 0; i < N; i++) {
      out[i] = (xArr[i] / sigX_std) - (yArr[i] / sigY_std);
    }
    return Array.from(out);
  }

  /* ── Confidence from signal quality and model variance ─ */
  function bayesianConfidence(Q, modelVariance, alpha = 3, beta = 2) {
    const exponent = alpha * Q - beta * modelVariance;
    return 1 / (1 + Math.exp(-exponent));
  }

  /* ── Format BPM, SpO2, etc. display strings ─────────── */
  const fmt = {
    bpm:   v => v != null ? Math.round(v).toString()               : '—',
    spo2:  v => v != null ? v.toFixed(1)                           : '—',
    hrv:   v => v != null ? Math.round(v).toString()               : '—',
    resp:  v => v != null ? Math.round(v).toString()               : '—',
    bp:    (s, d) => s != null ? `${Math.round(s)}/${Math.round(d)}`: '—/—',
    pct:   v => v != null ? `${(v * 100).toFixed(0)}%`            : '—%',
    score: v => v != null ? Math.round(v * 100).toString()         : '—',
  };

  /* ── Timer helper ────────────────────────────────────── */
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  /* ── Gaussian random (Box-Muller) — for simulation ─── */
  function gaussianRandom(mean = 0, std = 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ── StatusLabel helper ─────────────────────────────── */
  function statusLabel(value, okRange, warnRange) {
    if (value >= okRange[0] && value <= okRange[1])   return 'ok';
    if (value >= warnRange[0] && value <= warnRange[1]) return 'warn';
    return 'alert';
  }

  /* ── Wellbeing score (0–100) ─────────────────────────── */
  function computeWellbeingScore(medicalResults, mentalResults) {
    let score = 70; // neutral baseline
    const { bpm, spo2, hrv, stressIdx } = { ...medicalResults, ...mentalResults };

    if (bpm != null) {
      if (bpm >= 60 && bpm <= 90)       score += 6;
      else if (bpm < 50 || bpm > 110)   score -= 12;
      else                               score += 2;
    }
    if (spo2 != null) {
      if (spo2 >= 97)        score += 8;
      else if (spo2 < 93)    score -= 16;
      else                   score += 2;
    }
    if (hrv != null) {
      if (hrv > 50)          score += 6;
      else if (hrv < 20)     score -= 8;
    }
    if (stressIdx != null) {
      score -= Math.round(stressIdx * 20);
    }
    return clamp(score, 0, 100);
  }

  return {
    generateSessionId,
    clamp, lerp, mapRange,
    RunningStats, CircularBuffer,
    ButterworthBPF, SMA,
    AdaptivePeakDetector,
    goertzel, dominantFrequencyInBand,
    signalQuality,
    normalize, detrend, chromPPG,
    bayesianConfidence,
    fmt, formatTime,
    gaussianRandom, statusLabel,
    computeWellbeingScore,
  };
})();
