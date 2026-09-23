// DOM HUD for both sides, world labels, log, toasts, help and end screens.
import * as THREE from 'three';
import { UNITS, UNIT_TYPES, POWERED, SYSTEMS, SYSTEM_INFO, TANK, PRESETS, SWARM } from './config.js';
import { buildUnitGeometry, litMat } from './models.js';
import { fmtTime, clamp } from './util.js';

const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const KEYS = ['1', '2', '3', '4', '5'];
const QN = ['Front', 'Right', 'Rear', 'Left'];

export class UI {
  constructor(G) {
    this.G = G;
    this.root = $('#hud');
    this.root.innerHTML = '';
    this.logEl = h('div', 'log'); this.root.appendChild(this.logEl);
    this.toastEl = h('div', 'toast'); this.root.appendChild(this.toastEl);
    this.labelsEl = $('#labels');
    this.helpOpen = false;
    this.t = 0;
    this.portraits = this.makePortraits();
    this.buildTop();
    if (G.side === 'tank') this.buildTank();
    if (G.side === 'swarm') this.buildSwarm();
    this.buildLabels();
    this.buildHelp();
    this.pausedEl = h('div', 'paused', '<b>PAUSED</b> <span>you can still give orders · P to resume</span>');
    this.root.appendChild(this.pausedEl);
  }

