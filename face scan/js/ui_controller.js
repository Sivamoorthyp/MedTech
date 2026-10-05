/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  ui_controller.js
   Intelligent Sensor Interface Controller

   The UI is not decorative — it is an active measurement
   instrument. Every visual element either:
     a) Coaches the user to improve signal quality
     b) Reflects live biometric state in real-time
     c) Provides uncertainty-aware feedback

   Responsibilities:
     • Screen navigation with smooth transitions
     • Live metric display with confidence-aware rendering
     • Coaching system: checks → enable start button
     • Timer countdown with SVG ring progress
     • Emotion distribution bar rendering
     • AU activity strip rendering
     • Results screen population from FusionEngine output
══════════════════════════════════════════════════════════════ */

'use strict';

const UIController = (() => {

  /* ── State ─────────────────────────────────────────────── */
  let currentScreen = 'splash';
  let sessionId     = '';
  let currentMode   = null; // 'medical' | 'mental'

  // Coaching state
  const checks = {
    chkLighting:  false,
    chkFace:      false,
    chkMotion:    false,
    chkDistance:  false,
  };
  let checkAnimFrame = null;

  // Scan timer
  let timerInterval = null;
  let timerSeconds  = 30;
  const SCAN_DURATION = 30;

  const CIRCUMFERENCE = 2 * Math.PI * 18; // radius 18 on viewBox 44

  /* ── Screen transitions ─────────────────────────────────── */
  function showScreen(id) {
    const current = document.querySelector('.screen.active');
    if (current && current.id !== id) {
      current.classList.add('exiting');
      current.classList.remove('active');
      setTimeout(() => current.classList.remove('exiting'), 600);
    }
    const next = document.getElementById(id);
    if (next) {
      setTimeout(() => next.classList.add('active'), 50);
      currentScreen = id;
    }
  }

  /* ── Session ─────────────────────────────────────────────── */
  function initSession() {
    sessionId = Utils.generateSessionId();
    document.querySelectorAll('.session-id').forEach(el => el.textContent = sessionId);
  }

  /* ── Mode selection ─────────────────────────────────────── */
  function setMode(mode) {
    currentMode = mode;
    const nameEl = document.getElementById('setupModeName');
    if (nameEl) nameEl.textContent = mode === 'medical' ? 'MEDICAL SCAN' : 'MENTAL SCAN';
    const setupSessionEl = document.getElementById('setupSessionId');
    if (setupSessionEl) setupSessionEl.textContent = sessionId;
    resetChecks();
  }

  /* ── Coaching / environment checks ─────────────────────── */
  function resetChecks() {
    Object.keys(checks).forEach(k => {
      checks[k] = false;
      const el = document.getElementById(k);
      if (el) {
        el.classList.remove('ok');
        el.querySelector('.check-icon').textContent = '○';
      }
    });
    const btn = document.getElementById('btnStartScan');
    if (btn) btn.disabled = true;
  }

  function updateCoachingChecks(packet) {
    if (!packet) return;
    const { quality, motion, luminance, lumStd } = packet;

    // Lighting check: sufficient mean luminance, low variance
    const lightOk = luminance > 60 && lumStd < 25;
    // Face check: quality implies some face signal exists
    const faceOk  = quality > 0.1;
    // Motion check: low inter-frame motion
    const motionOk = motion < 8;
    // Distance check: inferred from quality — too far = low signal
    const distOk  = quality > 0.15;

    updateCheck('chkLighting', lightOk);
    updateCheck('chkFace',     faceOk);
    updateCheck('chkMotion',   motionOk);
    updateCheck('chkDistance', distOk);

    // Quality bar
    const qFill = document.getElementById('qualityFill');
    const qVal  = document.getElementById('qualityValue');
    if (qFill) {
      qFill.style.width = `${Math.round(quality * 100)}%`;
      const q = quality;
      qFill.style.background = q > 0.6
        ? 'linear-gradient(90deg, rgba(180,255,180,0.5), rgba(180,255,180,0.9))'
        : q > 0.3
        ? 'linear-gradient(90deg, rgba(255,200,80,0.5), rgba(255,200,80,0.9))'
        : 'linear-gradient(90deg, rgba(255,255,255,0.2), white)';
    }
    if (qVal) qVal.textContent = `${Math.round(quality * 100)}%`;

    // Face hint
    const hint = document.getElementById('faceHint');
    if (hint) {
      if (!faceOk)    hint.textContent = 'Position your face in the oval';
      else if (!lightOk) hint.textContent = 'Improve lighting — face brighter area';
      else if (!motionOk)hint.textContent = 'Hold still — reducing motion artefacts';
      else if (!distOk)  hint.textContent = 'Move slightly closer to the camera';
      else               hint.textContent = '✓ Signal calibrated — ready';
    }

    // Enable start button when 3/4 checks pass
    const passCount = Object.values(checks).filter(Boolean).length;
    const btn = document.getElementById('btnStartScan');
    if (btn) btn.disabled = passCount < 3;
  }

  function updateCheck(id, state) {
    if (checks[id] === state) return;
    checks[id] = state;
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('ok', state);
    el.querySelector('.check-icon').textContent = state ? '✓' : '○';
  }

  /* ── Signal quality mini-bar (during scan) ─────────────── */
  function updateScanQuality(quality) {
    const fill = document.getElementById('medQualFill');
    const lbl  = document.getElementById('medQualLabel');
    if (fill) fill.style.width  = `${Math.round(quality * 100)}%`;
    if (lbl)  lbl.textContent   = `Q: ${Math.round(quality * 100)}%`;
  }

  /* ── Medical live metrics ─────────────────────────────── */
  function updateMedicalMetrics(result) {
    if (!result) return;
    const { bpm, hrv, spo2, systolic, diastolic, respRate, fatigue, confidences } = result;

    setMetric('valBpm',     Utils.fmt.bpm(bpm),              confidences?.bpm,   'lmBpm');
    setMetric('valHrv',     Utils.fmt.hrv(hrv),              confidences?.hrv,   'lmHrv');
    setMetric('valSpo2',    Utils.fmt.spo2(spo2),            confidences?.spo2,  'lmSpo2');
    setMetric('valResp',    Utils.fmt.resp(respRate),        confidences?.resp,  'lmResp');
    setMetric('valBp',      Utils.fmt.bp(systolic,diastolic),confidences?.bp,    'lmBp');
    setMetric('valFatigue', fatigue ?? '—',                  confidences?.fatigue,'lmFatigue');

    // Waveform quality
    if (result.confidences) {
      updateScanQuality(result.confidences.bpm ?? 0);
    }
  }

  function setMetric(valueId, display, confidence, cardId) {
    const valEl  = document.getElementById(valueId);
    const confEl = document.getElementById(valueId.replace('val','conf'));
    const card   = document.getElementById(cardId);

    if (valEl) {
      valEl.textContent = display;
      valEl.style.opacity = confidence > 0.3 ? '1' : '0.4';
    }
    if (confEl) {
      const pct = Math.round((confidence ?? 0) * 100);
      confEl.style.setProperty('--conf', `${pct}%`);
    }
    if (card) card.classList.toggle('active', (confidence ?? 0) > 0.5);
  }

  /* ── Mental live metrics ──────────────────────────────── */
  function updateMentalMetrics(result) {
    if (!result) return;
    const { stressIndex, anxietyIndex, stabilityScore, engagementScore, cognitiveFatigue, confidences } = result;

    const pct = v => v != null ? `${Math.round(v * 100)}` : '—';

    setMetric('valStress',         pct(stressIndex),     confidences?.stress,          'lmStress' ?? null);
    setMetric('valAnxiety',        pct(anxietyIndex),    confidences?.anxiety,         'lmAnxiety' ?? null);
    setMetric('valStability',      pct(stabilityScore),  confidences?.stability,       'lmStability' ?? null);
    setMetric('valEngagement',     pct(engagementScore), confidences?.engagement,      'lmEngagement' ?? null);
    setMetric('valCognitiveFatigue', pct(cognitiveFatigue), confidences?.cognitiveFatigue, 'lmCognitiveFatigue' ?? null);

    // Emotion distribution bars
    if (result.emotionProbs) updateEmotionDist(result.emotionProbs);

    // AU activity strip
    if (result.auActivations) updateAUStrip(result.auActivations);
  }

  function updateEmotionDist(probs) {
    const container = document.getElementById('emotionDist');
    if (!container) return;

    // Build if empty
    if (!container.children.length) {
      Object.keys(probs).forEach(emotion => {
        const row = document.createElement('div');
        row.className = 'emo-row';
        row.innerHTML = `
          <span class="emo-name">${emotion}</span>
          <div class="emo-track"><div class="emo-fill" id="emoFill_${emotion}" style="width:0%"></div></div>
          <span class="emo-pct" id="emoPct_${emotion}">0%</span>
        `;
        container.appendChild(row);
      });
    }

    Object.entries(probs).forEach(([emotion, prob]) => {
      const fill = document.getElementById(`emoFill_${emotion}`);
      const pct  = document.getElementById(`emoPct_${emotion}`);
      const p    = Math.round(prob * 100);
      if (fill) fill.style.width = `${p}%`;
      if (pct)  pct.textContent  = `${p}%`;
    });
  }

  function updateAUStrip(aus) {
    const strip = document.getElementById('auStrip');
    if (!strip) return;

    if (!strip.children.length) {
      Object.keys(aus).forEach(label => {
        const wrap = document.createElement('div');
        wrap.className = 'au-bar-wrap';
        wrap.innerHTML = `
          <div class="au-bar-track">
            <div class="au-bar-fill" id="au_${label}" style="height:0%"></div>
          </div>
          <span class="au-label">${label}</span>
        `;
        strip.appendChild(wrap);
      });
    }

    Object.entries(aus).forEach(([label, val]) => {
      const bar = document.getElementById(`au_${label}`);
      if (bar) bar.style.height = `${Math.round(val * 100)}%`;
    });
  }

  /* ── Timer ─────────────────────────────────────────────── */
  function startTimer(mode, onComplete) {
    timerSeconds = SCAN_DURATION;
    const timerEl    = document.getElementById(mode === 'medical' ? 'medTimer' : 'menTimer');
    const progressEl = document.getElementById(mode === 'medical' ? 'timerProgress' : 'menTimerProgress');

    _updateTimerUI(timerEl, progressEl, timerSeconds);

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timerSeconds--;
      _updateTimerUI(timerEl, progressEl, timerSeconds);
      if (timerSeconds <= 0) {
        clearInterval(timerInterval);
        if (onComplete) onComplete();
      }
    }, 1000);
  }

  function _updateTimerUI(timerEl, progressEl, seconds) {
    if (timerEl) timerEl.textContent = Utils.formatTime(seconds);
    if (progressEl) {
      const pct    = seconds / SCAN_DURATION;
      const offset = CIRCUMFERENCE * (1 - pct);
      progressEl.style.strokeDashoffset = offset;
      progressEl.style.stroke = pct > 0.5 ? 'white'
        : pct > 0.25 ? 'rgba(255,200,80,0.9)'
        : 'rgba(255,80,80,0.9)';
    }
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  /* ── Results screen ─────────────────────────────────────── */
  function renderResults(fusionResult, medResult, menResult) {
    const layout = document.getElementById('resultsLayout');
    if (!layout) return;

    const score  = fusionResult?.wellbeingScore ?? 0;
    const cls    = fusionResult?.classification ?? { label:'—', color:'ok' };
    const contribs = fusionResult?.contributions ?? [];
    const exp    = fusionResult?.explanation ?? '';

    // Arc geometry
    const arcCirc = 2 * Math.PI * 72; // r=72 on 160 viewBox
    const arcOffset = arcCirc * (1 - score / 100);

    layout.innerHTML = `
      <!-- Hero score ring -->
      <div class="results-hero">
        <div class="results-score-ring">
          <svg viewBox="0 0 160 160" fill="none">
            <circle class="score-track" cx="80" cy="80" r="72" stroke-width="4"/>
            <circle class="score-arc" cx="80" cy="80" r="72" stroke-width="4"
              stroke-dasharray="${arcCirc.toFixed(1)}"
              stroke-dashoffset="${arcCirc.toFixed(1)}"
              id="scoreArcEl"/>
          </svg>
          <div class="score-center">
            <div class="score-number" id="scoreNum">0</div>
            <div class="score-label mono">WELLBEING</div>
          </div>
        </div>
        <h1 class="results-title">${cls.label}</h1>
        <p class="results-subtitle">${fusionResult?.trend ?? ''} &nbsp;·&nbsp;
          Confidence: ${fusionResult?.overallConfidence != null ? Math.round(fusionResult.overallConfidence * 100) : '—'}%
        </p>
      </div>

      <!-- Medical + Mental side-by-side -->
      <div class="results-grid">
        ${medResult ? _buildMedSection(medResult) : ''}
        ${menResult ? _buildMenSection(menResult) : ''}
      </div>

      <!-- Fusion intelligence -->
      <div class="fusion-block">
        <div class="fusion-label">FUSION INTELLIGENCE · HOLISTIC INTERPRETATION</div>

        <div class="fusion-visual">
          <div class="fv-box">
            <div class="fv-value">${fusionResult?.medicalSubScore ?? '—'}</div>
            <div>MEDICAL LAYER</div>
          </div>
          <div class="fv-arrow">⊕</div>
          <div class="fv-box">
            <div class="fv-value">${fusionResult?.mentalSubScore ?? '—'}</div>
            <div>MENTAL LAYER</div>
          </div>
          <div class="fv-arrow">→</div>
          <div class="fv-box">
            <div class="fv-value">${score}</div>
            <div>HOLISTIC SCORE</div>
          </div>
        </div>

        <div class="fusion-desc">${exp.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n\n/g, '<br><br>')}</div>

        <!-- Signal contribution attribution -->
        <div class="fusion-label" style="margin-top:16px;">SIGNAL CONTRIBUTION ATTRIBUTION</div>
        <div class="contrib-bar-group">
          ${contribs.map(c => `
            <div class="contrib-row">
              <span class="contrib-name">${c.name}</span>
              <div class="contrib-track">
                <div class="contrib-fill" style="width:0%" data-pct="${Math.round(c.pct*100)}"></div>
              </div>
              <span class="contrib-pct">${Math.round(c.pct*100)}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Animate score ring and contribution bars after paint
    requestAnimationFrame(() => {
      setTimeout(() => {
        // Score number count-up
        const scoreEl = document.getElementById('scoreNum');
        const arcEl   = document.getElementById('scoreArcEl');
        if (arcEl) arcEl.style.strokeDashoffset = arcOffset.toFixed(1);
        let count = 0;
        const interval = setInterval(() => {
          count = Math.min(count + Math.ceil(score / 40), score);
          if (scoreEl) scoreEl.textContent = count;
          if (count >= score) clearInterval(interval);
        }, 30);

        // Contribution bars
        document.querySelectorAll('.contrib-fill').forEach(el => {
          el.style.width = `${el.dataset.pct}%`;
        });
      }, 100);
    });
  }

  function _buildMedSection(r) {
    return `
      <div class="result-section">
        <div class="result-section-header">
          <span class="result-section-title">MEDICAL BIOSIGNALS</span>
        </div>
        <div class="result-section-body">
          ${_mRow('Heart Rate',       Utils.fmt.bpm(r.bpm)+'  BPM', _bpmStatus(r.bpm))}
          ${_mRow('HRV (RMSSD)',      Utils.fmt.hrv(r.hrv)+' ms',   _hrvStatus(r.hrv))}
          ${_mRow('SpO₂',            Utils.fmt.spo2(r.spo2)+'%',   _spo2Status(r.spo2))}
          ${_mRow('Blood Pressure',   Utils.fmt.bp(r.systolic,r.diastolic)+' mmHg', _bpStatus(r.systolic))}
          ${_mRow('Respiration Rate', Utils.fmt.resp(r.respRate)+' /min', _respStatus(r.respRate))}
          ${_mRow('Fatigue',          r.fatigue ?? '—',              _fatigueStatus(r.fatigue))}
        </div>
      </div>
    `;
  }

  function _buildMenSection(r) {
    const pct = v => v != null ? `${Math.round(v*100)}/100` : '—';
    return `
      <div class="result-section">
        <div class="result-section-header">
          <span class="result-section-title">MENTAL HEALTH SIGNALS</span>
        </div>
        <div class="result-section-body">
          ${_mRow('Dominant Emotion',  r.dominantEmotion ?? '—',       r.dominantEmotion === 'Happy' || r.dominantEmotion === 'Neutral' ? 'ok':'warn')}
          ${_mRow('Stress Index',      pct(r.stressIndex),  _stressStatus(r.stressIndex))}
          ${_mRow('Anxiety Indicator', pct(r.anxietyIndex), _stressStatus(r.anxietyIndex))}
          ${_mRow('Emotional Stability', pct(r.stabilityScore), _stability(r.stabilityScore))}
          ${_mRow('Engagement',        pct(r.engagementScore), _stability(r.engagementScore))}
          ${_mRow('Cognitive Fatigue', pct(r.cognitiveFatigue), _stressStatus(r.cognitiveFatigue))}
        </div>
      </div>
    `;
  }

  function _mRow(label, value, statusClass) {
    const text = { ok:'Normal', warn:'Elevated', alert:'Critical' };
    return `
      <div class="result-metric-row">
        <span class="rm-label">${label}</span>
        <span class="rm-value">${value}</span>
        <span class="rm-status ${statusClass}">${text[statusClass] ?? statusClass}</span>
      </div>
    `;
  }

  /* status helpers */
  const _bpmStatus    = v => v == null ? 'ok' : v < 50 || v > 110 ? 'alert' : v > 90 ? 'warn' : 'ok';
  const _hrvStatus    = v => v == null ? 'ok' : v < 15 ? 'alert' : v < 30 ? 'warn' : 'ok';
  const _spo2Status   = v => v == null ? 'ok' : v < 90 ? 'alert' : v < 95 ? 'warn' : 'ok';
  const _bpStatus     = v => v == null ? 'ok' : v > 140 ? 'alert' : v > 120 ? 'warn' : 'ok';
  const _respStatus   = v => v == null ? 'ok' : v < 8 || v > 28 ? 'alert' : v < 12 || v > 20 ? 'warn' : 'ok';
  const _fatigueStatus= v => ({ 'Low':'ok', 'Moderate':'warn', 'High':'alert', 'Severe':'alert' }[v] ?? 'ok');
  const _stressStatus = v => v == null ? 'ok' : v > 0.7 ? 'alert' : v > 0.45 ? 'warn' : 'ok';
  const _stability    = v => v == null ? 'ok' : v < 0.3 ? 'alert' : v < 0.6 ? 'warn' : 'ok';

  /* ── Public API ─────────────────────────────────────────── */
  return {
    showScreen,
    initSession,
    setMode,
    updateCoachingChecks,
    updateScanQuality,
    updateMedicalMetrics,
    updateMentalMetrics,
    startTimer,
    stopTimer,
    renderResults,
    get currentMode() { return currentMode; },
    get sessionId()   { return sessionId;   },
  };

})();

window.UIController = UIController;
