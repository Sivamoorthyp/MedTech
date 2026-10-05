/**
 * app.js — Main Frontend Application Logic
 *
 * Wires together:
 * - AudioRecorder (mic capture)
 * - AudioPlayer  (response playback)
 * - API calls to FastAPI backend
 * - UI state management
 * - Conversation display
 */

// ─────────────────────────────────────────
// Navigation helpers
// ─────────────────────────────────────────
function goBack(e) {
    if (e) e.preventDefault();
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = '/';
    }
}

// ─────────────────────────────────────────
// State
// ─────────────────────────────────────────
const state = {
    sessionId: null,
    isRecording: false,
    isProcessing: false,
    turnCount: 0,
    messages: [],   // { role, text, emotion, timestamp }
};

// ─────────────────────────────────────────
// Instances
// ─────────────────────────────────────────
const recorder = new AudioRecorder();
const player = new AudioPlayer({
    onPlay: () => setStatus("speaking", "AI is speaking..."),
    onEnd: () => {
        setStatus("idle", "Your turn — press and hold to talk");
        enableRecordButton(true);
    },
    onError: () => {
        setStatus("idle", "Audio playback error — press Start to talk again");
        enableRecordButton(true);
    },
});

// ─────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────
function initSession() {
    // Generate or restore session ID (survives page refresh within same tab)
    state.sessionId = sessionStorage.getItem("sessionId") || generateId();
    sessionStorage.setItem("sessionId", state.sessionId);
    console.log("[App] Session:", state.sessionId);
}

function generateId() {
    return "sess_" + Math.random().toString(36).slice(2, 11);
}

// Navigate back to MindPulse home page
function goBack(e) {
    if (e) e.preventDefault();
    // Try browser history first (works when opened via link from index.html)
    if (window.history.length > 1) {
        window.history.back();
    } else {
        // Fallback: if opened directly, attempt to close tab or go to root
        window.close();
    }
}

// ─────────────────────────────────────────
// Recording Controls
// ─────────────────────────────────────────
async function startRecording() {
    if (state.isRecording || state.isProcessing) return;

    const result = await recorder.start();
    if (!result.success) {
        showError("Microphone access denied. Please allow mic permissions.");
        return;
    }

    state.isRecording = true;
    setStatus("recording", "Listening... press Stop when done");
    enableRecordButton(false);
    enableStopButton(true);

    // Visual: pulsing indicator
    document.getElementById("recordBtn").classList.add("recording");

    // Volume meter animation
    startVolumeMeter();
}

async function stopRecording() {
    if (!state.isRecording) return;

    state.isRecording = false;
    stopVolumeMeter();

    document.getElementById("recordBtn").classList.remove("recording");
    enableStopButton(false);
    setStatus("processing", "Processing your message...");

    const result = await recorder.stop();
    if (!result || result.blob.size < 1000) {
        setStatus("idle", "No audio detected. Try again.");
        enableRecordButton(true);
        return;
    }

    await sendAudio(result.blob);
}

// ─────────────────────────────────────────
// API Communication
// ─────────────────────────────────────────
async function sendAudio(blob) {
    state.isProcessing = true;

    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    formData.append("session_id", state.sessionId);

    try {
        showTypingIndicator(true);
        const res = await fetch("/process", { method: "POST", body: formData });
        const data = await res.json();
        showTypingIndicator(false);

        if (!data.transcript && data.error) {
            showError("Something went wrong: " + data.error);
            enableRecordButton(true);
            return;
        }

        // Update UI with response
        handleResponse(data);

    } catch (err) {
        showTypingIndicator(false);
        console.error("[App] Fetch error:", err);
        showError("Network error. Is the server running?");
        enableRecordButton(true);
    } finally {
        state.isProcessing = false;
    }
}

async function sendTextMessage() {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;
    
    input.value = "";
    state.isProcessing = true;
    
    // Add user message instantly
    addMessage({
        role: "user",
        text: text,
        timestamp: new Date(),
    });
    
    showTypingIndicator(true);
    setStatus("processing", "Processing your message...");
    
    const formData = new FormData();
    formData.append("text", text);
    formData.append("session_id", state.sessionId);
    
    try {
        const res = await fetch("/chat", { method: "POST", body: formData });
        const data = await res.json();
        showTypingIndicator(false);
        
        if (data.error) {
            showError("Something went wrong: " + data.error);
            return;
        }
        
        // Call handleResponse but skip adding the user message since we already did it
        handleResponse(data, true);
    } catch (err) {
        showTypingIndicator(false);
        console.error("[App] Fetch error:", err);
        showError("Network error. Is the server running?");
    } finally {
        state.isProcessing = false;
    }
}

