/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  signal_processor.js
   The Real-Time Signal Interpretation Controller

   Responsibility:
     • Pulls raw pixel data from each camera frame
     • Routes RGB time-series into medical and mental pipelines
     • Tracks frame timing, illumination stability, and motion
     • Outputs typed SignalPackets consumed by the engine modules
══════════════════════════════════════════════════════════════ */

'use strict';

class SignalProcessor extends EventTarget {

  constructor() {
    super();
    this.fps           = 30;          // assumed camera frame rate
    this.bufferLen     = 180;         // 6-second window at 30 fps
    this.running       = false;
    this.frameCount    = 0;
    this.lastFrameTime = 0;

    // Per-channel circular buffers for three ROIs
    this.rois = {
      forehead: this._makeROI('forehead'),
      leftCheek:  this._makeROI('leftCheek'),
      rightCheek: this._makeROI('rightCheek'),
    };

    // Motion artefact tracker
    this.prevGrayFrame = null;
    this.motionScore   = new Utils.RunningStats(30);

    // Illumination stability
    this.lumHistory    = new Utils.RunningStats(30);

    // BPF to filter live PPG signal
    this.bpf = new Utils.ButterworthBPF();

    // Combined PPG signal buffer (CHROM output)
    this.ppgBuffer = new Utils.CircularBuffer(this.bufferLen);

    // Respiration envelope buffer
    this.respBuffer = new Utils.CircularBuffer(this.bufferLen);

    // Final quality score
    this.qualityScore = 0;

    // Timing
    this._processingCanvas = document.createElement('canvas');
    this._processingCtx    = this._processingCanvas.getContext('2d', { willReadFrequently: true });
  }

  /* ── Private ────────────────────────────────────────── */
  _makeROI(name) {
    return {
      name,
      r: new Utils.CircularBuffer(180),
      g: new Utils.CircularBuffer(180),
      b: new Utils.CircularBuffer(180),
      polygon: null,   // pixel bounding box {x,y,w,h} — set externally by FaceMesh
    };
  }

  /* ── Start / Stop ────────────────────────────────────── */
  start(videoElement) {
    this.video   = videoElement;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    this._resetBuffers();
  }

