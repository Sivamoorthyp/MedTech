/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  face_mesh.js
   Real-Time 3D Face Mesh Renderer + ROI Visualizer

   Technology: Three.js for 3D wireframe rendering.
   Landmark source: MediaPipe FaceMesh (468 points) via
   @mediapipe/face_mesh CDN, or simulated if not available.

   Responsibilities:
     • Draw 3D wireframe face mesh on scan canvas
     • Highlight physiological ROIs (forehead, cheeks, temporal)
     • Render emotion heatmap overlay (per-region AU activation)
     • Provide landmark data to MentalEngine
     • Provide ROI pixel bounds to SignalProcessor
══════════════════════════════════════════════════════════════ */

'use strict';

class FaceMeshRenderer {

  constructor(videoEl, meshCanvas, roiCanvas) {
    this.video     = videoEl;
    this.meshCanvas = meshCanvas;
    this.roiCanvas  = roiCanvas;
    this.meshCtx   = meshCanvas.getContext('2d');
    this.roiCtx    = roiCanvas.getContext('2d');

    this.landmarks     = null;
    this.active        = false;
    this.mode          = 'medical'; // 'medical' | 'mental'
    this.auActivations = {};        // AU label → [0,1] passed from MentalEngine
    this.frameCount    = 0;

    // MediaPipe availability flag (gracefully degrades to simulation)
    this._mpReady = false;
    this._faceMesh = null;
    this._initMediaPipe();

    // Simulation state (used when MediaPipe not available)
    this._simLandmarks = this._generateSimLandmarks();
    this._simPhase     = 0;

    // Pulse animation state (for ROI glow effect driven by BPM)
    this.pulsePhase = 0;
    this.bpmForPulse = 72;
  }

  /* ── MediaPipe initialization ────────────────────────── */
  _initMediaPipe() {
    // Attempt to use MediaPipe FaceMesh if globally available
    if (typeof window.FaceMesh !== 'undefined') {
      try {
        this._faceMesh = new window.FaceMesh({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
        });
        this._faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        this._faceMesh.onResults(r => this._onMPResults(r));
        this._mpReady = true;
      } catch(e) {
        this._mpReady = false;
      }
    }
  }

