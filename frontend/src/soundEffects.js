// Utilidad de Audio Nativa con Web Audio API (Cero dependencias externas)
let audioCtx = null;

const getAudioContext = () => {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

export const isSoundEnabled = () => {
  return localStorage.getItem('bot_sound_enabled') !== 'false';
};

export const setSoundEnabled = (enabled) => {
  localStorage.setItem('bot_sound_enabled', enabled ? 'true' : 'false');
};

const playTone = (freq, duration, type = 'sine', gainVal = 0.15, delay = 0) => {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const startTime = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(gainVal, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  } catch (e) {
    console.debug('Audio play blocked or unavailable:', e);
  }
};

// 🟢 Sonido de Take Profit (Chime alegre de ganancia)
export const playProfitSound = () => {
  playTone(880, 0.15, 'triangle', 0.15, 0);     // A5
  playTone(1108.73, 0.15, 'triangle', 0.15, 0.08); // C#6
  playTone(1318.51, 0.35, 'sine', 0.2, 0.16);   // E6
};

// 🛡️ Sonido de Re-entrada DCA (Tono armónico de compra de seguridad)
export const playDcaSound = () => {
  playTone(587.33, 0.18, 'triangle', 0.15, 0);  // D5
  playTone(880.00, 0.28, 'sine', 0.18, 0.1);    // A5
};

// 🔵 Sonido de Apertura de Posición (Ping sutil)
export const playEntrySound = () => {
  playTone(659.25, 0.22, 'sine', 0.15, 0);      // E5
};

// 🛑 Sonido de Stop Loss (Tono suave de protección)
export const playLossSound = () => {
  playTone(440, 0.18, 'sawtooth', 0.08, 0);     // A4
  playTone(329.63, 0.30, 'sine', 0.12, 0.12);   // E4
};
