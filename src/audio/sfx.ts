// Synthesised sound effects (Web Audio). No audio files, no licensing worries.
// The game is fully playable with sound off.

let ctx: AudioContext | null = null;
let enabled = true;

export function setSound(on: boolean): void {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, delay = 0, slide = 0): void {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.08, delay = 0, lowpass = 800): void {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  click: () => tone(660, 0.06, 'triangle', 0.06),
  coin: () => { tone(988, 0.08, 'square', 0.05); tone(1319, 0.14, 'square', 0.05, 0.07); },
  spend: () => tone(330, 0.12, 'triangle', 0.06, 0, -80),
  good: () => { tone(523, 0.1, 'triangle', 0.08); tone(659, 0.1, 'triangle', 0.08, 0.08); tone(784, 0.16, 'triangle', 0.08, 0.16); },
  bad: () => { tone(300, 0.18, 'sawtooth', 0.05, 0, -120); },
  notify: () => { tone(880, 0.08, 'sine', 0.07); tone(1175, 0.12, 'sine', 0.07, 0.09); },
  mission: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, i * 0.09)); },
  gen: () => { noise(0.9, 0.12, 0, 300); tone(70, 0.9, 'sawtooth', 0.04); },
  powerOff: () => { tone(440, 0.4, 'sine', 0.08, 0, -380); },
  powerOn: () => { tone(220, 0.25, 'sine', 0.07, 0, 500); },
  gavel: () => { noise(0.08, 0.3, 0, 1500); tone(180, 0.12, 'square', 0.06); },
  vote: (yes: boolean) => tone(yes ? 740 : 260, 0.12, 'triangle', 0.07),
  // Story Mode
  boing: () => { tone(420, 0.22, 'sine', 0.09, 0, 260); tone(300, 0.18, 'sine', 0.06, 0.12, -120); },
  sputter: () => { for (let i = 0; i < 3; i++) { noise(0.07, 0.18, i * 0.11, 500); tone(60, 0.07, 'square', 0.05, i * 0.11); } },
  drum: () => { tone(110, 0.16, 'sine', 0.2, 0, -50); tone(160, 0.1, 'sine', 0.14, 0.22, -60); },
  thunder: () => { noise(1.6, 0.28, 0, 180); noise(0.9, 0.18, 0.3, 400); },
  goat: () => { for (let i = 0; i < 4; i++) tone(520 - i * 8, 0.09, 'sawtooth', 0.04, i * 0.08); },
  splash: () => { noise(0.35, 0.14, 0, 2400); tone(900, 0.12, 'sine', 0.04, 0.05, -500); },
  cheer: () => { noise(0.9, 0.06, 0, 3000); [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.2, 'triangle', 0.07, i * 0.07)); },
  star: () => tone(1568, 0.22, 'triangle', 0.07, 0, 400),
  night: () => { tone(392, 0.3, 'sine', 0.05); tone(330, 0.4, 'sine', 0.05, 0.25); },
};
