/**
 * player.js — AI Voice Response Playback
 *
 * Handles:
 * - Playing WAV audio returned by the backend
 * - Queue system (so responses don't overlap)
 * - Callbacks for UI state changes (playing, done, error)
 * - Volume control
 */

class AudioPlayer {
    constructor(options = {}) {
        this.options = {
            onPlay: null,   // () => void
            onEnd: null,   // () => void
            onError: null,   // (err) => void
            volume: 1.0,
            ...options,
        };

        this._audio = new Audio();
        this._queue = [];
        this._playing = false;

        this._audio.volume = this.options.volume;

        this._audio.onended = () => {
            this._playing = false;
            if (this.options.onEnd) this.options.onEnd();
            this._playNext();  // Auto-play next in queue
        };

        this._audio.onerror = (e) => {
            console.error("[Player] Audio error:", e);
            this._playing = false;
            if (this.options.onError) this.options.onError(e);
            this._playNext();
        };
    }

    /**
     * Play an audio URL immediately (or queue if something is playing).
     * @param {string} url - URL to the audio file (e.g. /audio/responses/response.wav)
     */
    play(url) {
        if (this._playing) {
            this._queue.push(url);
            console.log(`[Player] Queued: ${url}`);
        } else {
            this._playNow(url);
        }
    }

    /**
     * Stop playback and clear queue.
     */
    stop() {
        this._queue = [];
        this._playing = false;
        this._audio.pause();
        this._audio.currentTime = 0;
    }

    /**
     * Set volume (0.0 – 1.0).
     */
    setVolume(v) {
        this._audio.volume = Math.max(0, Math.min(1, v));
        this.options.volume = this._audio.volume;
    }

    get isPlaying() {
        return this._playing;
    }

    // ─────────────────────────────────────
    // Private
    // ─────────────────────────────────────

    _playNow(url) {
        // NOTE: TTS backend already appends ?t=timestamp to prevent stale cache.
        // Do NOT add another ?t= here — it would create a broken URL like url?t=111?t=222
        this._audio.src = url;
        this._audio.currentTime = 0;
        this._playing = true;

        const playPromise = this._audio.play();
        if (playPromise) {
            playPromise
                .then(() => {
                    console.log(`[Player] Playing: ${url}`);
                    if (this.options.onPlay) this.options.onPlay();
                })
                .catch(err => {
                    console.error("[Player] Play failed:", err);
                    this._playing = false;
                    if (this.options.onError) this.options.onError(err);
                });
        }
    }

    _playNext() {
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            this._playNow(next);
        }
    }
}

window.AudioPlayer = AudioPlayer;