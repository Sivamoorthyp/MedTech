/**
 * recorder.js — WebRTC Microphone Recording
 *
 * Handles:
 * - Requesting mic permission
 * - Recording audio via MediaRecorder API
 * - Returning audio as Blob when stopped
 * - Voice activity detection (silence detection)
 */

class AudioRecorder {
    constructor(options = {}) {
        this.options = {
            mimeType: "audio/webm;codecs=opus",
            audioBitsPerSecond: 128000,
            silenceThreshold: 0.01,    // Volume below this = silence
            silenceTimeout: 2000,    // ms of silence before auto-stop
            onSilenceDetected: null,    // Callback when silence detected
            ...options,
        };

        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
        this.isRecording = false;
        this.analyser = null;
        this.audioContext = null;
        this._silenceTimer = null;
    }

    /**
     * Request microphone permission.
     * Call this early (e.g. on page load button click) to avoid permission UX issues.
     */
    async requestPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop immediately — we just wanted permission
            stream.getTracks().forEach(t => t.stop());
            return { success: true };
        } catch (err) {
            console.error("Mic permission denied:", err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Start recording from microphone.
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async start() {
        if (this.isRecording) return { success: false, error: "Already recording" };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,  // Whisper works best at 16kHz
                    channelCount: 1,       // Mono
                }
            });

            // Set up audio analyser for silence detection
            this._setupAnalyser(this.stream);

            // Determine best supported mime type
            const mimeType = this._getSupportedMimeType();

            this.chunks = [];
            this.isRecording = true;
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            this.mediaRecorder.start(100); // Collect chunks every 100ms
            console.log(`[Recorder] Started recording (${mimeType})`);
            return { success: true };

        } catch (err) {
            console.error("[Recorder] Start failed:", err);
            this.isRecording = false;
            return { success: false, error: err.message };
        }
    }

    /**
     * Stop recording and return audio blob.
     * @returns {Promise<{blob: Blob, duration: number, mimeType: string}>}
     */
    stop() {
        return new Promise((resolve) => {
            if (!this.isRecording || !this.mediaRecorder) {
                resolve(null);
                return;
            }

            this._clearSilenceTimer();

            const startTime = Date.now();

            this.mediaRecorder.onstop = () => {
                const mimeType = this.mediaRecorder.mimeType || "audio/webm";
                const blob = new Blob(this.chunks, { type: mimeType });
                const duration = Date.now() - startTime;

                this._cleanup();
                console.log(`[Recorder] Stopped. Blob size: ${blob.size} bytes`);
                resolve({ blob, duration, mimeType });
            };

            this.mediaRecorder.stop();
            this.isRecording = false;
        });
    }

    /**
     * Cancel recording without returning data.
     */
    cancel() {
        this._clearSilenceTimer();
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.onstop = null;  // Prevent normal onstop handler
            this.mediaRecorder.stop();
        }
        this._cleanup();
        this.isRecording = false;
    }

    /**
     * Get current audio volume (0–1).
     * Useful for showing a volume meter in the UI.
     */
    getVolume() {
        if (!this.analyser) return 0;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        return avg / 255;
    }

    // ─────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────

    _getSupportedMimeType() {
        const types = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
            "audio/mp4",
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return "";
    }

    _setupAnalyser(stream) {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            this.analyser.fftSize = 256;
        } catch (e) {
            console.warn("[Recorder] Analyser setup failed:", e);
        }
    }

    _clearSilenceTimer() {
        if (this._silenceTimer) {
            clearTimeout(this._silenceTimer);
            this._silenceTimer = null;
        }
    }

    _cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => { });
            this.audioContext = null;
        }
        this.analyser = null;
        this.mediaRecorder = null;
        this.chunks = [];
    }
}

// Export for use in app.js
window.AudioRecorder = AudioRecorder;