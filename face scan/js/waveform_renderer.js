/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  waveform_renderer.js
   Real-Time Biometric Waveform & Emotion Timeline Renderer

   Renders two types of live visualizations:
     1. WAVEFORM: Oscilloscope-style scrolling PPG / respiration
     2. EMOTION TIMELINE: Stacked area chart of emotion probabilities
        over the scan window (Transformer attention visualization)

   Design philosophy:
     The waveform is NOT decorative — it is a diagnostic instrument.
     Rendering must be crisp, low-latency, and signal-accurate.
══════════════════════════════════════════════════════════════ */

'use strict';

class WaveformRenderer {

  constructor() {
    this.renderers = {}; // canvas id → renderer state
  }

  /* ── Register a canvas for waveform rendering ─────────── */
  registerWaveform(canvasId, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.width  = canvas.offsetWidth  || 400;
    canvas.height = canvas.offsetHeight || 80;
    const ctx = canvas.getContext('2d');

    this.renderers[canvasId] = {
      canvas, ctx,
      buffer:     new Utils.CircularBuffer(canvas.width),
      type:       options.type ?? 'waveform',  // 'waveform' | 'timeline'
      color:      options.color ?? 'rgba(255,255,255,0.9)',
      gridColor:  'rgba(255,255,255,0.05)',
      fillColor:  options.fill ?? 'rgba(255,255,255,0.04)',
      peakColor:  options.peakColor ?? 'rgba(255,255,255,0.5)',
      labels:     options.labels ?? [],
      colors:     options.colors ?? [],
      timelineData: [],       // for emotion timeline: Array<{label, color, history}>
      peakPositions: [],
    };
  }

  /* ── Push one sample to a waveform ────────────────────── */
  pushSample(canvasId, value) {
    const r = this.renderers[canvasId];
    if (!r) return;
    r.buffer.push(value);
    this._renderWaveform(r);
  }

  /* ── Push emotion probability vector to timeline ───────── */
  pushEmotionFrame(canvasId, probVector) {
    const r = this.renderers[canvasId];
    if (!r) return;
    r.timelineData.push([...probVector]);
    if (r.timelineData.length > r.canvas.width) r.timelineData.shift();
    this._renderTimeline(r);
  }

