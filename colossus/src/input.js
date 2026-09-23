// Mouse + keyboard. Camera controls are shared; each side gets its own command scheme.
import * as THREE from 'three';
import { UNITS, UNIT_TYPES, POWERED, PRESETS, TANK, SYSTEMS } from './config.js';
import { clamp } from './util.js';

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
const PROD_KEYS = Object.fromEntries(UNIT_TYPES.map((t) => [UNITS[t].key, t]));

export class Input {
  constructor(G) {
    this.G = G;
    this.canvas = G.renderer.domElement;
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, over: false };
    this.drag = null;
    this.selEl = document.getElementById('selbox');
    this.lastClick = { t: 0, x: 0, y: 0 };
    this.lastGroupKey = { k: null, t: 0 };
    this.raycaster = new THREE.Raycaster();
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel(e); }, { passive: false });
    c.addEventListener('pointerenter', () => { this.mouse.over = true; });
    c.addEventListener('pointerleave', () => { this.mouse.over = false; });
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ------------------------------------------------------------ picking
  ray(sx, sy) {
    const ndc = { x: (sx / innerWidth) * 2 - 1, y: -(sy / innerHeight) * 2 + 1 };
    this.raycaster.setFromCamera(ndc, this.G.camera);
    return this.raycaster.ray;
  }
  ground(sx, sy) {
    const r = this.ray(sx, sy);
    return this.G.terrain.raycast(r.origin, r.direction, true);
  }
  planeAt(sx, sy, y) {
    const r = this.ray(sx, sy);
    const p = new THREE.Vector3();
    return r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
  }
  // ray vs the tank's box; returns local {lx, lz} of the hit or null
  pickTank(sx, sy) {
    const t = this.G.tank;
    if (!t || t.dead) return null;
    const r = this.ray(sx, sy);
    const c = Math.cos(t.heading), s = Math.sin(t.heading);
    const ox = r.origin.x - t.x, oz = r.origin.z - t.z, oy = r.origin.y - t.y;
    const o = [ox * c - oz * s, oy, ox * s + oz * c];
    const d = [r.direction.x * c - r.direction.z * s, r.direction.y, r.direction.x * s + r.direction.z * c];
    const mn = [-TANK.halfW - 0.8, -0.5, -TANK.halfL - 0.8], mx = [TANK.halfW + 0.8, 6.5, TANK.halfL + 0.8];
    let t0 = 0, t1 = 1e9;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return null; continue; }
      let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    return { lx: o[0] + d[0] * t0, lz: o[2] + d[2] * t0, ly: o[1] + d[1] * t0 };
  }
  pickStructure(sx, sy) {
    const r = this.ray(sx, sy);
    let best = null, bt = 1e9;
    const box = new THREE.Box3(), hit = new THREE.Vector3();
    for (const st of this.G.swarm.structures) {
      if (!st.alive) continue;
      box.min.set(st.x - st.half, st.y, st.z - st.half);
      box.max.set(st.x + st.half, st.y + st.height + 1, st.z + st.half);
      if (r.intersectBox(box, hit)) { const d = hit.distanceTo(r.origin); if (d < bt) { bt = d; best = st; } }
    }
    return best;
  }
  project(x, y, z, out) {
    out.set(x, y, z).project(this.G.camera);
    out.x = (out.x * 0.5 + 0.5) * innerWidth; out.y = (-out.y * 0.5 + 0.5) * innerHeight;
    return out;
  }
  pickUnit(sx, sy, px = 16) {
    const v = new THREE.Vector3();
    let best = null, bd = px;
    for (const u of this.G.swarm.units) {
      if (!u.alive) continue;
      this.project(u.x, u.y + 0.5, u.z, v);
      if (v.z > 1) continue;
      const d = Math.hypot(v.x - sx, v.y - sy);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  // ------------------------------------------------------------ mouse
  down(e) {
    const G = this.G;
    G.audio.ensure();
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    if (G.side === 'none' || G.over) {
      if (e.button === 0 || e.button === 2) this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, mode: 'orbit' };
      return;
    }
    const mode = e.button === 1 || (e.button === 0 && e.altKey) ? 'orbit' : e.button === 2 ? 'rmb' : 'lmb';
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, mode, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    if (mode === 'rmb') this.drag.plane = this.planeAt(e.clientX, e.clientY, G.cam.target.y);
    this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
  }
  move(e) {
    const G = this.G;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - (d.lx ?? d.x), dy = e.clientY - (d.ly ?? d.y);
    d.lx = e.clientX; d.ly = e.clientY;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
    if (!d.moved) return;
    if (d.mode === 'orbit') {
      G.cam.rotate(-dx * 0.006, dy * 0.005);
    } else if (d.mode === 'rmb') {
      // grab-the-ground panning
      if (d.plane) {
        const p = this.planeAt(e.clientX, e.clientY, G.cam.target.y);
        if (p) { G.cam.panWorld(d.plane.x - p.x, d.plane.z - p.z); G.cam.target.x = G.cam.want.x; G.cam.target.z = G.cam.want.z; }
      }
    } else if (d.mode === 'lmb' && G.side === 'swarm') {
      const x0 = Math.min(d.x, e.clientX), y0 = Math.min(d.y, e.clientY);
      const s = this.selEl.style;
      s.display = 'block'; s.left = x0 + 'px'; s.top = y0 + 'px';
      s.width = Math.abs(e.clientX - d.x) + 'px'; s.height = Math.abs(e.clientY - d.y) + 'px';
    }
  }
  up(e) {
    const d = this.drag;
    if (!d || e.button !== d.button) return;
    this.drag = null;
    this.selEl.style.display = 'none';
    const G = this.G;
    if (G.side === 'none' || G.over || d.mode === 'orbit') return;
    const shift = e.shiftKey || d.shift;
    if (d.mode === 'lmb') {
      if (d.moved && G.side === 'swarm') this.boxSelect(d.x, d.y, e.clientX, e.clientY, shift);
      else if (!d.moved) this.leftClick(e.clientX, e.clientY, shift);
    } else if (d.mode === 'rmb' && !d.moved) {
      this.rightClick(e.clientX, e.clientY, shift);
    }
  }
  wheel(e) {
    const G = this.G;
    const f = Math.exp(clamp(e.deltaY, -200, 200) * 0.0015);
    const g = this.ground(e.clientX, e.clientY);
    G.cam.zoom(f, g);
  }

  // ------------------------------------------------------------ clicks
  leftClick(sx, sy, shift) {
    const G = this.G;
    if (G.side === 'tank') {
      const t = G.tank;
      if (t.dead) return;
      const st = this.pickStructure(sx, sy);
      const u = st ? null : this.pickUnit(sx, sy, 14);
      if (st || u) {
        t.cannon.target = st || u; t.cannon.point = null;
        G.fx.ring((st || u).x, (st || u).y + 0.3, (st || u).z, st ? 7 : 2.5, 0.5, 0xff5a4a, 0.9);
        G.ui.toast(st ? `Main gun locked on ${st.name}` : `Main gun locked on ${UNITS[u.type].name}`);
        G.audio.play('click', {});
        return;
      }
      const g = this.ground(sx, sy);
      if (!g) return;
      t.cannon.target = null;
      t.cannon.point = { x: g.x, y: g.y, z: g.z, alive: true };
      t.cannon.pointT = 12;
      G.fx.ring(g.x, g.y + 0.2, g.z, 3, 0.6, 0xff5a4a, 0.9);
      G.audio.play('click', {});
      return;
    }
    // swarm
    const S = G.swarm;
    const now = performance.now();
    const dbl = now - this.lastClick.t < 320 && Math.hypot(sx - this.lastClick.x, sy - this.lastClick.y) < 10;
    this.lastClick = { t: now, x: sx, y: sy };
    const u = this.pickUnit(sx, sy, 16);
    if (u) {
      if (dbl) { this.selectTypeOnScreen(u.type, shift); return; }
      if (shift) { if (S.selected.has(u)) S.selected.delete(u); else S.selected.add(u); }
      else { S.selected.clear(); S.selected.add(u); }
      G.audio.play('click', {});
      return;
    }
    const st = this.pickStructure(sx, sy);
    if (st && st.kind === 'factory') {
      S.activeFactory = S.activeFactory === st ? null : st;
      if (!shift) S.selected.clear();
      G.ui.toast(S.activeFactory ? `Building at ${this.factoryName(st)} — right-click to set its rally point` : 'Building at: whichever factory is free');
      G.audio.play('click', {});
      return;
    }
    if (!shift) S.selected.clear();
  }
  factoryName(st) { return ['West', 'East', 'North'][this.G.swarm.structures.filter((s) => s.kind === 'factory').indexOf(st)] + ' factory'; }

  rightClick(sx, sy, shift) {
    const G = this.G;
    if (G.side === 'tank') {
      const t = G.tank;
      if (t.dead) return;
      const st = this.pickStructure(sx, sy);
      if (st) {
        t.ramStructure(st);
        G.fx.ring(st.x, st.y + 0.3, st.z, 8, 0.6, 0xffb03a, 0.9);
        G.ui.toast(`Ramming ${st.name}!`);
        G.audio.play('click', {});
        return;
      }
      const g = this.ground(sx, sy);
      if (!g) return;
      const ok = t.moveTo(g.x, g.z, shift);
      G.fx.ring(g.x, g.y + 0.2, g.z, 3, 0.6, ok ? 0x7dff8a : 0xff5a4a, 0.9);
      if (!ok) G.ui.toast("Can't drive there");
      G.audio.play(ok ? 'click' : 'deny', {});
      return;
    }
    const S = G.swarm;
    const sel = [...S.selected].filter((u) => u.alive);
    const hit = this.pickTank(sx, sy);
    if (sel.length && hit) {
      const b = Math.atan2(hit.lx, hit.lz);
      S.orderEngage(sel, b, Math.min(1.6, 0.4 + sel.length * 0.06));
      const [wx, wz] = G.tank.toWorld(hit.lx, hit.lz);
      G.fx.ring(wx, G.tank.y + 0.3, wz, 4, 0.6, 0xff5a4a, 0.9);
      const q = ['front', 'right', 'rear', 'left'][G.tank.quadrant(wx, wz)];
      G.ui.toast(`${sel.length} unit${sel.length > 1 ? 's' : ''} attacking the ${q}`);
      G.audio.play('click', {});
      return;
    }
    const g = this.ground(sx, sy);
    if (!g) return;
    if (sel.length) {
      S.orderMove(sel, g.x, g.z);
      G.fx.ring(g.x, g.y + 0.2, g.z, 2.5 + Math.sqrt(sel.length) * 0.6, 0.6, 0x7dff8a, 0.9);
      G.audio.play('click', {});
    } else if (S.activeFactory && S.activeFactory.alive) {
      S.activeFactory.rally = { x: g.x, z: g.z };
      G.fx.ring(g.x, g.y + 0.2, g.z, 3, 0.6, 0xffd166, 0.9);
      G.ui.toast('Rally point set');
      G.audio.play('click', {});
    } else {
      for (const f of S.factories) f.rally = { x: g.x, z: g.z };
      G.fx.ring(g.x, g.y + 0.2, g.z, 3, 0.6, 0xffd166, 0.9);
      G.ui.toast('Rally point set for all factories');
      G.audio.play('click', {});
    }
  }

  boxSelect(x0, y0, x1, y1, shift) {
    const S = this.G.swarm;
    const a = Math.min(x0, x1), b = Math.max(x0, x1), c = Math.min(y0, y1), d = Math.max(y0, y1);
    if (!shift) S.selected.clear();
    const v = new THREE.Vector3();
    for (const u of S.units) {
      if (!u.alive) continue;
      this.project(u.x, u.y + 0.4, u.z, v);
      if (v.z > 1) continue;
      if (v.x >= a && v.x <= b && v.y >= c && v.y <= d) S.selected.add(u);
    }
    if (S.selected.size) this.G.audio.play('click', {});
  }
  selectTypeOnScreen(type, add) {
    const S = this.G.swarm;
    if (!add) S.selected.clear();
    const v = new THREE.Vector3();
    for (const u of S.units) {
      if (!u.alive || u.type !== type) continue;
      this.project(u.x, u.y, u.z, v);
      if (v.z > 1 || v.x < 0 || v.y < 0 || v.x > innerWidth || v.y > innerHeight) continue;
      S.selected.add(u);
    }
  }

  // ------------------------------------------------------------ keyboard
  keydown(e) {
    const G = this.G;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    G.audio.ensure();
    const code = e.code;
    this.keys.add(code);
    if (code === 'Tab' || code === 'Space' || code.startsWith('Arrow') || code === 'F1') e.preventDefault();
    if (G.ui.helpOpen && (code === 'Escape' || code === 'F1' || code === 'Slash')) { G.ui.toggleHelp(false); return; }
    // global
    if (code === 'KeyP' || code === 'Pause') { G.togglePause(); return; }
    if (code === 'BracketLeft') { G.setSpeed(-1); return; }
    if (code === 'BracketRight') { G.setSpeed(1); return; }
    if (code === 'KeyM') { G.ui.toggleMute(); return; }
    if (code === 'F1' || code === 'Slash') { G.ui.toggleHelp(); return; }
    if (G.side === 'none' || G.over) return;
    if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) return;
    if (G.side === 'tank') this.tankKey(code, e);
    else this.swarmKey(code, e);
  }

  tankKey(code, e) {
    const G = this.G, t = G.tank, ui = G.ui;
    if (t.dead) return;
    const di = DIGITS.indexOf(code);
    if (di >= 0 && di < 5) {
      const sys = POWERED[di];
      const ok = e.shiftKey || e.ctrlKey ? t.removePower(sys) : t.addPower(sys);
      G.audio.play(ok ? 'power' : 'deny', { up: !(e.shiftKey || e.ctrlKey) });
      ui.pulse(sys);
      return;
    }
    if (PRESETS[code]) {
      t.applyPreset(PRESETS[code]);
      ui.toast(`Power preset: ${PRESETS[code].name}`);
      G.audio.play('power', {});
      for (const s of POWERED) ui.pulse(s);
      return;
    }
    switch (code) {
      case 'KeyG':
        if (t.setOverdrive(!t.overdrive)) { ui.toast(t.overdrive ? 'OVERDRIVE — watch the heat!' : 'Overdrive off'); G.audio.play('power', { up: t.overdrive }); }
        else G.audio.play('deny', {});
        break;
      case 'Tab':
        t.cannon.auto = !t.cannon.auto;
        ui.toast(`Main gun auto-fire ${t.cannon.auto ? 'ON' : 'OFF'}`);
        G.audio.play('click', {});
        break;
      case 'Space': {
        const g = this.ground(this.mouse.x, this.mouse.y);
        if (g) { t.shieldMode = 'manual'; t.shieldFocus = t.quadrant(g.x, g.z); }
        G.audio.play('click', {});
        break;
      }
      case 'KeyU': t.shieldMode = 'auto'; t.shieldFocus = -1; ui.toast('Shields: auto-focus'); G.audio.play('click', {}); break;
      case 'KeyR': {
        const order = [null, ...SYSTEMS];
        let i = order.indexOf(t.repairPin);
        t.repairPin = order[(i + 1) % order.length];
        ui.toast(t.repairPin ? `Repair drones pinned to ${t.repairPin}` : 'Repair drones: auto');
        G.audio.play('click', {});
        break;
      }
      case 'KeyF': G.cam.follow = G.cam.follow ? null : t; G.audio.play('click', {}); break;
      case 'KeyH': t.stop(); ui.toast('All stop'); G.audio.play('click', {}); break;
      case 'Escape': t.cannon.target = null; t.cannon.point = null; break;
      case 'Home': G.cam.focus(t.x, t.z); break;
    }
  }

  swarmKey(code, e) {
    const G = this.G, S = G.swarm, ui = G.ui;
    const sel = [...S.selected].filter((u) => u.alive);
    if (PROD_KEYS[code]) {
      const type = PROD_KEYS[code];
      const n = e.shiftKey ? 5 : 1;
      let made = 0, why = null;
      for (let k = 0; k < n; k++) { const r = S.queueUnit(type); if (r === 'ok') made++; else { why = r; break; } }
      if (made) { G.audio.play('pop', {}); ui.pulse(type); }
      else { G.audio.play('deny', {}); ui.toast(why === 'supply' ? 'Not enough supply' : why === 'cap' ? 'Unit cap reached' : 'No factory left!'); }
      return;
    }
    const di = DIGITS.indexOf(code);
    if (di >= 0) {
      const k = di + 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        S.groups[k] = new Set(sel);
        ui.toast(`Group ${k} set (${sel.length})`);
      } else {
        const g = S.groups[k];
        if (!g) return;
        if (!e.shiftKey) S.selected.clear();
        for (const u of g) if (u.alive) S.selected.add(u);
        const now = performance.now();
        if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 350) this.centerOn([...S.selected]);
        this.lastGroupKey = { k, t: now };
      }
      G.audio.play('click', {});
      return;
    }
    switch (code) {
      case 'KeyA':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); for (const u of S.units) if (u.alive) S.selected.add(u); }
        break;
      case 'KeyH': if (sel.length) { S.orderHold(sel); ui.toast('Hold position'); } break;
      case 'KeyT': if (sel.length) { S.orderScatter(sel); ui.toast('Scatter!'); } break;
      case 'KeyR': if (sel.length) { S.orderRetreat(sel); ui.toast('Fall back!'); } break;
      case 'KeyY': if (sel.length) { S.orderSurround(sel); ui.toast('Surround it!'); } break;
      case 'KeyG': if (sel.length) { S.orderEngage(sel, null); ui.toast('Engage from where you are'); } break;
      case 'KeyF': if (sel.length) this.centerOn(sel); else G.cam.focus(G.tank.x, G.tank.z); break;
      case 'Space': G.cam.focus(G.tank.x, G.tank.z); break;
      case 'Tab': {
        const fs = S.factories;
        if (!fs.length) break;
        const i = fs.indexOf(S.activeFactory);
        S.activeFactory = i + 1 >= fs.length ? null : fs[i + 1];
        ui.toast(S.activeFactory ? `Building at ${this.factoryName(S.activeFactory)}` : 'Building at: whichever factory is free');
        if (S.activeFactory) G.cam.focus(S.activeFactory.x, S.activeFactory.z);
        break;
      }
      case 'Escape': S.selected.clear(); break;
      default: return;
    }
    G.audio.play('click', {});
  }
  centerOn(units) {
    if (!units.length) return;
    let x = 0, z = 0;
    for (const u of units) { x += u.x; z += u.z; }
    this.G.cam.focus(x / units.length, z / units.length);
  }

  // ------------------------------------------------------------ per-frame
  update(dt) {
    const G = this.G, k = this.keys, cam = G.cam;
    const sp = (cam.dist * 0.9 + 12) * dt;
    const typing = false;
    if (typing) return;
    let px = 0, pz = 0;
    const wasd = G.side !== 'swarm' || !(k.has('ControlLeft') || k.has('ControlRight'));
    if (k.has('ArrowUp') || (wasd && k.has('KeyW'))) pz += 1;
    if (k.has('ArrowDown') || (wasd && k.has('KeyS'))) pz -= 1;
    if (k.has('ArrowLeft') || (wasd && k.has('KeyA') && !k.has('ControlLeft'))) px -= 1;
    if (k.has('ArrowRight') || (wasd && k.has('KeyD'))) px += 1;
    if (px || pz) cam.pan(px * sp, pz * sp);
    if (k.has('KeyQ')) cam.rotate(dt * 1.6, 0);
    if (k.has('KeyE')) cam.rotate(-dt * 1.6, 0);
    if (k.has('PageUp')) cam.rotate(0, dt);
    if (k.has('PageDown')) cam.rotate(0, -dt);
    if (k.has('Equal') || k.has('NumpadAdd')) cam.zoom(Math.exp(-dt * 1.5));
    if (k.has('Minus') || k.has('NumpadSubtract')) cam.zoom(Math.exp(dt * 1.5));
    // held Space = shield toward the cursor (tank)
    if (G.side === 'tank' && k.has('Space') && G.tank && !G.tank.dead) {
      const g = this.ground(this.mouse.x, this.mouse.y);
      if (g) { G.tank.shieldMode = 'manual'; G.tank.shieldFocus = G.tank.quadrant(g.x, g.z); }
    }
  }
}
