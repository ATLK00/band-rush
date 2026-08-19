/**
 * sound.js
 * Tiny Web Audio API sound-effect generator. No external mp3/wav files
 * are required — every effect is a synthesized tone, which keeps the
 * game runnable out of the box. Swap in <audio> elements + real SFX
 * files later by editing the functions below if you prefer real sound.
 */

let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function beep({ freq = 440, duration = 0.12, type = "sine", gain = 0.18, delay = 0 }) {
  try {
    const c = ctx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(c.destination);
    const start = c.currentTime + delay;
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  } catch (e) {
    // Autoplay policies may block audio before first user gesture — safe to ignore.
  }
}

const SFX = {
  flip: () => beep({ freq: 520, duration: 0.09, type: "triangle", gain: 0.15 }),
  match: () => {
    beep({ freq: 660, duration: 0.12, type: "sine", gain: 0.2 });
    beep({ freq: 880, duration: 0.18, type: "sine", gain: 0.2, delay: 0.1 });
  },
  wrong: () => beep({ freq: 200, duration: 0.22, type: "sawtooth", gain: 0.15 }),
  vote: () => beep({ freq: 400, duration: 0.08, type: "square", gain: 0.12 }),
  item: () => {
    beep({ freq: 300, duration: 0.1, type: "square", gain: 0.16 });
    beep({ freq: 500, duration: 0.1, type: "square", gain: 0.16, delay: 0.08 });
  },
  freeze: () => {
    beep({ freq: 900, duration: 0.3, type: "sine", gain: 0.18 });
    beep({ freq: 700, duration: 0.3, type: "sine", gain: 0.18, delay: 0.15 });
  },
  finish: () => {
    [523, 659, 784, 1046].forEach((f, i) => beep({ freq: f, duration: 0.2, type: "sine", gain: 0.2, delay: i * 0.12 }));
  },
};
