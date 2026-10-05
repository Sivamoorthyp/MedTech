/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  app.js
   Main Application Orchestrator

   Wires together all subsystems following the intelligence cycle:
     OBSERVE → ANALYZE → STABILIZE → INTERPRET → EXPLAIN

   Lifecycle per scan:
     1. User selects mode (medical / mental)
     2. Camera setup + coaching loop (environment calibration)
     3. Scan phase: SignalProcessor feeds MedicalEngine or MentalEngine
     4. FaceMeshRenderer draws overlays during scan
     5. WaveformRenderer draws live biometric traces
     6. On completion: FusionEngine produces holistic result
     7. UIController renders the annotated results screen
══════════════════════════════════════════════════════════════ */

'use strict';

(function() {

  /* ══ Subsystem instances ══════════════════════════════════ */
  const signalProcessor       = new SignalProcessor();
  const medicalEngine         = new MedicalEngine();
  const mentalEngine          = new MentalEngine();
  const fusionEngine          = new FusionEngine();

  // Expose signal processor globally so FaceMesh can set ROI bounds
  window.SignalProcessorInstance = signalProcessor;

  // FaceMesh renderers (one per scan screen)
  let medFaceMesh = null;
  let menFaceMesh = null;

  // Accumulated results from both scans (for final fusion)
  let medicalResult = null;
  let mentalResult  = null;

  // Camera streams
  let setupStream = null;
  let scanStream  = null;

  // Simulation heartbeat for demo data when camera not available
  let simInterval = null;

  /* ══ Init on DOM ready ════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    UIController.initSession();
    _bindEvents();
    _initWaveformCanvases();
  });

  /* ══ Event bindings ═══════════════════════════════════════ */
  function _bindEvents() {
    // Splash → mode select
    document.getElementById('btnBegin')?.addEventListener('click', () => {
      UIController.showScreen('modeSelect');
    });

    // Mode cards
    document.getElementById('btnMedical')?.addEventListener('click', () => {
      UIController.setMode('medical');
      UIController.showScreen('cameraSetup');
      _startCameraSetup();
    });
    document.getElementById('btnMental')?.addEventListener('click', () => {
      UIController.setMode('mental');
      UIController.showScreen('cameraSetup');
      _startCameraSetup();
    });

    // Back from setup
    document.getElementById('backToMode')?.addEventListener('click', () => {
      _stopCameraSetup();
      UIController.showScreen('modeSelect');
    });

    // Start scan
    document.getElementById('btnStartScan')?.addEventListener('click', () => {
      _stopCameraSetup();
      const mode = UIController.currentMode;
      if (mode === 'medical') _startMedicalScan();
      else                    _startMentalScan();
    });

    // Restart
    document.getElementById('btnRestart')?.addEventListener('click', () => {
      _fullReset();
      UIController.showScreen('modeSelect');
    });
  }

  /* ══ Waveform canvas registration ════════════════════════ */
  function _initWaveformCanvases() {
    WaveformRendererInstance.registerWaveform('ppgCanvas',      { type: 'waveform', color: 'rgba(255,255,255,0.95)', fill: 'rgba(255,255,255,0.05)' });
    WaveformRendererInstance.registerWaveform('respCanvas',     { type: 'waveform', color: 'rgba(255,255,255,0.6)',  fill: 'rgba(255,255,255,0.03)' });
    WaveformRendererInstance.registerWaveform('emotionTimeline',{ type: 'timeline', labels: ['Neutral','Happy','Sad','Angry','Fearful','Disgusted','Surprised','Contempt'] });

    window.addEventListener('resize', () => WaveformRendererInstance.resizeAll());
  }

  /* ══ Camera Setup Phase ═══════════════════════════════════ */
  async function _startCameraSetup() {
    try {
      setupStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const feed = document.getElementById('cameraFeed');
      if (feed) { feed.srcObject = setupStream; await feed.play(); }
    } catch (e) {
      console.warn('Camera unavailable — running in simulation mode:', e.message);
      setupStream = null;
    }

    // Start signal processor for quality coaching
    const feed = document.getElementById('cameraFeed');
    if (feed && setupStream) {
      signalProcessor.start(feed);
      signalProcessor.addEventListener('frame', e => {
        if (document.getElementById('cameraSetup')?.classList.contains('active')) {
          UIController.updateCoachingChecks(e.packet);
        }
      });
    } else {
      // Simulation coaching — auto-passes after 2s
      setTimeout(() => {
        const btn = document.getElementById('btnStartScan');
        if (btn) btn.disabled = false;
        const hint = document.getElementById('faceHint');
        if (hint) hint.textContent = '✓ Simulation mode — ready';
        const qFill = document.getElementById('qualityFill');
        if (qFill) { qFill.style.width = '72%'; }
        const qVal = document.getElementById('qualityValue');
        if (qVal) qVal.textContent = '72%';
      }, 2000);
    }
  }

  function _stopCameraSetup() {
    signalProcessor.stop();
    if (setupStream) { setupStream.getTracks().forEach(t => t.stop()); setupStream = null; }
  }

  /* ══ Medical Scan Phase ═══════════════════════════════════ */
  async function _startMedicalScan() {
    UIController.showScreen('medicalScan');

    // Start camera on scan screen
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const feed = document.getElementById('medCameraFeed');
      if (feed) { feed.srcObject = scanStream; await feed.play(); }
    } catch(e) {
      console.warn('Scan camera unavailable — using simulation data');
      scanStream = null;
    }

    // Start face mesh renderer
    medFaceMesh = new FaceMeshRenderer(
      document.getElementById('medCameraFeed'),
      document.getElementById('medFaceMesh'),
      document.getElementById('medRoiOverlay')
    );
    medFaceMesh.start('medical');

    // Start signal processor → medical engine
    const feed = document.getElementById('medCameraFeed');
    if (feed && scanStream) {
      signalProcessor.start(feed);
      signalProcessor.addEventListener('frame', _onMedicalFrame);
    } else {
      _startMedicalSimulation();
    }

    medicalEngine.start();

    // Timer: 30 seconds → then finish
    UIController.startTimer('medical', () => _finishMedicalScan());
  }

  function _onMedicalFrame(e) {
    const packet = e.packet;
    // Feed to medical engine
    medicalEngine.processPacket(packet);
    // Waveform rendering
    const ppgLast = packet.ppg[packet.ppg.length - 1] ?? 0;
    WaveformRendererInstance.pushSample('ppgCanvas',  ppgLast);
    const respLast = packet.resp[packet.resp.length - 1] ?? 0;
    WaveformRendererInstance.pushSample('respCanvas', respLast);
    // Update scan quality bar
    UIController.updateScanQuality(packet.quality);
  }

  // Medical engine result → UI
  medicalEngine.addEventListener('result', e => {
    UIController.updateMedicalMetrics(e.result);
    medFaceMesh?.setBPM(e.result.bpm ?? 72);
  });

  function _startMedicalSimulation() {
    // Physiologically realistic simulation
    let phase = 0;
    simInterval = setInterval(() => {
      phase += 0.21; // ~1.0 Hz cardiac frequency at 30fps tick rate (200ms interval)
      const bpm       = 68 + Utils.gaussianRandom(0, 2);
      const ppg       = Math.sin(phase) * 0.6 + Utils.gaussianRandom(0, 0.05);
      const respPhase = phase * 0.2;
      const resp      = Math.sin(respPhase) * 0.15;

      WaveformRendererInstance.pushSample('ppgCanvas',  ppg);
      WaveformRendererInstance.pushSample('respCanvas', resp);

      // Feed a synthetic packet to the medical engine
      medicalEngine.processPacket({
        ppg:       [ppg],
        resp:      [resp],
        rois:      {},
        quality:   0.65 + Utils.gaussianRandom(0, 0.05),
        motion:    3   + Utils.gaussianRandom(0, 1),
        luminance: 110 + Utils.gaussianRandom(0, 5),
        lumStd:    12,
      });
    }, 200);
  }

  function _finishMedicalScan() {
    signalProcessor.stop();
    medFaceMesh?.stop();
    clearInterval(simInterval);
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    medicalResult = medicalEngine.stop();

    // If mental scan already done → show fusion, else go to mental scan
    if (mentalResult) {
      _showFusionResults();
    } else {
      // Prompt for mental scan
      _promptMentalScan();
    }
  }

  /* ══ Mental Scan Phase ════════════════════════════════════ */
  async function _startMentalScan() {
    UIController.showScreen('mentalScan');

    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const feed = document.getElementById('menCameraFeed');
      if (feed) { feed.srcObject = scanStream; await feed.play(); }
    } catch(e) {
      console.warn('Mental scan camera unavailable — using simulation');
      scanStream = null;
    }

    // Face mesh renderer with emotion overlay
    menFaceMesh = new FaceMeshRenderer(
      document.getElementById('menCameraFeed'),
      document.getElementById('menFaceMesh'),
      document.getElementById('emotionHeatmap')
    );
    menFaceMesh.start('mental');

    mentalEngine.start();

    if (scanStream) {
      // Run mental engine every frame via requestAnimationFrame loop
      _mentalFrameLoop();
    } else {
      _startMentalSimulation();
    }

    UIController.startTimer('mental', () => _finishMentalScan());
  }

  let _mentalLoopActive = false;
  function _mentalFrameLoop() {
    _mentalLoopActive = true;
    function tick() {
      if (!_mentalLoopActive) return;
      const lm = menFaceMesh?.getLandmarks();
      if (lm) {
        mentalEngine.setLandmarks(lm);
        menFaceMesh?.setAUActivations(mentalEngine.result?.auActivations);
      }
      mentalEngine.processFrame(0.7);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function _startMentalSimulation() {
    // Simulate AU activations and gradually changing emotional state
    let tick = 0;
    simInterval = setInterval(() => {
      tick++;
      const stress = 0.3 + 0.2 * Math.sin(tick * 0.03) + Utils.gaussianRandom(0, 0.05);
      const happy  = Math.max(0, 0.4 - stress * 0.5 + Utils.gaussianRandom(0, 0.04));
      const probs  = [
        (1 - stress - happy) * 0.6,  // Neutral
        happy,                         // Happy
        stress * 0.15,                 // Sad
        stress * 0.2,                  // Angry
        stress * 0.1,                  // Fearful
        stress * 0.05,                 // Disgusted
        0.03 + Utils.gaussianRandom(0, 0.01), // Surprised
        0.02,                          // Contempt
      ];
      const sum  = probs.reduce((a,b)=>a+b,0)||1;
      const norm = probs.map(p=>Math.max(0,p/sum));

      // Simulate mental result
      const simResult = {
        dominantEmotion:  ['Neutral','Happy','Sad','Angry','Fearful','Disgusted','Surprised','Contempt'][norm.indexOf(Math.max(...norm))],
        emotionProbs:     Object.fromEntries(['Neutral','Happy','Sad','Angry','Fearful','Disgusted','Surprised','Contempt'].map((e,i)=>[e,norm[i]])),
        auActivations:    { AU1: stress*0.4, AU2: stress*0.3, AU4: stress*0.6, AU6: happy*0.7, AU7: stress*0.5, AU12: happy*0.8, AU17: stress*0.2, AU20: stress*0.3, AU25: stress*0.1, AU26: 0.1 },
        stressIndex:      Utils.clamp(stress, 0, 1),
        anxietyIndex:     Utils.clamp(stress * 0.7, 0, 1),
        stabilityScore:   Utils.clamp(1 - stress * 0.5, 0, 1),
        engagementScore:  Utils.clamp(0.5 + happy * 0.4, 0, 1),
        cognitiveFatigue: Utils.clamp(stress * 0.4, 0, 1),
        confidences: { stress: 0.72, anxiety: 0.68, stability: 0.75, engagement: 0.70, cognitiveFatigue: 0.65 },
      };
      mentalResult = simResult; // keep updating
      UIController.updateMentalMetrics(simResult);
      WaveformRendererInstance.pushEmotionFrame('emotionTimeline', norm);
      menFaceMesh?.setAUActivations(simResult.auActivations);
    }, 200);
  }

  // Mental engine result → UI
  mentalEngine.addEventListener('result', e => {
    mentalResult = e.result;
    UIController.updateMentalMetrics(e.result);
    WaveformRendererInstance.pushEmotionFrame('emotionTimeline',
      Object.values(e.result.emotionProbs ?? {})
    );
    menFaceMesh?.setAUActivations(e.result.auActivations);
  });

  function _finishMentalScan() {
    _mentalLoopActive = false;
    menFaceMesh?.stop();
    clearInterval(simInterval);
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    if (!mentalResult) mentalResult = mentalEngine.stop();

    if (medicalResult) {
      _showFusionResults();
    } else {
      _promptMedicalScan();
    }
  }

  /* ══ Prompt for complementary scan ═══════════════════════ */
  function _promptMentalScan() {
    // Show a brief overlay then auto-start mental scan
    const overlay = _createPromptOverlay(
      'Medical scan complete.',
      'Proceed to Mental Health Scan for holistic fusion analysis?',
      'Start Mental Scan',
      () => { document.body.removeChild(overlay); _startMentalScan(); },
      'Skip — Show Partial Results',
      () => { document.body.removeChild(overlay); _showFusionResults(); }
    );
    document.body.appendChild(overlay);
  }

  function _promptMedicalScan() {
    const overlay = _createPromptOverlay(
      'Mental scan complete.',
      'Proceed to Medical Biosignal Scan for complete holistic analysis?',
      'Start Medical Scan',
      () => { document.body.removeChild(overlay); _startMedicalScan(); },
      'Skip — Show Partial Results',
      () => { document.body.removeChild(overlay); _showFusionResults(); }
    );
    document.body.appendChild(overlay);
  }

  function _createPromptOverlay(title, desc, primaryLabel, primaryFn, secondaryLabel, secondaryFn) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,0.88);backdrop-filter:blur(8px);
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;
    `;
    overlay.innerHTML = `
      <div style="max-width:480px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;">
        <h2 style="font-size:20px;font-weight:700;">${title}</h2>
        <p style="color:rgba(255,255,255,0.6);font-size:14px;">${desc}</p>
        <button id="promptPrimary" style="padding:12px 36px;background:white;color:black;font-weight:700;font-size:13px;border-radius:9999px;border:none;cursor:pointer;">${primaryLabel}</button>
        <button id="promptSecondary" style="padding:8px 24px;color:rgba(255,255,255,0.5);font-size:12px;border:none;background:none;cursor:pointer;text-decoration:underline;">${secondaryLabel}</button>
      </div>
    `;
    overlay.querySelector('#promptPrimary').addEventListener('click',   primaryFn);
    overlay.querySelector('#promptSecondary').addEventListener('click', secondaryFn);
    return overlay;
  }

  /* ══ Fusion results ═══════════════════════════════════════ */
  function _showFusionResults() {
    const fusionResult = fusionEngine.fuse(medicalResult, mentalResult);
    UIController.renderResults(fusionResult, medicalResult, mentalResult);
    UIController.showScreen('results');
  }

  /* ══ Full reset ═══════════════════════════════════════════ */
  function _fullReset() {
    signalProcessor.stop();
    medFaceMesh?.stop(); medFaceMesh = null;
    menFaceMesh?.stop(); menFaceMesh = null;
    UIController.stopTimer();
    clearInterval(simInterval);
    _mentalLoopActive = false;
    if (scanStream)  { scanStream.getTracks().forEach(t=>t.stop());  scanStream = null; }
    if (setupStream) { setupStream.getTracks().forEach(t=>t.stop()); setupStream = null; }
    medicalResult = null;
    mentalResult  = null;
    UIController.initSession();
  }

})();