function handleEnter(e) {
    if (e.key === "Enter") {
        sendTextMessage();
    }
}

// ─────────────────────────────────────────
// Response Handling
// ─────────────────────────────────────────
function handleResponse(data, skipUserMessage = false) {
    // Add user message to chat ONLY if not already added (e.g., from voice where we wait for transcript)
    if (!skipUserMessage) {
        addMessage({
            role: "user",
            text: data.transcript,
            emotion: data.emotion,
            scores: data.emotion_scores,
            intent: data.intent,
            timestamp: new Date(),
        });
    }

    // Add assistant message to chat
    addMessage({
        role: "assistant",
        text: data.reply,
        timestamp: new Date(),
        isCrisis: data.is_crisis,
    });

    // Update emotion display
    updateEmotionDisplay(data.emotion, data.emotion_scores);

    // Update turn counter
    state.turnCount = data.turn_number;
    const turnEl = document.getElementById("turnCount");
    if (turnEl) turnEl.textContent = state.turnCount;

    // Show timing info (dev mode)
    if (data.pipeline_ms) {
        console.log(`[App] Pipeline: ${data.pipeline_ms.toFixed(0)}ms`, data.stages);
    }

    // Play AI voice response
    if (data.audio_url) {
        setStatus("speaking", "AI is speaking...");
        player.play(data.audio_url);
    } else {
        enableRecordButton(true);
        setStatus("idle", "Your turn — press Start to talk");
    }
}

// ─────────────────────────────────────────
// Chat UI
// ─────────────────────────────────────────
function addMessage({ role, text, emotion, scores, intent, timestamp, isCrisis }) {
    const chat = document.getElementById("chatLog");

    // Clear empty state if present
    const empty = chat.querySelector('.empty-message');
    if (empty) empty.remove();

    const msgEl = document.createElement("div");
    msgEl.classList.add("message", role);
    if (isCrisis) msgEl.classList.add("crisis");

    const emotionTag = (role === "user" && emotion && emotion !== "Neutral")
        ? `<span class="emotion-tag">${emotionIcon(emotion)} ${emotion}</span>`
        : "";

    const crisisTag = isCrisis
        ? `<div class="crisis-notice">⚠️ Crisis support response</div>`
        : "";

    msgEl.innerHTML = `
        <div class="bubble">
            ${emotionTag}
            <p>${formatMessage(text)}</p>
            ${crisisTag}
            <span class="time">${formatTime(timestamp)}</span>
        </div>
    `;

    chat.appendChild(msgEl);
    chat.scrollTop = chat.scrollHeight;

    // Animate in
    requestAnimationFrame(() => msgEl.classList.add("visible"));

    state.messages.push({ role, text, emotion, timestamp });
}

function showTypingIndicator(show) {
    const existing = document.getElementById("typingIndicator");
    if (show && !existing) {
        const chat = document.getElementById("chatLog");
        const el = document.createElement("div");
        el.id = "typingIndicator";
        el.classList.add("message", "assistant");
        el.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
        chat.appendChild(el);
        chat.scrollTop = chat.scrollHeight;
        requestAnimationFrame(() => el.classList.add("visible"));
    } else if (!show && existing) {
        existing.remove();
    }
}

// ─────────────────────────────────────────
// Emotion Display
// ─────────────────────────────────────────
function updateEmotionDisplay(dominant, scores) {
    const el = document.getElementById("emotionDisplay");
    if (!el || !scores) return;

    const domEl = el.querySelector("#dominantEmotion");
    if (domEl) domEl.textContent = `${emotionIcon(dominant)} ${dominant}`;

    // Update bars
    Object.entries(scores).forEach(([emotion, score]) => {
        const bar = el.querySelector(`[data-emotion="${emotion}"] .bar-fill`);
        if (bar) {
            bar.style.width = `${Math.round(score * 100)}%`;
        }
    });
}

// ─────────────────────────────────────────
// Volume Meter
// ─────────────────────────────────────────
let _volumeAnimId = null;

function startVolumeMeter() {
    const meter = document.getElementById("volumeMeter");
    if (!meter) return;

    function loop() {
        const vol = recorder.getVolume();
        meter.style.width = `${Math.round(vol * 100)}%`;
        _volumeAnimId = requestAnimationFrame(loop);
    }
    loop();
}

function stopVolumeMeter() {
    if (_volumeAnimId) cancelAnimationFrame(_volumeAnimId);
    const meter = document.getElementById("volumeMeter");
    if (meter) meter.style.width = "0%";
}

