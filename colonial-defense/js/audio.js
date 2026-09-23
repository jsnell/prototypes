'use strict';
// ---------- tiny procedural sound engine ----------
const SFX = {
  ctx: null, master: null, vol: 0.5, muted: false, last: {}, noise: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.vol;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2; const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // ambient wind
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = c.createGain(); g.gain.value = 0.05; this.windGain = g;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; },
  env(g, t, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); },
  out(x, vol) {
    const c = this.ctx, g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = x === undefined ? 0 : clamp((x / W) * 2 - 1, -1, 1) * 0.7; g.connect(p); p.connect(this.master); } else g.connect(this.master);
    g.gain.value = vol; return g;
  },
  nz(t, dur, type, freq, q, dest) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    s.connect(f); f.connect(dest); s.start(t, Math.random() * 1.5, dur + 0.05); return f;
  },
  osc(t, dur, type, f0, f1, dest) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.connect(dest); o.start(t); o.stop(t + dur + 0.05); return o;
  },
  play(name, x, vol = 1) {
    if (!this.ctx || this.muted || (G && G.demo && name !== 'click')) return;
    const c = this.ctx, t = c.currentTime;
    const minGap = { mg: 0.035, rifle: 0.05, flame: 0.12, boom: 0.06, squelch: 0.05, clang: 0.08, tink: 0.05, spit: 0.1, skitter: 0.15, scream: 0.3, burrow: 0.2 }[name] || 0.02;
    if (this.last[name] && t - this.last[name] < minGap) return;
    this.last[name] = t;
    const S = this[name]; if (S) S.call(this, t, x, vol);
  },
  mg(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.002, 0.25 * v, 0.06); this.nz(t, 0.08, 'bandpass', 1800 + Math.random() * 600, 1.2, g); this.osc(t, 0.04, 'square', 180, 60, g); },
  rifle(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.002, 0.18 * v, 0.05); this.nz(t, 0.06, 'highpass', 2500, 1, g); this.osc(t, 0.05, 'sawtooth', 320, 90, g); },
  cannon(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.003, 0.5 * v, 0.3); this.nz(t, 0.3, 'lowpass', 900, 1, g); this.osc(t, 0.25, 'sine', 120, 40, g); },
  boom(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.005, 0.6 * v, 0.7); this.nz(t, 0.8, 'lowpass', 500, 1, g); this.osc(t, 0.5, 'sine', 90, 30, g); },
  bigboom(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.01, 0.9 * v, 1.8); this.nz(t, 2, 'lowpass', 300, 1, g); this.osc(t, 1.2, 'sine', 60, 20, g); },
  nuke(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.02, 1.0, 5); this.nz(t, 5, 'lowpass', 180, 1, g); this.osc(t, 4, 'sine', 45, 15, g); },
  mortar(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.003, 0.4 * v, 0.25); this.nz(t, 0.25, 'bandpass', 400, 2, g); this.osc(t, 0.15, 'sine', 200, 80, g); },
  rail(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.002, 0.4 * v, 0.5); this.osc(t, 0.5, 'sawtooth', 2400, 80, g); this.nz(t, 0.2, 'highpass', 4000, 1, g); },
  flame(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.02, 0.2 * v, 0.15); this.nz(t, 0.2, 'lowpass', 700, 0.7, g); },
  squelch(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.005, 0.25 * v, 0.15); this.nz(t, 0.15, 'bandpass', 300 + Math.random() * 400, 4, g); },
  clang(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.002, 0.12 * v, 0.2); this.osc(t, 0.2, 'triangle', 700 + Math.random() * 300, 500, g); },
  tink(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.001, 0.08 * v, 0.06); this.osc(t, 0.06, 'sine', 4000 + Math.random() * 1500, 0, g); },
  spit(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.01, 0.15 * v, 0.2); this.nz(t, 0.2, 'bandpass', 1200, 3, g); },
  skitter(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.01, 0.1 * v, 0.1); this.nz(t, 0.12, 'highpass', 5000, 1, g); },
  burrow(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.05, 0.3 * v, 0.5); this.nz(t, 0.6, 'lowpass', 200, 1, g); },
  scream(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.02, 0.12 * v, 0.4); this.osc(t, 0.45, 'sawtooth', 700, 300, g); },
  screech(t, x, v) { const g = this.out(x, 0); this.env(g, t, 0.05, 0.35 * v, 1.2); const f = this.nz(t, 1.3, 'bandpass', 2000, 8, g); f.frequency.exponentialRampToValueAtTime(600, t + 1.2); this.osc(t, 1.2, 'sawtooth', 900, 400, g); },
  klaxon(t) { for (let i = 0; i < 3; i++) { const g = this.out(undefined, 0); this.env(g, t + i * 0.7, 0.05, 0.18, 0.55); this.osc(t + i * 0.7, 0.6, 'square', 440, 0, g); this.osc(t + i * 0.7 + 0.3, 0.3, 'square', 330, 0, g); } },
  siren(t) { const g = this.out(undefined, 0); this.env(g, t, 0.1, 0.25, 2.9); const o = this.osc(t, 3, 'sawtooth', 300, 0, g); for (let i = 0; i < 6; i++) { o.frequency.linearRampToValueAtTime(700, t + i * 0.5 + 0.25); o.frequency.linearRampToValueAtTime(300, t + i * 0.5 + 0.5); } },
  dawn(t) { const g = this.out(undefined, 0); this.env(g, t, 0.3, 0.12, 2); this.osc(t, 2.2, 'sine', 330, 0, g); this.osc(t + 0.3, 1.9, 'sine', 495, 0, g); },
  ping(t, x, v) { for (let i = 0; i < 2; i++) { const g = this.out(undefined, 0); this.env(g, t + i * 0.9, 0.005, 0.25, 0.35); this.osc(t + i * 0.9, 0.4, 'sine', 1180, 0, g); } },
  blip(t) { const g = this.out(undefined, 0); this.env(g, t, 0.003, 0.1, 0.08); this.osc(t, 0.1, 'sine', 1600, 0, g); },
  flare(t, x) { const g = this.out(x, 0); this.env(g, t, 0.01, 0.25, 0.5); this.nz(t, 0.5, 'bandpass', 2500, 2, g); },
  charge(t, x) { const g = this.out(x, 0); this.env(g, t, 1.4, 0.2, 0.2); this.osc(t, 1.6, 'sine', 200, 1800, g); },
  whistle(t, x) { const g = this.out(x, 0); this.env(g, t, 0.9, 0.18, 0.2); this.osc(t, 1.1, 'sine', 2500, 500, g); },
  jet(t, x) { const g = this.out(x, 0); this.env(g, t, 0.6, 0.35, 1.8); const f = this.nz(t, 2.5, 'bandpass', 600, 1, g); f.frequency.exponentialRampToValueAtTime(2500, t + 0.8); f.frequency.exponentialRampToValueAtTime(300, t + 2.4); },
  claim(t) { const g = this.out(undefined, 0); this.env(g, t, 0.01, 0.15, 0.4); this.osc(t, 0.2, 'square', 523, 0, g); this.osc(t + 0.1, 0.3, 'square', 784, 0, g); },
  build(t) { const g = this.out(undefined, 0); this.env(g, t, 0.003, 0.2, 0.15); this.osc(t, 0.15, 'triangle', 220, 110, g); this.nz(t, 0.08, 'lowpass', 1500, 1, g); },
  sell(t) { const g = this.out(undefined, 0); this.env(g, t, 0.003, 0.12, 0.2); this.osc(t, 0.2, 'triangle', 440, 880, g); },
  deny(t) { const g = this.out(undefined, 0); this.env(g, t, 0.003, 0.12, 0.15); this.osc(t, 0.15, 'square', 150, 0, g); },
  click(t) { const g = this.out(undefined, 0); this.env(g, t, 0.001, 0.08, 0.04); this.osc(t, 0.04, 'square', 900, 0, g); },
};