  _onMPResults(results) {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      this.landmarks = results.multiFaceLandmarks[0];
    } else {
      this.landmarks = null;
    }
  }

  /* ── Lifecycle ───────────────────────────────────────── */
  start(mode = 'medical') {
    this.mode   = mode;
    this.active = true;
    this._loop();
  }

  stop() {
    this.active = false;
    this.landmarks = null;
  }

  /* ── Main render loop ────────────────────────────────── */
  async _loop() {
    if (!this.active) return;
    this.frameCount++;
    this._syncCanvasSize();

    // MediaPipe send frame
    if (this._mpReady && this._faceMesh && this.video.readyState >= 2) {
      await this._faceMesh.send({ image: this.video });
    }

    // Use sim landmarks if MP not available or no face detected
    const lm = this.landmarks ?? this._getSimLandmarks();

    // Clear
    this.meshCtx.clearRect(0, 0, this.meshCanvas.width, this.meshCanvas.height);
    this.roiCtx.clearRect(0, 0, this.roiCanvas.width, this.roiCanvas.height);

    // Draw face wireframe mesh
    this._drawFaceWireframe(lm);

    // Draw ROI overlays
    if (this.mode === 'medical') {
      this._drawMedicalROIs(lm);
    } else {
      this._drawEmotionHeatmap(lm);
    }

    // Advance simulation
    this._simPhase += 0.04;
    this.pulsePhase += (2 * Math.PI * this.bpmForPulse) / (60 * 30); // 30fps

    await new Promise(r => requestAnimationFrame(r));
    if (this.active) this._loop();
  }

  /* ── Canvas size sync ────────────────────────────────── */
  _syncCanvasSize() {
    const rect = this.video.getBoundingClientRect();
    const W    = this.video.videoWidth  || rect.width  || 640;
    const H    = this.video.videoHeight || rect.height || 480;

    for (const c of [this.meshCanvas, this.roiCanvas]) {
      if (c.width !== W || c.height !== H) {
        c.width  = W;
        c.height = H;
      }
    }
  }

  /* ── Project normalised landmark to canvas pixel ───────
     MediaPipe landmarks are [0,1] relative to video frame.
  ────────────────────────────────────────────────────── */
  _proj(lm, idx) {
    const W = this.meshCanvas.width;
    const H = this.meshCanvas.height;
    const p = lm[idx];
    if (!p) return { x: W/2, y: H/2 };
    return { x: p.x * W, y: p.y * H };
  }

  /* ── Face wireframe ─────────────────────────────────── */
  _drawFaceWireframe(lm) {
    const ctx = this.meshCtx;
    const W   = this.meshCanvas.width;
    const H   = this.meshCanvas.height;

    // Draw tessellation edges (simplified subset — full 468-point mesh)
    const FACE_OVAL_INDICES = [
      10,338,297,332,284,251,389,356,454,323,361,288,
      397,365,379,378,400,377,152,148,176,149,150,136,
      172,58,132,93,234,127,162,21,54,103,67,109,10
    ];

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = 0.8;
    for (let i = 0; i < FACE_OVAL_INDICES.length - 1; i++) {
      const p0 = this._proj(lm, FACE_OVAL_INDICES[i]);
      const p1 = this._proj(lm, FACE_OVAL_INDICES[i+1]);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();

    // Eye contours
    this._drawContour(ctx, lm, [33,7,163,144,145,153,154,155,133,33], 'rgba(255,255,255,0.5)', 0.7);
    this._drawContour(ctx, lm, [362,382,381,380,374,373,390,249,263,362], 'rgba(255,255,255,0.5)', 0.7);

    // Lips
    this._drawContour(ctx, lm, [61,185,40,39,37,0,267,269,270,409,291,61], 'rgba(255,255,255,0.4)', 0.6);
    this._drawContour(ctx, lm, [61,96,89,179,86,15,86,179,89,180,61], 'rgba(255,255,255,0.3)', 0.5);

    // Nose
    this._drawContour(ctx, lm, [168,6,197,195,5,4,1,19,94,2,164,168], 'rgba(255,255,255,0.3)', 0.5);

    // Landmark dots (key points only)
    const KEY_POINTS = [1, 4, 13, 14, 33, 61, 105, 107, 117, 133, 152, 159, 176,
                        263, 291, 308, 334, 336, 362, 386, 397];
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    KEY_POINTS.forEach(idx => {
      const p = this._proj(lm, idx);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI*2);
      ctx.fill();
    });

    // Landmark count label
    if (window.UIController) {
      const lcEl = document.getElementById('landmarkCount');
      if (lcEl) lcEl.textContent = `Landmarks: ${lm.length}`;
    }
  }

  _drawContour(ctx, lm, indices, color, alpha) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = 0.9;
    indices.forEach((idx, i) => {
      const p = this._proj(lm, idx);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ── Medical ROI overlays with pulse glow ────────────── */
  _drawMedicalROIs(lm) {
    const ctx = this.roiCtx;
    const W   = this.roiCanvas.width;
    const H   = this.roiCanvas.height;

    // Pulse glow intensity (0→1→0 at cardiac frequency)
    const pulse = (Math.sin(this.pulsePhase) + 1) / 2;
    const glow  = 0.08 + pulse * 0.18;

    // ── Forehead ROI ─────────────────────────────────────
    const fhY1 = this._proj(lm, 10).y;
    const fhY2 = this._proj(lm, 9).y;
    const fhX1 = this._proj(lm, 162).x;
    const fhX2 = this._proj(lm, 389).x;
    this._drawROIRect(ctx, fhX1, fhY1 - 10, fhX2, fhY2, `rgba(255,255,255,${glow})`, 'rgba(255,255,255,0.5)', 'FOREHEAD');

    // ── Left Cheek ROI ───────────────────────────────────
    const lcX1 = this._proj(lm, 234).x;
    const lcX2 = this._proj(lm, 132).x;
    const lcY1 = this._proj(lm, 36).y;
    const lcY2 = this._proj(lm, 172).y;
    this._drawROIRect(ctx, lcX1, lcY1, lcX2, lcY2, `rgba(255,255,255,${glow * 0.7})`, 'rgba(255,255,255,0.35)', 'L·CHEEK');

    // ── Right Cheek ROI ──────────────────────────────────
    const rcX1 = this._proj(lm, 361).x;
    const rcX2 = this._proj(lm, 454).x;
    const rcY1 = this._proj(lm, 266).y;
    const rcY2 = this._proj(lm, 397).y;
    this._drawROIRect(ctx, rcX1, rcY1, rcX2, rcY2, `rgba(255,255,255,${glow * 0.7})`, 'rgba(255,255,255,0.35)', 'R·CHEEK');

    // Update signal processor ROI bounds
    if (window.SignalProcessorInstance) {
      const sp = window.SignalProcessorInstance;
      sp.setROIPolygon('forehead',   { x: Math.min(fhX1,fhX2), y: Math.min(fhY1,fhY2), w: Math.abs(fhX2-fhX1), h: Math.abs(fhY2-fhY1) });
      sp.setROIPolygon('leftCheek',  { x: Math.min(lcX1,lcX2), y: Math.min(lcY1,lcY2), w: Math.abs(lcX2-lcX1), h: Math.abs(lcY2-lcY1) });
      sp.setROIPolygon('rightCheek', { x: Math.min(rcX1,rcX2), y: Math.min(rcY1,rcY2), w: Math.abs(rcX2-rcX1), h: Math.abs(rcY2-rcY1) });
    }
  }

  _drawROIRect(ctx, x1, y1, x2, y2, fillColor, strokeColor, label) {
    const xMin = Math.min(x1,x2), xMax = Math.max(x1,x2);
    const yMin = Math.min(y1,y2), yMax = Math.max(y1,y2);
    const w = xMax - xMin, h = yMax - yMin;
    if (w < 4 || h < 4) return;

    ctx.fillStyle   = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(xMin, yMin, w, h, 4);
    ctx.fill();
    ctx.stroke();

    // Corner tick marks
    const t = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    [[xMin,yMin],[xMax,yMin],[xMin,yMax],[xMax,yMax]].forEach(([cx,cy]) => {
      const sx = cx === xMin ? 1 : -1;
      const sy = cy === yMin ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy*t); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx*t, cy);
      ctx.stroke();
    });

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '9px Noto Sans Mono, monospace';
    ctx.fillText(label, xMin + 4, yMin + 12);
  }

  /* ── Emotion heatmap overlay ─────────────────────────── */
  _drawEmotionHeatmap(lm) {
    const ctx  = this.roiCtx;
    const W    = this.roiCanvas.width;
    const H    = this.roiCanvas.height;
    const aus  = this.auActivations;

    // For each facial region, compute a local "activation" from relevant AUs
    const regions = [
      { name: 'Forehead',  indices: [10,109,67,103,54], aus: ['AU1','AU2','AU4'], color: 0 },
      { name: 'L.Eye',     indices: [33,133,159,145],   aus: ['AU7','AU1'],       color: 1 },
      { name: 'R.Eye',     indices: [362,263,386,374],  aus: ['AU7','AU2'],       color: 1 },
      { name: 'L.Cheek',   indices: [234,93,132,172],   aus: ['AU6','AU12'],      color: 2 },
      { name: 'R.Cheek',   indices: [454,361,397,365],  aus: ['AU6','AU12'],      color: 2 },
      { name: 'Mouth',     indices: [61,291,13,14],     aus: ['AU12','AU20','AU25','AU26'], color: 3 },
      { name: 'Chin',      indices: [152,170,200],      aus: ['AU17','AU26'],     color: 4 },
    ];

    regions.forEach(reg => {
      const activation = reg.aus.reduce((s, k) => s + (aus[k] ?? 0), 0) / reg.aus.length;
      if (activation < 0.05) return;

      // Compute centroid
      const pts     = reg.indices.map(i => this._proj(lm, i));
      const cx      = pts.reduce((s,p) => s+p.x, 0) / pts.length;
      const cy      = pts.reduce((s,p) => s+p.y, 0) / pts.length;
      const radius  = Math.max(20, activation * 60 + 15);
      const alpha   = Utils.clamp(activation * 0.55, 0, 0.55);

      // Gradient heatmap blob
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0,   `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.4})`);
      grad.addColorStop(1,   `rgba(255,255,255,0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /* ── Simulation landmark generation ─────────────────── */
  _generateSimLandmarks() {
    // 468 landmarks slightly jittered around a face-shaped convex hull
    const lms = [];
    for (let i = 0; i < 468; i++) {
      const angle  = (i / 468) * Math.PI * 2;
      const radius = 0.13 + 0.02 * Math.sin(i * 0.5);
      lms.push({
        x: 0.5 + radius * Math.cos(angle) * 0.55,
        y: 0.45 + radius * Math.sin(angle),
        z: 0,
      });
    }
    return lms;
  }

  _getSimLandmarks() {
    // Animate simulation landmarks slightly (breathing / micro-motion)
    const jitter = 0.003 * Math.sin(this._simPhase);
    return this._simLandmarks.map(p => ({
      x: p.x + Utils.gaussianRandom(0, 0.001) + jitter,
      y: p.y + Utils.gaussianRandom(0, 0.001),
      z: 0,
    }));
  }

  /* ── External setters ────────────────────────────────── */
  setAUActivations(aus)   { this.auActivations = aus ?? {}; }
  setBPM(bpm)             { if (bpm > 20) this.bpmForPulse = bpm; }
  getLandmarks()          { return this.landmarks ?? this._getSimLandmarks(); }
}