// ─────────────────────────────────────────
// Session Controls
// ─────────────────────────────────────────
async function resetConversation() {
    if (!confirm("Start a new conversation? Current history will be cleared.")) return;

    await fetch("/session/reset", {
        method: "POST",
        body: new URLSearchParams({ session_id: state.sessionId }),
    });

    document.getElementById("chatLog").innerHTML =
        '<div class="empty-message">How are you feeling today?</div>';
    state.messages = [];
    state.turnCount = 0;
    document.getElementById("turnCount").textContent = "0";
    setStatus("idle", "Fresh start! Press Start to talk.");
    updateEmotionDisplay("Neutral", { Happy: 0, Sad: 0, Angry: 0, Fear: 0, Surprise: 0 });
}

// ─────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────
function setStatus(type, message) {
    const textEl = document.getElementById('statusText');
    const dotEl = document.getElementById('statusDot');
    if (textEl) textEl.textContent = message;
    if (dotEl) dotEl.className = type || '';
}

function enableRecordButton(enabled) {
    const btn = document.getElementById("recordBtn");
    if (btn) btn.disabled = !enabled;
}

function enableStopButton(enabled) {
    const btn = document.getElementById("stopBtn");
    if (btn) btn.disabled = !enabled;
}

function showError(msg) {
    const el = document.getElementById("errorToast");
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 4000);
}

function emotionIcon(emotion) {
    const icons = {
        Happy: "😊",
        Sad: "😢",
        Angry: "😠",
        Fear: "😨",
        Surprise: "😲",
        Neutral: "😐",
    };
    return icons[emotion] || "💬";
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * formatMessage — renders plain-text structured medical report as clean HTML.
 *
 * Handles:
 *   - Divider lines (=====... or ===---...)  → section separator (hidden)
 *   - Section titles (line after a divider)  → green bold heading
 *   - Bullet lines ("- item")               → <li> list items
 *   - Normal lines                          → paragraph text
 */
function formatMessage(text) {
    if (!text) return '';

    // Normalize Windows \r\n and lone \r to Unix \n
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const isMedical = normalized.includes('========================================');

    if (!isMedical) {
        // Casual reply — simple <br> separated text
        return normalized
            .split('\n')
            .map(function(l) { return l.trim() === '' ? '' : escapeHtml(l.trim()); })
            .filter(function(l) { return l.length > 0; })
            .join('<br>');
    }

    // ── Medical report: structured rendering ──────────────────
    const lines = normalized.split('\n');
    let html = '';
    let inList = false;
    let prevWasDivider = false;

    // Matches divider lines: only =, -, or space characters, at least 8 chars
    const dividerRe = /^[=\-\s]{8,}$/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // ── Divider line ──────────────────────────────────────
        if (dividerRe.test(line) && line.length >= 8) {
            if (inList) { html += '</ul>'; inList = false; }
            prevWasDivider = true;
            continue; // hide the === line itself
        }

        // ── Section title (first non-empty line after a divider) ──
        if (prevWasDivider) {
            prevWasDivider = false;
            if (line.length === 0) continue;
            if (inList) { html += '</ul>'; inList = false; }
            html += '<div class="report-section-title">' + escapeHtml(line) + '</div>';
            continue;
        }

        // ── Bullet point ──────────────────────────────────────
        if (line.startsWith('- ') || line.startsWith('* ')) {
            if (!inList) { html += '<ul class="report-bullets">'; inList = true; }
            html += '<li>' + escapeHtml(line.slice(2)) + '</li>';
            continue;
        }

        // ── Numbered bullet ───────────────────────────────────
        if (/^\d+[.)]\s/.test(line)) {
            if (!inList) { html += '<ul class="report-bullets">'; inList = true; }
            html += '<li>' + escapeHtml(line.replace(/^\d+[.)]\s+/, '')) + '</li>';
            continue;
        }

        // Close open list before any non-bullet content
        if (inList) { html += '</ul>'; inList = false; }

        // ── Blank line ────────────────────────────────────────
        if (line === '') continue;

        // ── Normal paragraph text ─────────────────────────────
        html += '<p class="report-text">' + escapeHtml(line) + '</p>';
    }

    if (inList) html += '</ul>';
    return html;
}

// ─────────────────────────────────────────
// Init
// ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initSession();
    enableStopButton(false);
    setStatus("idle", "Press Start to begin talking");

    if (window.location.protocol === "file:") {
        showError("Warning: index.html opened as local file. Please open http://localhost:8000 in your browser instead.");
        setStatus("error", "Error: Open http://localhost:8000 in browser");
    }

    // Keyboard shortcut: Space to toggle recording
    document.addEventListener("keydown", (e) => {
        if (e.code === "Space" && e.target.tagName !== "INPUT") {
            e.preventDefault();
            if (!state.isRecording && !state.isProcessing) startRecording();
        }
    });
    document.addEventListener("keyup", (e) => {
        if (e.code === "Space" && state.isRecording) stopRecording();
    });
});