  // ------------------------------------------------------------ helpers
  log(msg, type = 'info', important = false) {
    if (this.G.fastForward) return;
    const e = h('div', 'msg ' + type + (important ? ' big' : ''), msg);
    this.logEl.prepend(e);
    while (this.logEl.children.length > 7) this.logEl.lastChild.remove();
    setTimeout(() => { e.classList.add('fade'); setTimeout(() => e.remove(), 600); }, important ? 8000 : 5500);
  }
  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }
  pulse(key) {
    const el = this.root.querySelector(`[data-k="${key}"]`);
    if (!el) return;
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  }
  toggleMute() {
    const m = this.G.audio.toggleMute();
    this.toast(m ? 'Sound off' : 'Sound on');
    const b = $('#btn-mute'); if (b) b.textContent = m ? '🔇' : '🔊';
  }

  makePortraits() {
    const G = this.G, out = {};
    try {
      const size = 96;
      const rt = new THREE.WebGLRenderTarget(size, size);
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
      const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(-2, 4, 3); scene.add(dl);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      cam.position.set(-2.6, 2.2, 3.0); cam.lookAt(0, 0.5, 0);
      const px = new Uint8Array(size * size * 4);
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      for (const t of UNIT_TYPES) {
        const m = new THREE.Mesh(buildUnitGeometry(t), litMat());
        m.rotation.y = 0.5;
        scene.add(m);
        G.renderer.setRenderTarget(rt);
        G.renderer.setClearColor(0x000000, 0);
        G.renderer.clear();
        G.renderer.render(scene, cam);
        G.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
        const img = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        ctx.putImageData(img, 0, 0);
        out[t] = cv.toDataURL();
        scene.remove(m);
      }
      G.renderer.setRenderTarget(null);
      rt.dispose();
    } catch (e) { console.warn('portraits failed', e); }
    return out;
  }

  // ------------------------------------------------------------ top bar
  buildTop() {
    const G = this.G;
    const top = h('div', 'topbar');
    const obj = G.side === 'tank' ? '🎯 Destroy the <b>Command Post</b>' : G.side === 'swarm' ? '🎯 Stop the <b>Colossus</b> before it flattens your Command Post' : '';
    top.innerHTML = `<div class="obj">${obj}</div><div class="clock"><span id="clock">0:00</span><span id="speed" class="speedtag"></span></div>
      <div class="btns"><button id="btn-pause" title="Pause (P)">⏸</button><button id="btn-slow" title="Slower ([)">−</button><button id="btn-fast" title="Faster (])">+</button>
      <button id="btn-mute" title="Mute (M)">${G.audio.muted ? '🔇' : '🔊'}</button><button id="btn-help" title="Help (F1 or ?)">?</button></div>`;
    if (G.side !== 'none') this.root.appendChild(top);
    $('#btn-pause', top).onclick = () => G.togglePause();
    $('#btn-slow', top).onclick = () => G.setSpeed(-1);
    $('#btn-fast', top).onclick = () => G.setSpeed(1);
    $('#btn-mute', top).onclick = () => this.toggleMute();
    $('#btn-help', top).onclick = () => this.toggleHelp();
    this.clockEl = $('#clock', top); this.speedEl = $('#speed', top);
  }

  // ------------------------------------------------------------ tank HUD
  buildTank() {
    const G = this.G, t = G.tank;
    const bar = h('div', 'tankhud');
    // reactor
    const rc = h('div', 'card reactor');
    rc.innerHTML = `<div class="ttl"><span class="ico">⚛️</span>Reactor<span class="st" id="r-st"></span></div>
      <div class="hp"><i id="r-hp"></i></div>
      <div class="out"><span id="r-out">12</span><small> power</small></div>
      <div class="pipsrow" id="r-pips"></div>
      <div class="heat"><span>HEAT</span><div class="hb"><i id="r-heat"></i></div></div>
      <button class="od" id="r-od" data-k="od">OVERDRIVE <kbd>G</kbd></button>`;
    bar.appendChild(rc);
    $('#r-od', rc).onclick = () => { if (t.setOverdrive(!t.overdrive)) G.audio.play('power', { up: t.overdrive }); };
    this.rPips = [];
    for (let n = 0; n < 16; n++) { const p = h('i'); $('#r-pips', rc).appendChild(p); this.rPips.push(p); }
    // systems
    this.sysEls = {};
    POWERED.forEach((s, i) => {
      const c = h('div', 'card sys');
      c.dataset.k = s;
      const info = SYSTEM_INFO[s];
      c.innerHTML = `<div class="ttl"><kbd>${KEYS[i]}</kbd><span class="ico">${info.icon}</span>${info.name}<span class="st"></span></div>
        <div class="hp"><i></i></div>
        <div class="pips"></div>
        <div class="sub"></div>
        <button class="pin" title="Pin repair drones here (R cycles)">🔧</button>`;
      c.title = info.hint + `\nClick pips to set power · ${KEYS[i]} = +1 · Shift+${KEYS[i]} = −1 · right-click = −1`;
      const pips = $('.pips', c);
      const pe = [];
      for (let n = 0; n < TANK.maxPower[s]; n++) {
        const p = h('b');
        p.onclick = (e) => { e.stopPropagation(); t.setPower(s, t.want[s] === n + 1 ? n : n + 1); G.audio.play('power', {}); this.pulse(s); };
        pips.appendChild(p); pe.push(p);
      }
      c.oncontextmenu = (e) => { e.preventDefault(); t.removePower(s); G.audio.play('power', { up: false }); this.pulse(s); };
      c.onclick = () => { t.addPower(s); G.audio.play('power', {}); this.pulse(s); };
      $('.pin', c).onclick = (e) => { e.stopPropagation(); t.repairPin = t.repairPin === s ? null : s; G.audio.play('click', {}); };
      bar.appendChild(c);
      this.sysEls[s] = { card: c, hp: $('.hp i', c), st: $('.st', c), pips: pe, sub: $('.sub', c), pin: $('.pin', c) };
    });
    // shields compass + hull
    const sc = h('div', 'card shieldcard');
    sc.innerHTML = `<div class="ttl">🛡️ Shields<span class="st" id="sh-mode"></span></div>
      <div class="compass"><div class="q q0" data-q="0"><i></i></div><div class="q q1" data-q="1"><i></i></div><div class="q q2" data-q="2"><i></i></div><div class="q q3" data-q="3"><i></i></div>
      <div class="hullglyph" title="Auto-focus (U)">AUTO</div></div>
      <div class="hint">click a side · hold <kbd>Space</kbd> = toward cursor</div>`;
    sc.querySelectorAll('.q').forEach((q) => {
      q.onclick = () => { t.shieldMode = 'manual'; t.shieldFocus = +q.dataset.q; G.audio.play('click', {}); };
    });
    $('.hullglyph', sc).onclick = () => { t.shieldMode = 'auto'; t.shieldFocus = -1; G.audio.play('click', {}); };
    bar.appendChild(sc);
    this.qEls = [...sc.querySelectorAll('.q')];
    this.shMode = $('#sh-mode', sc);
    const hc = h('div', 'card hullcard');
    hc.innerHTML = `<div class="ttl">HULL <span id="hull-n"></span></div><div class="hull"><i id="hull-b"></i></div>
      <div class="gun"><span>MAIN GUN</span><div class="hb"><i id="gun-b"></i></div><button id="gun-auto" title="Toggle auto-fire (Tab)">AUTO</button></div>
      <div class="presets"><button data-p="KeyZ"><kbd>Z</kbd>Assault</button><button data-p="KeyX"><kbd>X</kbd>Cruise</button><button data-p="KeyC"><kbd>C</kbd>Turtle</button></div>`;
    hc.querySelectorAll('.presets button').forEach((b) => {
      b.onclick = () => { t.applyPreset(PRESETS[b.dataset.p]); G.audio.play('power', {}); for (const s of POWERED) this.pulse(s); };
    });
    $('#gun-auto', hc).onclick = () => { t.cannon.auto = !t.cannon.auto; G.audio.play('click', {}); };
    bar.appendChild(hc);
    this.root.appendChild(bar);
    this.tankEls = { rOut: $('#r-out'), rHeat: $('#r-heat'), rHp: $('#r-hp'), rSt: $('#r-st'), od: $('#r-od'), hullN: $('#hull-n'), hullB: $('#hull-b'), gunB: $('#gun-b'), gunAuto: $('#gun-auto'), reactor: rc };
    // path line
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1, gapSize: 0.8, transparent: true, opacity: 0.8, depthTest: false }));
    this.pathLine.renderOrder = 10; this.pathLine.frustumCulled = false;
    G.scene.add(this.pathLine);
    this.rangeRing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
    this.rangeRing.renderOrder = 9; this.rangeRing.frustumCulled = false;
    G.scene.add(this.rangeRing);
  }

  updateTank() {
    const G = this.G, t = G.tank, E = this.tankEls;
    const out = t.output(), nom = t.nominalOutput(), used = t.usedTotal(), want = t.wantTotal();
    E.rOut.textContent = t.scram > 0 ? 'SCRAM' : `${used}/${out}`;
    for (let n = 0; n < 16; n++) {
      const p = this.rPips[n];
      p.className = n < used ? 'on' : n < out ? 'free' : n < want ? 'short' : n < nom ? 'dead' : 'none';
      if (t.overdrive && n >= nom - TANK.overdrive && n < nom) p.classList.add('od');
    }
    E.rHeat.style.width = clamp(t.heat, 0, 100) + '%';
    E.rHeat.className = t.heat > 80 ? 'hot' : t.heat > 55 ? 'warm' : '';
    this.sysStatus(E.rHp, E.rSt, t.sys.reactor, E.reactor);
    E.od.classList.toggle('on', t.overdrive);
    E.od.disabled = t.scram > 0;
    for (const s of POWERED) {
      const el = this.sysEls[s], S = t.sys[s];
      this.sysStatus(el.hp, el.st, S, el.card);
      el.pips.forEach((p, n) => { p.className = n < t.power[s] ? 'on' : n < t.want[s] ? 'short' : ''; });
      el.pin.classList.toggle('on', t.repairPin === s);
      el.card.classList.toggle('repairing', t.repairing === s);
      let sub = '';
      const e = t.eff(s);
      if (s === 'drive') sub = `${(TANK.speed[t.power.drive] * e).toFixed(1)} m/s`;
      if (s === 'cannon') sub = t.power.cannon && e ? `reload ${(TANK.reload[t.power.cannon] / Math.max(0.25, e)).toFixed(1)}s` : 'no power';
      if (s === 'flak') sub = t.power.flak && e ? `${(TANK.flakRate * TANK.flakMul[t.power.flak] * e * 4).toFixed(0)} rds/s` : 'no power';
      if (s === 'shield') sub = `${t.power.shield ? '+' + (TANK.shieldRegen[t.power.shield] * e).toFixed(0) : TANK.shieldRegen[0]}/s`;
      if (s === 'repair') sub = t.power.repair && e ? `${(TANK.repair[t.power.repair] * e).toFixed(0)} hp/s → ${t.repairing ? (SYSTEM_INFO[t.repairing]?.name || 'hull') : 'idle'}` : 'no power';
      el.sub.textContent = sub;
    }
    const sm = TANK.shieldMax;
    this.qEls.forEach((q, i) => {
      q.firstChild.style.transform = `scale(${clamp(t.shieldQ[i] / sm, 0, 1)})`;
      q.classList.toggle('focus', t.shieldMode === 'manual' && t.shieldFocus === i);
      q.classList.toggle('hit', t.hitFlash[i] > 0.1);
      q.classList.toggle('empty', t.shieldQ[i] < 5);
    });
    this.shMode.textContent = t.shieldMode === 'auto' ? 'AUTO' : 'AIMED';
    E.hullN.textContent = `${Math.ceil(t.hull)} / ${t.hullMax}`;
    E.hullB.style.width = (t.hull / t.hullMax * 100) + '%';
    E.hullB.className = t.hull / t.hullMax < 0.3 ? 'low' : t.hull / t.hullMax < 0.6 ? 'mid' : '';
    E.gunB.style.width = (t.cannon.reloadFrac * 100) + '%';
    E.gunB.className = t.cannon.reloadFrac >= 1 ? 'ready' : '';
    E.gunAuto.classList.toggle('on', t.cannon.auto);
  }
  sysStatus(hpEl, stEl, S, card) {
    hpEl.style.width = S.hp + '%';
    hpEl.className = S.hp < 30 ? 'low' : S.hp < 60 ? 'mid' : '';
    let st = '', cls = '';
    if (!S.online) { st = 'OFFLINE'; cls = 'off'; }
    else if (S.jam > 0) { st = 'JAMMED'; cls = 'jam'; }
    else if (S.hp < 60) { st = Math.round(S.hp) + '%'; cls = 'dmg'; }
    stEl.textContent = st;
    card.classList.toggle('offline', !S.online);
    card.classList.toggle('jammed', S.online && S.jam > 0);
    card.classList.toggle('flash', S.flash > 0.3);
  }

  // ------------------------------------------------------------ swarm HUD
  buildSwarm() {
    const G = this.G, S = G.swarm;
    const bar = h('div', 'swarmhud');
    const sup = h('div', 'card supply');
    sup.innerHTML = `<div class="ttl">SUPPLY</div><div class="big" id="sup-n">0</div><div class="inc" id="sup-i"></div><div class="cnt" id="sup-c"></div>`;
    bar.appendChild(sup);
    const prod = h('div', 'card prod');
    prod.innerHTML = `<div class="ttl">BUILD <small>(shift = ×5)</small><span class="fac" id="fac-tabs"></span></div><div class="row" id="prod-row"></div>`;
    bar.appendChild(prod);
    this.prodEls = {};
    for (const t of UNIT_TYPES) {
      const d = UNITS[t];
      const b = h('button', 'unitbtn');
      b.dataset.k = t;
      b.innerHTML = `<kbd>${d.label}</kbd><img src="${this.portraits[t] || ''}" alt=""><div class="nm">${d.name}</div><div class="cost">${d.cost}</div><div class="q"></div><div class="prog"><i></i></div>`;
      b.title = `${d.name} — ${d.role}\n${d.desc}\nHP ${d.hp} · range ${d.range}${d.dmg ? ' · dmg ' + d.dmg : ''} · cost ${d.cost}`;
      b.onclick = (e) => {
        const n = e.shiftKey ? 5 : 1;
        let ok = 0;
        for (let k = 0; k < n; k++) if (S.queueUnit(t) === 'ok') ok++;
        G.audio.play(ok ? 'pop' : 'deny', {});
        this.pulse(t);
      };
      $('#prod-row', prod).appendChild(b);
      this.prodEls[t] = { b, q: $('.q', b), prog: $('.prog i', b) };
    }
    // factory tabs
    const tabs = $('#fac-tabs', prod);
    const facs = S.structures.filter((s) => s.kind === 'factory');
    const auto = h('button', 'tab', 'Auto'); auto.onclick = () => { S.activeFactory = null; G.audio.play('click', {}); };
    tabs.appendChild(auto);
    this.facTabs = [{ el: auto, f: null }];
    ['West', 'East', 'North'].forEach((n, i) => {
      if (!facs[i]) return;
      const b = h('button', 'tab', `${n}<i></i>`);
      b.onclick = () => { S.activeFactory = facs[i]; G.cam.focus(facs[i].x, facs[i].z); G.audio.play('click', {}); };
      tabs.appendChild(b);
      this.facTabs.push({ el: b, f: facs[i] });
    });
    // selection + orders
    const sel = h('div', 'card sel');
    sel.innerHTML = `<div class="ttl">SELECTED <span id="sel-n"></span></div><div class="chips" id="sel-chips"></div>
      <div class="orders">
        <button data-o="G" title="Engage from where they are (G). Or right-click a side of the Colossus.">⚔️<kbd>G</kbd></button>
        <button data-o="Y" title="Surround — spread around all sides (Y)">🌀<kbd>Y</kbd></button>
        <button data-o="T" title="Scatter away from each other (T)">💨<kbd>T</kbd></button>
        <button data-o="H" title="Hold position (H)">✋<kbd>H</kbd></button>
        <button data-o="R" title="Fall back to base (R)">🏠<kbd>R</kbd></button>
      </div><div class="groups" id="groups"></div>`;
    sel.querySelectorAll('.orders button').forEach((b) => {
      b.onclick = () => {
        const u = [...S.selected].filter((x) => x.alive);
        if (!u.length) return;
        ({ G: () => S.orderEngage(u, null), Y: () => S.orderSurround(u), T: () => S.orderScatter(u), H: () => S.orderHold(u), R: () => S.orderRetreat(u) })[b.dataset.o]();
        G.audio.play('click', {});
      };
    });
    bar.appendChild(sel);
    this.root.appendChild(bar);
    this.swarmEls = { supN: $('#sup-n'), supI: $('#sup-i'), supC: $('#sup-c'), selN: $('#sel-n'), chips: $('#sel-chips'), groups: $('#groups') };
    // intel panel
    const intel = h('div', 'card intel');
    intel.innerHTML = `<div class="ttl">COLOSSUS INTEL</div><div class="tanksil"><div class="sq s0"></div><div class="sq s1"></div><div class="sq s2"></div><div class="sq s3"></div><div class="body"></div></div>
      <div class="ibars" id="intel-bars"></div><div class="ihull"><span>HULL</span><div class="hb"><i id="intel-hull"></i></div></div>
      <div class="ihint">Hit the side whose shield is down. Rear → reactor, sides → treads, above (mortars) → everything.</div>`;
    this.root.appendChild(intel);
    this.intelEls = { sq: [...intel.querySelectorAll('.sq')], hull: $('#intel-hull', intel), bars: {} };
    for (const s of SYSTEMS) {
      const r = h('div', 'ib', `<span>${SYSTEM_INFO[s].icon}</span><div class="hb"><i></i></div>`);
      r.title = SYSTEM_INFO[s].name;
      $('#intel-bars', intel).appendChild(r);
      this.intelEls.bars[s] = $('i', r);
    }
    // rally lines
    this.rallyLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd166, dashSize: 0.8, gapSize: 0.6, depthTest: false, transparent: true }));
    this.rallyLines.renderOrder = 10; this.rallyLines.frustumCulled = false;
    G.scene.add(this.rallyLines);
  }

  updateSwarm() {
    const G = this.G, S = G.swarm, E = this.swarmEls;
    E.supN.textContent = Math.floor(S.supply);
    E.supI.textContent = `+${S.income().toFixed(1)}/s`;
    E.supC.textContent = `${S.aliveCount()} units · ${S.queuedCount()} queued`;
    const qcount = {};
    const building = {};
    for (const f of S.structures) {
      if (!f.alive) continue;
      f.queue.forEach((t, i) => { qcount[t] = (qcount[t] || 0) + 1; if (i === 0) building[t] = Math.max(building[t] || 0, f.progress / UNITS[t].build); });
    }
    for (const t of UNIT_TYPES) {
      const el = this.prodEls[t];
      el.q.textContent = qcount[t] ? qcount[t] : '';
      el.prog.style.width = ((building[t] || 0) * 100) + '%';
      el.b.classList.toggle('poor', S.supply < UNITS[t].cost);
    }
    for (const tab of this.facTabs) {
      tab.el.classList.toggle('on', S.activeFactory === tab.f);
      if (tab.f) {
        tab.el.classList.toggle('dead', !tab.f.alive);
        const i = tab.el.querySelector('i');
        i.style.width = (tab.f.hp / tab.f.maxHp * 100) + '%';
        tab.el.dataset.q = tab.f.queue.length ? tab.f.queue.length : '';
      }
    }
    // selection chips
    const sel = [...S.selected].filter((u) => u.alive);
    E.selN.textContent = sel.length ? `(${sel.length})` : '— drag to select';
    const byType = {};
    for (const u of sel) byType[u.type] = (byType[u.type] || 0) + 1;
    const key = JSON.stringify(byType);
    if (key !== this.lastChipKey) {
      this.lastChipKey = key;
      E.chips.innerHTML = '';
      for (const t of UNIT_TYPES) {
        if (!byType[t]) continue;
        const c = h('button', 'chip', `<img src="${this.portraits[t] || ''}"><b>${byType[t]}</b>`);
        c.title = `${UNITS[t].name}: click = only these, shift-click = drop these`;
        c.onclick = (e) => {
          for (const u of [...S.selected]) if (e.shiftKey ? u.type === t : u.type !== t) S.selected.delete(u);
          G.audio.play('click', {});
        };
        E.chips.appendChild(c);
      }
    }
    // groups
    const gk = Object.keys(S.groups).map((k) => k + ':' + [...S.groups[k]].filter((u) => u.alive).length).join(',');
    if (gk !== this.lastGroupKey) {
      this.lastGroupKey = gk;
      E.groups.innerHTML = '';
      for (const k of Object.keys(S.groups)) {
        const n = [...S.groups[k]].filter((u) => u.alive).length;
        if (!n) continue;
        E.groups.appendChild(h('span', 'grp', `<kbd>${k}</kbd>${n}`));
      }
    }
    // intel
    const t = G.tank, I = this.intelEls;
    I.sq.forEach((q, i) => {
      const f = clamp(t.shieldQ[i] / TANK.shieldMax, 0, 1);
      q.style.opacity = 0.15 + f * 0.85;
      q.classList.toggle('down', f < 0.05);
      q.classList.toggle('hit', t.hitFlash[i] > 0.1);
    });
    I.hull.style.width = (t.hull / t.hullMax * 100) + '%';
    for (const s of SYSTEMS) {
      const b = I.bars[s];
      b.style.width = t.sys[s].hp + '%';
      b.className = !t.sys[s].online ? 'off' : t.sys[s].hp < 30 ? 'low' : t.sys[s].hp < 60 ? 'mid' : '';
    }
    // rally lines for factories
    const pts = [];
    for (const f of S.structures) {
      if (!f.alive || f.kind !== 'factory') continue;
      if (S.activeFactory && S.activeFactory !== f) continue;
      pts.push(f.x, f.y + 1, f.z - f.half, f.rally.x, G.terrain.surfaceAt(f.rally.x, f.rally.z) + 0.5, f.rally.z);
    }
    this.rallyLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.rallyLines.computeLineDistances();
  }

  // ------------------------------------------------------------ world labels
  buildLabels() {
    const G = this.G;
    this.labels = [];
    for (const st of G.swarm.structures) {
      const el = h('div', 'wlabel struct', `<div class="nm">${st.name}</div><div class="hb"><i></i></div><div class="qd"></div>`);
      this.labelsEl.appendChild(el);
      this.labels.push({ el, bar: $('.hb i', el), qd: $('.qd', el), st, y: st.height + 2.5 });
    }
    const tl = h('div', 'wlabel tanklbl', `<div class="nm">COLOSSUS</div><div class="hb"><i></i></div>`);
    this.labelsEl.appendChild(tl);
    this.tankLabel = { el: tl, bar: $('.hb i', tl) };
    this.lockEl = h('div', 'lock', '');
    this.labelsEl.appendChild(this.lockEl);
    this.v3 = new THREE.Vector3();
  }
  place(el, x, y, z) {
    const v = this.v3.set(x, y, z).project(this.G.camera);
    if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { el.style.display = 'none'; return false; }
    el.style.display = '';
    el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    return true;
  }
  updateLabels() {
    const G = this.G;
    const far = G.cam.dist > 170;
    for (const L of this.labels) {
      const st = L.st;
      if (!st.alive || G.side === 'none') { L.el.style.display = 'none'; continue; }
      if (!this.place(L.el, st.x, st.y + L.y, st.z)) continue;
      L.bar.style.width = (st.hp / st.maxHp * 100) + '%';
      L.el.classList.toggle('far', far);
      L.el.classList.toggle('active', G.swarm.activeFactory === st);
      L.el.classList.toggle('target', G.tank.cannon.target === st || G.tank.ram === st);
      L.qd.textContent = st.queue && st.queue.length ? `building ${UNITS[st.queue[0]].name} (+${st.queue.length - 1})` : '';
    }
    const t = G.tank;
    if (t.dead || G.side === 'none') this.tankLabel.el.style.display = 'none';
    else if (this.place(this.tankLabel.el, t.x, t.y + 11, t.z)) {
      this.tankLabel.bar.style.width = (t.hull / t.hullMax * 100) + '%';
      this.tankLabel.el.classList.toggle('far', far);
    }
    // cannon lock marker (tank side); a lighter one for auto-fire picks
    const manual = t.cannon.target || t.cannon.point;
    const tg = G.side === 'tank' && !t.dead ? (manual || (t.cannon.auto ? t.cannon.aim : null)) : null;
    if (tg && tg.alive !== false) {
      this.lockEl.className = 'lock' + (manual ? '' : ' auto') + (t.cannon.inRange ? '' : ' oor');
      this.place(this.lockEl, tg.x, (tg.y || 0) + (tg.height ? tg.height / 2 : 0.6), tg.z);
      this.lockEl.style.transform += ' translate(0, 50%)';
    } else this.lockEl.style.display = 'none';
  }

  updatePath() {
    if (!this.pathLine) return;
    const G = this.G, t = G.tank;
    // main gun range ring hugging the terrain
    // dashed ribbon, width scales with zoom so it stays readable
    const rp = [];
    if (!t.dead) {
      const [px, pz] = t.turretPivot();
      const R = TANK.cannonRange, w = Math.max(0.3, G.cam.dist * 0.004);
      const n = 144;
      const pt = (a, r) => { const x = px + Math.sin(a) * r, z = pz + Math.cos(a) * r; return [x, G.terrain.surfaceAt(Math.max(0, Math.min(127.9, x)), Math.max(0, Math.min(175.9, z))) + 0.35, z]; };
      for (let k = 0; k < n; k += 2) {
        const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
        const ex = px + Math.sin(a0) * R, ez = pz + Math.cos(a0) * R;
        if (ex < 0 || ez < 0 || ex > 128 || ez > 176) continue;
        const p0 = pt(a0, R - w), p1 = pt(a0, R + w), p2 = pt(a1, R + w), p3 = pt(a1, R - w);
        rp.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
      }
    }
    this.rangeRing.geometry.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    this.rangeRing.visible = rp.length > 0;
    const pts = [];
    if (!t.dead && (t.path.length || t.ram)) {
      pts.push(t.x, t.y + 0.6, t.z);
      for (const p of t.path) pts.push(p.x, G.terrain.surfaceAt(p.x, p.z) + 0.6, p.z);
      if (t.ram) pts.push(t.ram.x, t.ram.y + 1, t.ram.z);
    }
    this.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.pathLine.computeLineDistances();
    this.pathLine.visible = pts.length > 3;
  }

  // ------------------------------------------------------------ help / end
  buildHelp() {
    const G = this.G;
    const el = h('div', 'help');
    const common = `<h3>Camera</h3><ul>
      <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows — pan · <kbd>Q</kbd><kbd>E</kbd> — rotate</li>
      <li>Mouse wheel — zoom (toward cursor) · right-drag — grab & pan · middle-drag or Alt+drag — orbit</li>
      <li><kbd>P</kbd> pause (orders still work) · <kbd>[</kbd> <kbd>]</kbd> game speed · <kbd>M</kbd> mute</li></ul>`;
    const tank = `<h3>You are the Colossus</h3><p>Roll north and flatten the swarm's <b>Command Post</b>. Factories along the way are optional — but each one you wreck slows their reinforcements.</p>
      <ul><li><b>Right-click</b> ground — drive there (<kbd>Shift</kbd> adds waypoints) · right-click a building — ram it · <kbd>H</kbd> stop · <kbd>F</kbd> follow cam</li>
      <li><b>Left-click</b> — fire the main gun there / lock onto a unit or building · <kbd>Tab</kbd> toggles auto-fire</li>
      <li><kbd>1</kbd>–<kbd>5</kbd> add power to Treads / Gun / Flak / Shields / Repair · <kbd>Shift</kbd>+number removes. Adding when full steals from the fattest system.</li>
      <li><kbd>Z</kbd> Assault · <kbd>X</kbd> Cruise · <kbd>C</kbd> Turtle power presets</li>
      <li><kbd>G</kbd> Overdrive: +4 power but builds heat. At 100 heat the reactor SCRAMs (no power for 5s, reactor damage).</li>
      <li>Shields have four facings. Hold <kbd>Space</kbd> to pour regen toward the cursor, or click the compass. <kbd>U</kbd> = auto.</li>
      <li><kbd>R</kbd> cycles which system the repair drones fix (default: the worst one).</li></ul>
      <p class="tip">Where a hit lands depends on where it came from: <b>rear</b> hits the reactor, <b>sides</b> the treads, <b>front</b> the gun, mortars from <b>above</b> hit anything.</p>`;
    const swarm = `<h3>You are the Swarm</h3><p>Grind the Colossus down before it reaches your <b>Command Post</b>. You earn supply from your CP and each factory.</p>
      <ul><li><kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd><kbd>B</kbd><kbd>N</kbd> build units (<kbd>Shift</kbd> ×5). <kbd>Tab</kbd> or click a factory to pick where they're built; right-click ground with nothing selected sets the rally point.</li>
      <li><b>Left-drag</b> box select · click / <kbd>Shift</kbd>-click · double-click selects that type on screen · <kbd>Ctrl</kbd>+<kbd>A</kbd> all</li>
      <li><kbd>Ctrl</kbd>+number saves a group, number recalls it (double-tap to jump there)</li>
      <li><b>Right-click the Colossus</b> — attack <i>that side of it</i>: units circle around to the side you clicked.</li>
      <li><kbd>G</kbd> engage from where they are · <kbd>Y</kbd> surround · <kbd>T</kbd> scatter (dodge the main gun!) · <kbd>H</kbd> hold · <kbd>R</kbd> fall back</li></ul>
      <p class="tip">Watch the intel panel: hit the side whose shield is down. Rear hits wreck its reactor, side hits its treads. Flak eats missiles and Boomers — jam it or knock it out first.</p>`;
    el.innerHTML = `<div class="inner"><button class="x">✕</button>${G.side === 'swarm' ? swarm : G.side === 'tank' ? tank : tank + swarm}${common}</div>`;
    $('.x', el).onclick = () => this.toggleHelp(false);
    el.onclick = (e) => { if (e.target === el) this.toggleHelp(false); };
    document.body.appendChild(el);
    this.helpEl = el;
  }
  toggleHelp(v) {
    this.helpOpen = v === undefined ? !this.helpOpen : v;
    this.helpEl.classList.toggle('show', this.helpOpen);
  }

  showEnd(win, title, sub) {
    const G = this.G;
    const el = h('div', 'endscreen ' + (win ? 'win' : 'lose'));
    const s = G.stats, sw = G.swarm.stats, t = G.tank;
    el.innerHTML = `<div class="inner"><h1>${title}</h1><p>${sub}</p>
      <div class="stats">
        <div><b>${fmtTime(G.time)}</b><span>battle time</span></div>
        <div><b>${sw.built}</b><span>swarmers built</span></div>
        <div><b>${sw.lost}</b><span>swarmers destroyed</span></div>
        <div><b>${t.stats.crushed}</b><span>squished under treads</span></div>
        <div><b>${Math.round(t.stats.dmgTaken)}</b><span>hull damage taken</span></div>
        <div><b>${Math.round(s.shieldAbsorbed)}</b><span>absorbed by shields</span></div>
        <div><b>${s.intercepts}</b><span>missiles & shells shot down</span></div>
        <div><b>${s.houses}</b><span>cottages flattened</span></div>
      </div>
      <div class="btns"><button id="end-again">Play again</button><button id="end-swap">Switch sides</button><button id="end-title">Title</button><button id="end-look" class="ghost">Look around</button></div></div>`;
    document.body.appendChild(el);
    $('#end-again', el).onclick = () => G.restart(G.side);
    $('#end-swap', el).onclick = () => G.restart(G.side === 'tank' ? 'swarm' : 'tank');
    $('#end-title', el).onclick = () => G.restart(null);
    $('#end-look', el).onclick = () => { el.remove(); };
    requestAnimationFrame(() => el.classList.add('show'));
  }

  // ------------------------------------------------------------ contextual alerts
  alerts() {
    const G = this.G, t = G.tank;
    if (!t || t.dead || G.over || G.side === 'none') return;
    const now = G.time;
    const A = this.alertT || (this.alertT = {});
    const once = (key, gap, fn) => { if (A[key] === undefined || now - A[key] > gap) { A[key] = now; fn(); } };
    const QN = ['FRONT', 'RIGHT', 'REAR', 'LEFT'];
    for (let q = 0; q < 4; q++) {
      if (t.shieldQ[q] < 3 && t.sys.shield.online && t.dmgRecent[q] > 5) {
        if (G.side === 'tank') once('sh' + q, 12, () => this.log(`🛡️ ${QN[q]} shield is down!`, 'bad'));
        else once('sh' + q, 12, () => this.log(`🎯 Its ${QN[q]} shield is down — hit it there!`, 'good'));
      }
    }
    if (G.side === 'tank') {
      let n = 0, sx = 0, sz = 0;
      G.swarm.hash.query(t.x, t.z, 30, (u) => { if (u.type === 'sapper') { n++; sx += u.x; sz += u.z; } });
      if (n >= 2) once('sap', 10, () => this.log(`💣 ${n} Boomers closing in from the ${QN[t.quadrant(sx / n, sz / n)]}! (flak eats them)`, 'warn'));
      if (t.mortarDmg > 20) {
        let m = null, md = 1e9;
        for (const u of G.swarm.units) if (u.alive && u.type === 'mortar') { const d = Math.hypot(u.x - t.x, u.z - t.z); if (d < md) { md = d; m = u; } }
        if (m && md > TANK.cannonRange) once('mortar', 15, () => { this.log(`🎯 Mortars shelling you from the ${QN[t.quadrant(m.x, m.z)]} — out of gun range. Keep moving or go get them.`, 'warn'); G.minimap.ping(m.x, m.z, '#ff5a4a'); });
      }
      if (t.overdrive && t.heat > 82) once('heat', 6, () => this.log('🔥 Reactor overheating — drop overdrive (G)!', 'bad'));
    } else {
      for (const st of G.swarm.structures) {
        if (!st.alive) continue;
        if (st.lastHp !== undefined && st.hp < st.lastHp - 1) once('st' + st.id, 14, () => { this.log(`🏭 ${st.kind === 'cp' ? 'Command Post' : 'A factory'} is under fire!`, 'warn'); G.minimap.ping(st.x, st.z, '#ffd166'); });
        st.lastHp = st.hp;
      }
    }
  }

  // ------------------------------------------------------------ frame
  update(dt) {
    const G = this.G;
    this.t += dt;
    this.updateLabels();
    this.pausedEl.classList.toggle('show', G.paused && !G.over);
    if (this.t < 0.1) return;
    this.t = 0;
    if (this.clockEl) this.clockEl.textContent = fmtTime(G.time);
    if (this.speedEl) this.speedEl.textContent = G.paused ? 'PAUSED' : G.speed !== 1 ? `×${G.speed}` : '';
    this.alertAcc = (this.alertAcc || 0) + 1;
    if (this.alertAcc % 5 === 0) this.alerts();
    if (G.side === 'tank') { this.updateTank(); this.updatePath(); }
    if (G.side === 'swarm') this.updateSwarm();
  }
}
