// Tiny procedural sound kit (WebAudio). No samples; everything synthesised.
import { clamp } from './util.js';

export class Audio {
  constructor(G) {
    this.G = G;
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('colossus-muted') === '1'; } catch (e) { /* ignore */ }
    this.last = {};
    this.voices = 0;
    const unlock = () => { this.ensure(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine hum
    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 38;
    const ef = this.ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 180;
    this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
    this.engine.connect(ef); ef.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engine.start();
  }
  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('colossus-muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  // distance attenuation vs camera
  att(x, z) {
    const cam = this.G.cam;
    if (x === undefined || !cam) return { v: 1, pan: 0 };
    const d = Math.hypot(cam.target.x - x, cam.target.z - z);
    const v = clamp(1 - d / (50 + cam.dist * 0.9), 0, 1) * clamp(90 / (cam.dist + 30), 0.35, 1.3);
    // pan from camera right vector
    const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
    const pan = clamp(((x - cam.target.x) * rx + (z - cam.target.z) * rz) / (cam.dist * 0.6 + 10), -0.8, 0.8);
    return { v, pan };
  }

  play(name, o = {}) {
    if (!this.ctx || this.muted || this.G.fastForward) return;
    const now = this.ctx.currentTime;
    const gap = { mg: 0.05, flak: 0.045, gun: 0.06, clang: 0.05, shield: 0.06, explode: 0.03, crack: 0.08, dust: 0.1, missile: 0.08, emp: 0.25, pop: 0.04 }[name] || 0.02;
    if (this.last[name] && now - this.last[name] < gap) return;
    if (this.voices > 28) return;
    this.last[name] = now;
    const { v, pan } = this.att(o.x, o.z);
    const vol = (o.vol ?? 1) * v;
    if (vol < 0.02) return;
    const fn = this['s_' + name];
    if (fn) fn.call(this, now, vol, pan, o);
  }

  out(gain, pan, dur) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan;
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    this.voices++;
    setTimeout(() => { this.voices--; }, dur * 1000 + 50);
    return node;
  }
  noiseSrc(t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.playbackRate.value = rate;
    s.start(t, Math.random() * 0.5, dur);
    return s;
  }
  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  tone(t, type, f0, f1, dur, peak, dest, a = 0.005) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain(); this.env(g, t, a, peak, dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  noiseBurst(t, dur, filterType, f0, f1, peak, dest, q = 1, a = 0.005, rate = 1) {
    const s = this.noiseSrc(t, dur + 0.05, rate);
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain(); this.env(g, t, a, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest);
  }

  s_explode(t, vol, pan, o) {
    const s = o.size || 1;
    const dur = 0.5 + s * 0.6;
    const out = this.out(vol, pan, dur);
    this.noiseBurst(t, dur, 'lowpass', 1800 * Math.min(1.5, s), 90, 0.9, out, 0.7, 0.004, 0.7);
    this.tone(t, 'sine', 110 / Math.sqrt(s), 28, dur * 0.8, 0.9, out, 0.003);
  }
  s_cannon(t, vol, pan) {
    const out = this.out(vol, pan, 1.2);
    this.noiseBurst(t, 0.9, 'lowpass', 3000, 120, 1.0, out, 0.8, 0.002, 0.8);
    this.tone(t, 'sine', 90, 30, 0.7, 1.0, out, 0.002);
    this.tone(t, 'square', 180, 60, 0.12, 0.2, out, 0.002);
  }
  s_gun(t, vol, pan) {
    const out = this.out(vol * 0.5, pan, 0.3);
    this.noiseBurst(t, 0.18, 'bandpass', 2200, 500, 0.8, out, 1.2, 0.002);
    this.tone(t, 'square', 320, 120, 0.08, 0.25, out, 0.002);
  }
  s_mg(t, vol, pan) {
    const out = this.out(vol * 0.35, pan, 0.1);
    this.noiseBurst(t, 0.05, 'highpass', 3500, 2000, 0.8, out, 1, 0.001);
  }
  s_flak(t, vol, pan) {
    const out = this.out(vol * 0.35, pan, 0.15);
    this.noiseBurst(t, 0.07, 'bandpass', 1500, 700, 0.9, out, 2, 0.001);
    this.tone(t, 'triangle', 500, 200, 0.05, 0.3, out, 0.001);
  }
  s_missile(t, vol, pan) {
    const out = this.out(vol * 0.5, pan, 0.8);
    this.noiseBurst(t, 0.7, 'bandpass', 600, 2400, 0.7, out, 3, 0.02);
  }
  s_mortar(t, vol, pan) {
    const out = this.out(vol * 0.6, pan, 0.5);
    this.tone(t, 'sine', 220, 70, 0.3, 0.9, out, 0.002);
    this.noiseBurst(t, 0.2, 'lowpass', 900, 200, 0.5, out, 1, 0.002);
  }
  s_clang(t, vol, pan) {
    const out = this.out(vol * 0.35, pan, 0.5);
    for (const f of [820, 1330, 2150]) this.tone(t, 'square', f * (0.95 + Math.random() * 0.1), f * 0.8, 0.3, 0.12, out, 0.001);
    this.noiseBurst(t, 0.08, 'highpass', 4000, 3000, 0.4, out, 1, 0.001);
  }
  s_shield(t, vol, pan) {
    const out = this.out(vol * 0.3, pan, 0.4);
    this.tone(t, 'sine', 1800, 500, 0.25, 0.5, out, 0.002);
    this.tone(t, 'triangle', 2700, 900, 0.18, 0.2, out, 0.002);
  }
  s_crack(t, vol, pan) {
    const out = this.out(vol * 0.5, pan, 0.4);
    this.noiseBurst(t, 0.3, 'bandpass', 900, 300, 0.9, out, 2, 0.002, 0.6);
  }
  s_crush(t, vol, pan) {
    const out = this.out(vol * 0.6, pan, 0.5);
    this.noiseBurst(t, 0.4, 'lowpass', 1200, 150, 1, out, 3, 0.003, 0.5);
    this.tone(t, 'square', 160, 50, 0.25, 0.3, out, 0.002);
  }
  s_emp(t, vol, pan) {
    const out = this.out(vol * 0.25, pan, 0.4);
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 90 + Math.random() * 30;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 35; const lg = this.ctx.createGain(); lg.gain.value = 60;
    lfo.connect(lg); lg.connect(o.frequency);
    const g = this.ctx.createGain(); this.env(g, t, 0.02, 0.5, 0.35);
    o.connect(g); g.connect(out); o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
  }
  s_alarm(t, vol) {
    const out = this.out(vol * 0.3, 0, 0.6);
    this.tone(t, 'square', 880, 880, 0.14, 0.4, out, 0.005);
    this.tone(t + 0.18, 'square', 660, 660, 0.14, 0.4, out, 0.005);
  }
  s_click(t, vol) {
    const out = this.out(vol * 0.25, 0, 0.1);
    this.tone(t, 'triangle', 1200, 800, 0.05, 0.5, out, 0.001);
  }
  s_deny(t, vol) {
    const out = this.out(vol * 0.25, 0, 0.2);
    this.tone(t, 'square', 220, 180, 0.12, 0.4, out, 0.002);
  }
  s_pop(t, vol, pan) {
    const out = this.out(vol * 0.3, pan, 0.2);
    this.tone(t, 'sine', 500, 900, 0.1, 0.5, out, 0.002);
  }
  s_build(t, vol, pan) {
    const out = this.out(vol * 0.3, pan, 0.3);
    this.tone(t, 'triangle', 520, 1040, 0.08, 0.4, out, 0.002);
    this.tone(t + 0.07, 'triangle', 780, 1560, 0.1, 0.35, out, 0.002);
  }
  s_power(t, vol, pan, o) {
    const out = this.out(vol * 0.22, 0, 0.2);
    const up = o.up !== false;
    this.tone(t, 'sine', up ? 500 : 700, up ? 900 : 400, 0.09, 0.5, out, 0.002);
  }
  s_scram(t, vol) {
    const out = this.out(vol * 0.5, 0, 1.2);
    this.tone(t, 'sawtooth', 400, 40, 1.1, 0.5, out, 0.01);
  }

  engineLevel(level, x, z) {
    if (!this.ctx || !this.engineGain) return;
    const { v } = this.att(x, z);
    const target = this.muted ? 0 : level * v * 0.18;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    this.engine.frequency.setTargetAtTime(34 + level * 22, this.ctx.currentTime, 0.3);
  }
}