  /* ── Oscilloscope Waveform Renderer ─────────────────────
     Scrolling signal trace:
       1. Draw grid (time markers every ~1s = 30 samples)
       2. Draw filled area under curve
       3. Draw signal line with sub-pixel smoothing
       4. Mark detected peaks with tick marks
  ────────────────────────────────────────────────────────── */
  _renderWaveform(r) {
    const { ctx, canvas, buffer, color, fillColor, gridColor } = r;
    const W = canvas.width, H = canvas.height;

    // Resize if layout changed
    if (canvas.offsetWidth > 0 && canvas.width !== canvas.offsetWidth) {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight || 80;
    }

    ctx.clearRect(0, 0, W, H);

    const data = buffer.toArray();
    if (data.length < 2) return;

    // Normalize to canvas height
    const mn  = Math.min(...data);
    const mx  = Math.max(...data);
    const range = mx - mn || 1;
    const toY = v => H * 0.85 - ((v - mn) / range) * (H * 0.70);

    const stepX = W / Math.max(data.length - 1, 1);

    // ── Grid lines (time axis) ────────────────────────────
    ctx.strokeStyle = gridColor;
    ctx.lineWidth   = 0.5;
    for (let t = 0; t < W; t += 30 * stepX) { // every ~1s
      ctx.beginPath();
      ctx.moveTo(t, 0); ctx.lineTo(t, H);
      ctx.stroke();
    }
    // Zero line
    const zeroY = toY((mn + mx) / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Filled area ───────────────────────────────────────
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(0, H);
    data.forEach((v, i) => {
      const x = i * stepX;
      const y = toY(v);
      i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo((data.length - 1) * stepX, H);
    ctx.closePath();
    ctx.fill();

    // ── Waveform line (anti-aliased Catmull-Rom spline) ───
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.4;
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const x = i * stepX;
      const y = toY(data[i]);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        // Smooth with cubic Bezier control points
        const px = (i - 1) * stepX;
        const py = toY(data[i - 1]);
        const cpX = (px + x) / 2;
        ctx.bezierCurveTo(cpX, py, cpX, y, x, y);
      }
    }
    ctx.stroke();

    // ── Current value marker (right edge dot) ─────────────
    const lastX = (data.length - 1) * stepX;
    const lastY = toY(data[data.length - 1]);
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Scan line (vertical)
    const grad = ctx.createLinearGradient(lastX - 20, 0, lastX, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = grad;
    ctx.fillRect(lastX - 20, 0, 20, H);
  }

  /* ── Emotion Probability Timeline ───────────────────────
     Stacked area chart in grayscale shades, one band per emotion.
     Each band represents the probability of that emotion over time.
     This directly visualizes the Transformer's temporal attention output.
  ────────────────────────────────────────────────────────── */
  _renderTimeline(r) {
    const { ctx, canvas, timelineData, labels } = r;
    const W = canvas.width, H = canvas.height;

    if (canvas.offsetWidth > 0 && canvas.width !== canvas.offsetWidth) {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight || 80;
    }

    ctx.clearRect(0, 0, W, H);
    if (timelineData.length < 2) return;

    const nEmotions = timelineData[0].length;
    const nFrames   = timelineData.length;
    const stepX     = W / Math.max(nFrames - 1, 1);

    // Grayscale shades for each emotion (distinct but monochromatic)
    const shades = [
      'rgba(255,255,255,0.28)', // Neutral
      'rgba(255,255,255,0.55)', // Happy
      'rgba(255,255,255,0.18)', // Sad
      'rgba(255,255,255,0.40)', // Angry
      'rgba(255,255,255,0.35)', // Fearful
      'rgba(255,255,255,0.22)', // Disgusted
      'rgba(255,255,255,0.48)', // Surprised
      'rgba(255,255,255,0.12)', // Contempt
    ];

    // Draw each emotion band as stacked area
    for (let e = 0; e < nEmotions; e++) {
      ctx.fillStyle = shades[e] ?? 'rgba(255,255,255,0.2)';
      ctx.beginPath();

      // Top boundary (cumulative sum up to emotion e)
      for (let f = 0; f < nFrames; f++) {
        const x    = f * stepX;
        const cumTop = timelineData[f].slice(0, e + 1).reduce((a,b)=>a+b, 0);
        const y    = H - cumTop * H;
        f === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }

      // Bottom boundary (cumulative sum up to emotion e-1)
      for (let f = nFrames - 1; f >= 0; f--) {
        const x    = f * stepX;
        const cumBot = e > 0 ? timelineData[f].slice(0, e).reduce((a,b)=>a+b, 0) : 0;
        const y    = H - cumBot * H;
        ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.fill();
    }

    // Timeline label legend (right side)
    if (labels.length > 0) {
      ctx.font      = '9px Noto Sans Mono, monospace';
      ctx.textAlign = 'right';
      labels.forEach((lbl, i) => {
        const prob = timelineData[timelineData.length - 1][i] ?? 0;
        if (prob < 0.05) return;
        const yPos = H - timelineData[timelineData.length-1].slice(0, i + 1).reduce((a,b)=>a+b,0) * H + 10;
        ctx.fillStyle = `rgba(255,255,255,${0.4 + prob * 0.4})`;
        ctx.fillText(lbl, W - 4, yPos);
      });
      ctx.textAlign = 'left';
    }

    // Scan cursor
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo((nFrames-1)*stepX, 0);
    ctx.lineTo((nFrames-1)*stepX, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ── Resize all registered canvases ─────────────────── */
  resizeAll() {
    Object.values(this.renderers).forEach(r => {
      r.canvas.width  = r.canvas.offsetWidth  || 400;
      r.canvas.height = r.canvas.offsetHeight || 80;
    });
  }
}

// Singleton
const WaveformRendererInstance = new WaveformRenderer();