  /* ── Main processing loop ────────────────────────────── */
  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => {
      const now = performance.now();
      const dt  = now - this.lastFrameTime;

      if (dt >= (1000 / this.fps) - 2) {  // within ±2 ms of target frame interval
        this._processFrame();
        this.lastFrameTime = now;
      }
      this._loop();
    });
  }

  /* ── Frame Processing ────────────────────────────────── */
  _processFrame() {
    const video = this.video;
    if (!video || video.readyState < 2) return;

    const W = video.videoWidth  || 640;
    const H = video.videoHeight || 480;
    this._processingCanvas.width  = W;
    this._processingCanvas.height = H;
    this._processingCtx.drawImage(video, 0, 0, W, H);

    this.frameCount++;

    // ── 1. Extract pixel mean per ROI ─────────────────
    for (const key of Object.keys(this.rois)) {
      const roi = this.rois[key];
      const box = roi.polygon ?? this._defaultROI(key, W, H);
      const { r, g, b } = this._extractROIMean(box, W, H);
      roi.r.push(r);
      roi.g.push(g);
      roi.b.push(b);
    }

    // ── 2. Compute CHROM PPG using forehead ROI ────────
    const fh = this.rois.forehead;
    if (fh.r.length >= 10) {
      const rArr = fh.r.toArray();
      const gArr = fh.g.toArray();
      const bArr = fh.b.toArray();

      // Normalise each channel by its mean (suppresses global illumination)
      const rNorm = rArr.map(v => v / (rArr.reduce((a,x)=>a+x,0)/rArr.length || 1));
      const gNorm = gArr.map(v => v / (gArr.reduce((a,x)=>a+x,0)/gArr.length || 1));
      const bNorm = bArr.map(v => v / (bArr.reduce((a,x)=>a+x,0)/bArr.length || 1));

      const chrom = Utils.chromPPG(rNorm, gNorm, bNorm);
      const filt  = this.bpf.filter(chrom[chrom.length - 1]);
      this.ppgBuffer.push(filt);
    }

    // ── 3. Motion estimation via inter-frame luminance diff ──
    const frameData = this._processingCtx.getImageData(0, 0, W, H).data;
    const motion    = this._computeMotion(frameData, W, H);
    this.motionScore.push(motion);

    // ── 4. Illumination stability ─────────────────────
    const lum = this._meanLuminance(frameData);
    this.lumHistory.push(lum);

    // ── 5. Respiration: low-frequency amplitude modulation of PPG
    if (this.ppgBuffer.length >= 30) {
      const ppgArr  = this.ppgBuffer.toArray();
      const env     = this._envelope(ppgArr, 5);
      const lastEnv = env[env.length - 1] ?? 0;
      this.respBuffer.push(lastEnv);
    }

    // ── 6. Update quality score ────────────────────────
    const ppgArr = this.ppgBuffer.toArray();
    this.qualityScore = ppgArr.length >= 30
      ? Utils.signalQuality(ppgArr, this.fps)
      : 0;

    // ── 7. Emit packet ─────────────────────────────────
    const packet = {
      frame:       this.frameCount,
      time:        performance.now(),
      ppg:         this.ppgBuffer.toArray(),
      resp:        this.respBuffer.toArray(),
      rois:        this._roiSnapshot(),
      motion:      this.motionScore.mean,
      luminance:   this.lumHistory.mean,
      lumStd:      this.lumHistory.std,
      quality:     this.qualityScore,
    };
    this.dispatchEvent(Object.assign(new Event('frame'), { packet }));
  }

  /* ── ROI pixel extraction ────────────────────────────── */
  _defaultROI(name, W, H) {
    const ROIs = {
      forehead:   { x: Math.floor(W*0.36), y: Math.floor(H*0.10), w: Math.floor(W*0.28), h: Math.floor(H*0.14) },
      leftCheek:  { x: Math.floor(W*0.18), y: Math.floor(H*0.42), w: Math.floor(W*0.18), h: Math.floor(H*0.16) },
      rightCheek: { x: Math.floor(W*0.64), y: Math.floor(H*0.42), w: Math.floor(W*0.18), h: Math.floor(H*0.16) },
    };
    return ROIs[name] ?? { x: 0, y: 0, w: W, h: H };
  }

  _extractROIMean(box, W, H) {
    const { x, y, w, h } = box;
    const clampedX = Utils.clamp(x, 0, W - 1);
    const clampedY = Utils.clamp(y, 0, H - 1);
    const clampedW = Utils.clamp(w, 1, W - clampedX);
    const clampedH = Utils.clamp(h, 1, H - clampedY);
    const pxData   = this._processingCtx.getImageData(clampedX, clampedY, clampedW, clampedH).data;
    let r = 0, g = 0, b = 0;
    const n = pxData.length / 4;
    for (let i = 0; i < pxData.length; i += 4) {
      r += pxData[i]; g += pxData[i+1]; b += pxData[i+2];
    }
    return { r: r / n, g: g / n, b: b / n };
  }

  /* ── Motion score: mean absolute luminance change ────── */
  _computeMotion(data, W, H) {
    const gray = new Float32Array(W * H);
    for (let i = 0; i < data.length; i += 4) {
      gray[i/4] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    }
    if (!this.prevGrayFrame || this.prevGrayFrame.length !== gray.length) {
      this.prevGrayFrame = gray;
      return 0;
    }
    let diff = 0;
    for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - this.prevGrayFrame[i]);
    this.prevGrayFrame = gray;
    return diff / gray.length;
  }

  _meanLuminance(data) {
    let lum = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      lum += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    }
    return lum / n;
  }

  /* ── Signal envelope (amplitude modulation) ─────────── */
  _envelope(signal, windowSize = 5) {
    const out = [];
    for (let i = 0; i < signal.length; i++) {
      const lo = Math.max(0, i - windowSize);
      const hi = Math.min(signal.length, i + windowSize + 1);
      const slice = signal.slice(lo, hi);
      out.push(Math.max(...slice) - Math.min(...slice));
    }
    return out;
  }

  /* ── ROI snapshot for engines ─────────────────────────── */
  _roiSnapshot() {
    const snap = {};
    for (const [k, v] of Object.entries(this.rois)) {
      snap[k] = {
        r: v.r.toArray(),
        g: v.g.toArray(),
        b: v.b.toArray(),
      };
    }
    return snap;
  }

  /* ── Buffer reset ────────────────────────────────────── */
  _resetBuffers() {
    Object.values(this.rois).forEach(roi => { roi.r = new Utils.CircularBuffer(180); roi.g = new Utils.CircularBuffer(180); roi.b = new Utils.CircularBuffer(180); });
    this.ppgBuffer   = new Utils.CircularBuffer(this.bufferLen);
    this.respBuffer  = new Utils.CircularBuffer(this.bufferLen);
    this.motionScore = new Utils.RunningStats(30);
    this.lumHistory  = new Utils.RunningStats(30);
    this.bpf.reset();
    this.frameCount = 0;
    this.qualityScore = 0;
    this.prevGrayFrame = null;
  }

  /* ── External ROI override (called by FaceMesh module) ── */
  setROIPolygon(name, box) {
    if (this.rois[name]) this.rois[name].polygon = box;
  }
}
