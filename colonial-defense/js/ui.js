'use strict';
// ---------- HUD, input, overlay ----------
const UI = { tool: null, special: null, drag: null, mouse: { x: -99, y: -99, in: false }, sel: null, screen: 'menu', ov: null, ctx: null, hudT: 0 };
const $ = id => document.getElementById(id);
const SPEC_GLYPH = { flare: '✦', tracker: '◎', orbital: '⊕', napalm: '♨', drop: '⬇', gunship: '✈', nuke: '☢' };

function spriteIcon(names, scale = 3, frame = 0, facing = 0) {
  const c = document.createElement('canvas');
  const regs = names.map(n => SPR[n].r[Math.min(frame, SPR[n].frames - 1)][Math.min(facing, SPR[n].facings - 1)]);
  const w = Math.max(...regs.map(r => r.w)), h = Math.max(...regs.map(r => r.h));
  c.width = w; c.height = h;
  const cx = c.getContext('2d'); const img = cx.createImageData(w, h);
  for (const r of regs) {
    const ox = Math.floor((w - r.w) / 2), oy = Math.floor((h - r.h) / 2);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const si = ((r.y + y) * ATLAS + r.x + x) * 4; if (Atlas.alb[si + 3] < 128) continue;
      const di = ((oy + y) * w + ox + x) * 4;
      // fake top-left lighting from the normal map so icons read
      const nx = Atlas.nrm[si] / 127.5 - 1, ny = Atlas.nrm[si + 1] / 127.5 - 1;
      const l = 0.75 + (-nx - ny) * 0.5, e = Atlas.emi[si] + Atlas.emi[si + 1] + Atlas.emi[si + 2];
      for (let k = 0; k < 3; k++) img.data[di + k] = Math.min(255, Atlas.alb[si + k] * l * 1.3 + Atlas.emi[si + k]);
      img.data[di + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  c.style.width = (w * scale) + 'px'; c.style.height = (h * scale) + 'px';
  return c;
}

function buildHUD() {
  const host = $('build');
  host.querySelectorAll('.tool').forEach(e => e.remove());
  const icons = { wall: ['wall'], sentry: ['tbase', 'sentry'], light: ['light'], extractor: ['extractor'], habitat: ['habitat'], barracks: ['barracks'], flamer: ['tbase', 'flamer'], mortar: ['mortarbase'], railgun: ['railbase', 'rail'] };
  for (const type of BUILD_ORDER) {
    const d = BUILDINGS[type];
    const locked = d.locked && !G.opts.unlocked?.['b_' + type];
    const el = document.createElement('div'); el.className = 'tool' + (locked ? ' locked' : ''); el.dataset.type = type;
    const big = d.w > 1 || type === 'railgun';
    const ic = spriteIcon(icons[type], big ? 2 : 4, type === 'wall' ? 10 : 0, 0);
    el.appendChild(ic);
    el.insertAdjacentHTML('beforeend', `<span class="k">${d.key}</span><span class="c">${d.cost}</span>`);
    el.onclick = () => { if (!locked) selectTool(type); };
    el.onmouseenter = ev => showTip(ev, `<h4>${d.name}</h4>${d.desc}<br><span style="color:var(--warn)">${d.cost} materiel</span>${locked ? '<br><span style="color:var(--bad)">Locked — requisition it between scenarios</span>' : ''}`);
    el.onmouseleave = hideTip;
    host.appendChild(el);
  }
  const sp = $('specials'); sp.innerHTML = '';
  for (const id of SPECIAL_ORDER) {
    const d = SPECIALS[id], s = G.spec[id];
    const el = document.createElement('div'); el.className = 'tool' + (s.locked ? ' locked' : ''); el.dataset.sp = id;
    el.innerHTML = `<span class="k">${d.key}</span><span class="ch"></span><div class="glyph">${SPEC_GLYPH[id]}</div><span>${d.name.split(' ')[0]}</span><div class="cdv"></div>`;
    el.onclick = () => armSpecial(id);
    el.onmouseenter = ev => showTip(ev, `<h4>${d.name} [${d.key}]</h4>${d.desc}<br><span style="color:var(--dim)">cooldown ${d.cd > 999 ? 'once per scenario' : Math.round(d.cd * G.cdMult) + 's'}</span>${s.locked ? '<br><span style="color:var(--bad)">Locked — requisition it between scenarios</span>' : ''}`);
    el.onmouseleave = hideTip;
    sp.appendChild(el);
  }
}
function showTip(ev, html) { const t = $('tip'); t.innerHTML = html; t.style.display = 'block'; const r = ev.currentTarget.getBoundingClientRect(); t.style.left = Math.min(innerWidth - 290, r.left) + 'px'; t.style.top = (r.top - t.offsetHeight - 8) + 'px'; }
function hideTip() { $('tip').style.display = 'none'; }
function selectTool(type) {
  if (G.phase !== 'lull') { SFX.play('deny'); return; }
  UI.special = null; UI.sel = null;
  UI.tool = UI.tool === type ? null : type; SFX.play('click');
}
function armSpecial(id) {
  if (!specialReady(id)) { SFX.play('deny'); return; }
  UI.tool = null;
  if (SPECIALS[id].noTarget) { useSpecial(id, 0, 0); return; }
  UI.special = UI.special === id ? null : id; SFX.play('click');
}
function cancelAll() { UI.tool = null; UI.special = null; UI.drag = null; UI.sel = null; }

function footprint(type, gx, gy) {
  const d = BUILDINGS[type];
  return { tx: Math.floor(gx / TILE - d.w / 2 + 0.5), ty: Math.floor(gy / TILE - d.h / 2 + 0.5), w: d.w, h: d.h };
}
function lineTiles(x0, y0, x1, y1) {
  const out = []; let x = x0, y = y0; const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let err = dx - dy; out.push([x, y]);
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy && (Math.abs(e2 + dy) < Math.abs(e2 - dx) || e2 >= dx)) { err -= dy; x += sx; }
    else { err += dx; y += sy; }
    out.push([x, y]);
    if (out.length > 200) break;
  }
  return out;
}
function hoveredSector() {
  const tx = Math.floor(UI.mouse.x / TILE), ty = Math.floor(UI.mouse.y / TILE);
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return null;
  return G.map.sectors[G.map.sectorOf[ty * GW + tx]];
}

function initInput() {
  const ov = $('ov'); UI.ov = ov; UI.ctx = ov.getContext('2d');
  const toGame = ev => { const r = ov.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H }; };
  ov.addEventListener('contextmenu', e => e.preventDefault());
  ov.addEventListener('mousemove', ev => { const p = toGame(ev); UI.mouse.x = p.x; UI.mouse.y = p.y; UI.mouse.in = true; });
  ov.addEventListener('mouseleave', () => { UI.mouse.in = false; });
  ov.addEventListener('mousedown', ev => {
    SFX.init();
    if (UI.screen !== 'game' || !G || G.over) return;
    const p = toGame(ev);
    if (ev.button === 2) { cancelAll(); return; }
    if (UI.special) { if (useSpecial(UI.special, p.x, p.y)) { if (!ev.shiftKey || !specialReady(UI.special)) UI.special = null; } return; }
    if (UI.tool) {
      if (G.phase !== 'lull') { UI.tool = null; return; }
      if (BUILDINGS[UI.tool].drag) { UI.drag = { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) }; return; }
      const f = footprint(UI.tool, p.x, p.y);
      if (G.res < BUILDINGS[UI.tool].cost) { msg('Not enough materiel', '#f86'); SFX.play('deny'); return; }
      if (placeBuilding(UI.tool, f.tx, f.ty)) SFX.play('build'); else SFX.play('deny');
      return;
    }
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const b = (tx >= 0 && ty >= 0 && tx < GW && ty < GH) ? G.occ[ty * GW + tx] : null;
    if (b) { UI.sel = b; SFX.play('click'); return; }
    UI.sel = null;
    const s = hoveredSector();
    if (s && canClaim(s)) tryClaim(s);
  });
  window.addEventListener('mouseup', ev => {
    if (UI.drag && UI.tool && G) {
      const tx = Math.floor(UI.mouse.x / TILE), ty = Math.floor(UI.mouse.y / TILE);
      let n = 0;
      for (const [x, y] of lineTiles(UI.drag.tx, UI.drag.ty, tx, ty)) if (placeBuilding(UI.tool, x, y)) n++;
      if (n) SFX.play('build'); else SFX.play('deny');
    }
    UI.drag = null;
  });
  window.addEventListener('keydown', ev => {
    SFX.init();
    if (UI.screen !== 'game' || !G) return;
    const k = ev.key.toUpperCase();
    if (k === 'ESCAPE') { cancelAll(); return; }
    if (k === ' ') { G.paused = !G.paused; ev.preventDefault(); return; }
    if (k === 'F') { callWave(); return; }
    if ((k === 'X' || k === 'DELETE' || k === 'BACKSPACE') && UI.sel) { sellBuilding(UI.sel); UI.sel = null; return; }
    for (const t of BUILD_ORDER) if (BUILDINGS[t].key === k) { const locked = BUILDINGS[t].locked && !G.opts.unlocked?.['b_' + t]; if (!locked) selectTool(t); return; }
    for (const id of SPECIAL_ORDER) if (SPECIALS[id].key === k) { armSpecial(id); return; }
  });
  $('btnWave').onclick = callWave;
  $('btnRebuild').onclick = () => rebuildAll();
  $('btnPause').onclick = () => { G.paused = !G.paused; };
  $('btnMute').onclick = () => { SFX.init(); SFX.setMuted(!SFX.muted); $('btnMute').classList.toggle('on', SFX.muted); };
  for (const s of [1, 2, 3]) $('spd' + s).onclick = () => { G.speed = s; };
  $('btnMenu').onclick = () => { if (G.over || confirm('Abandon this colony? You keep scrip for the time survived.')) { if (!G.over) gameOver(false); G.overT = 99; } };
}
function callWave() {
  if (!G || G.phase !== 'lull' || G.over) return;
  const bonus = Math.floor(G.phaseT * 0.8);
  if (bonus > 0) { G.res += bonus; msg('+' + bonus + ' materiel for an early start', '#fc6'); }
  G.phaseT = 0; UI.tool = null;
}

function updateHUD() {
  if (!G) return;
  $('res').textContent = Math.floor(G.res);
  $('inc').textContent = '+' + G.income.toFixed(1) + '/s';
  $('wave').textContent = G.wave + '/' + WAVES;
  const pb = $('phaseBox');
  if (G.phase === 'lull') { $('phaseLbl').textContent = 'NIGHTFALL IN'; $('phaseVal').textContent = fmtTime(G.phaseT); pb.className = 'stat'; }
  else { $('phaseLbl').textContent = 'HOSTILES'; $('phaseVal').textContent = G.enemies.length + G.spawnQ.length; pb.className = 'stat phase-night'; }
  $('btnWave').disabled = G.phase !== 'lull';
  $('btnWave').textContent = G.phase === 'lull' ? 'CALL WAVE (+' + Math.floor(G.phaseT * 0.8) + ')' : 'CALL WAVE';
  const rc = rebuildCost();
  $('btnRebuild').style.display = G.ruins.length ? '' : 'none';
  $('btnRebuild').textContent = 'REBUILD (' + rc + ')';
  $('btnRebuild').disabled = G.phase !== 'lull';
  $('score').textContent = 'KILLS ' + G.kills;
  for (const s of [1, 2, 3]) $('spd' + s).classList.toggle('on', G.speed === s);
  $('btnPause').classList.toggle('on', G.paused);
  $('nightveil').style.display = G.phase === 'lull' ? 'none' : 'flex';
  document.querySelectorAll('#build .tool').forEach(el => {
    const t = el.dataset.type;
    el.classList.toggle('sel', UI.tool === t);
    el.classList.toggle('dis', G.res < BUILDINGS[t].cost);
  });
  document.querySelectorAll('#specials .tool').forEach(el => {
    const id = el.dataset.sp, s = G.spec[id];
    el.classList.toggle('sel', UI.special === id);
    el.classList.toggle('locked', s.locked);
    el.classList.toggle('dis', !s.locked && s.charges <= 0);
    const frac = s.charges < s.max && s.base ? clamp(s.cd / s.base, 0, 1) : 0;
    el.querySelector('.cdv').style.height = (s.charges > 0 ? 0 : frac * 100) + '%';
    el.querySelector('.ch').textContent = s.max > 1 ? s.charges : '';
  });
  $('msgs').innerHTML = G.msgs.map(m => `<div style="color:${m.col};opacity:${Math.min(1, m.t)}">${m.text}</div>`).join('');
  const sel = $('sel');
  if (UI.sel && !UI.sel.dead) {
    const b = UI.sel;
    sel.style.display = 'block';
    sel.innerHTML = `<div style="color:var(--hi)">${b.d.name}</div><div>HP ${Math.ceil(b.hp)} / ${b.maxHp}</div>` +
      (b.type !== 'hq' && b.type !== 'dropsentry' && G.phase === 'lull' ? `<button class="btn" id="btnSell" style="margin-top:6px">SELL +${Math.floor(b.d.cost * 0.6 * b.hp / b.maxHp)} [X]</button>` : '');
    const bs = $('btnSell'); if (bs) bs.onclick = () => { sellBuilding(b); UI.sel = null; };
  } else { sel.style.display = 'none'; UI.sel = null; }
}

// ---------- overlay (2x game resolution, crisp UI lines) ----------
function drawOverlay() {
  const c = UI.ctx; if (!c || !G) return;
  const S = 2;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, UI.ov.width, UI.ov.height);
  c.setTransform(S, 0, 0, S, 0, 0);
  const map = G.map, sec = map.sectors, so = map.sectorOf, tiles = map.tiles;
  const inGame = UI.screen === 'game' && !G.over;
  const lull = G.phase === 'lull';
  if (inGame && lull) {
    // territory border
    c.strokeStyle = 'rgba(125,255,200,0.55)'; c.lineWidth = 0.75; c.beginPath();
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const t = y * GW + x; if (!sec[so[t]].claimed || tiles[t] === T_ROCK) continue;
      const edge = (nx, ny) => nx < 0 || ny < 0 || nx >= GW || ny >= GH ? false : (tiles[ny * GW + nx] !== T_ROCK && !sec[so[ny * GW + nx]].claimed);
      if (edge(x + 1, y)) { c.moveTo(x * 8 + 8, y * 8); c.lineTo(x * 8 + 8, y * 8 + 8); }
      if (edge(x - 1, y)) { c.moveTo(x * 8, y * 8); c.lineTo(x * 8, y * 8 + 8); }
      if (edge(x, y + 1)) { c.moveTo(x * 8, y * 8 + 8); c.lineTo(x * 8 + 8, y * 8 + 8); }
      if (edge(x, y - 1)) { c.moveTo(x * 8, y * 8); c.lineTo(x * 8 + 8, y * 8); }
    }
    c.stroke();
    // frontier gaps that still need walls
    c.strokeStyle = 'rgba(255,170,60,0.8)'; c.setLineDash([1.5, 1.5]); c.lineWidth = 0.6;
    for (const g of frontierGaps()) {
      const side = sec[g.a].claimed ? g.a : g.b;
      for (const t of g.tiles) if (so[t] === side && !G.occ[t]) c.strokeRect((t % GW) * 8 + 1, ((t / GW) | 0) * 8 + 1, 6, 6);
    }
    c.setLineDash([]);
    // claimable sectors
    const hs = UI.tool || UI.special ? null : hoveredSector();
    c.font = '7px "Share Tech Mono", monospace'; c.textAlign = 'center';
    for (const s of sec) {
      if (!canClaim(s)) continue;
      const cost = claimCost(s), ok = G.res >= cost;
      if (s === hs) {
        c.fillStyle = ok ? 'rgba(125,255,200,0.10)' : 'rgba(255,90,70,0.08)';
        for (const t of s.tiles) if (tiles[t] !== T_ROCK) c.fillRect((t % GW) * 8, ((t / GW) | 0) * 8, 8, 8);
      }
      c.fillStyle = s === hs ? (ok ? '#7dffc8' : '#ff7a6a') : (ok ? 'rgba(191,232,216,0.8)' : 'rgba(255,150,130,0.6)');
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.5; c.strokeText('CLAIM ' + cost + (s.richness ? '  ◆' + s.richness : ''), s.cx, s.cy);
      c.fillText('CLAIM ' + cost + (s.richness ? '  ◆' + s.richness : ''), s.cx, s.cy);
    }
    // build ghost
    if (UI.tool && UI.mouse.in) {
      const d = BUILDINGS[UI.tool];
      let cells = [];
      if (UI.drag) cells = lineTiles(UI.drag.tx, UI.drag.ty, Math.floor(UI.mouse.x / TILE), Math.floor(UI.mouse.y / TILE)).map(([x, y]) => ({ tx: x, ty: y, w: 1, h: 1 }));
      else cells = [footprint(UI.tool, UI.mouse.x, UI.mouse.y)];
      let cost = 0;
      for (const f of cells) {
        const ok = canPlace(UI.tool, f.tx, f.ty);
        if (ok) cost += d.cost;
        c.fillStyle = ok ? 'rgba(125,255,200,0.25)' : 'rgba(255,80,60,0.3)';
        c.strokeStyle = ok ? 'rgba(125,255,200,0.9)' : 'rgba(255,80,60,0.9)';
        c.lineWidth = 0.5; c.fillRect(f.tx * 8, f.ty * 8, f.w * 8, f.h * 8); c.strokeRect(f.tx * 8 + 0.25, f.ty * 8 + 0.25, f.w * 8 - 0.5, f.h * 8 - 0.5);
      }
      const f = cells[cells.length - 1];
      const cx = (f.tx + f.w / 2) * 8, cy = (f.ty + f.h / 2) * 8;
      if (d.range) ring(c, cx, cy, d.range, 'rgba(125,255,200,0.35)', d.minRange);
      if (d.lightR) ring(c, cx, cy, d.lightR, 'rgba(255,240,180,0.3)');
      if (cells.length > 1) { c.fillStyle = G.res >= cost ? '#fc6' : '#f76'; c.fillText(cost + '', cx, cy - 8); }
      if (d.needsOre) {
        c.strokeStyle = 'rgba(120,220,255,0.6)'; c.lineWidth = 0.5;
        for (const s of sec) if (s.claimed) for (const o of s.ore) if (!G.occ[o.y * GW + o.x]) c.strokeRect(o.x * 8 - 1, o.y * 8 - 1, 18, 18);
      }
    }
  }
  // selection
  if (inGame && UI.sel && !UI.sel.dead) {
    const b = UI.sel; c.strokeStyle = '#7dffc8'; c.lineWidth = 0.5; c.strokeRect(b.tx * 8 - 1, b.ty * 8 - 1, b.w * 8 + 2, b.h * 8 + 2);
    if (b.d.range) ring(c, b.x, b.y, b.d.range, 'rgba(125,255,200,0.4)', b.d.minRange);
  }
  // hp bars
  if (UI.screen === 'game') for (const b of G.buildings) {
    if (b.hp >= b.maxHp || b.type === 'wall' && b.hp > b.maxHp * 0.6) continue;
    const w = Math.max(6, b.w * 8 - 2), x = b.x - w / 2, y = b.ty * 8 - 2.5, k = b.hp / b.maxHp;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x - 0.25, y - 0.25, w + 0.5, 1.5);
    c.fillStyle = k > 0.5 ? '#6f6' : k > 0.25 ? '#fc4' : '#f44'; c.fillRect(x, y, w * k, 1);
  }
  // tracker blips
  if (G.tagT > 0) {
    const a = Math.min(1, G.tagT / 2);
    for (const e of G.enemies) {
      if (!(e.tagged > 0)) continue;
      const p = 0.6 + 0.4 * Math.sin(G.t * 8 + e.x * 0.1);
      c.fillStyle = `rgba(90,255,140,${0.8 * a * p})`;
      const r = e.td.boss ? 3 : e.td.big ? 2 : 0.9;
      c.fillRect(e.x - r, e.y - r, r * 2, r * 2);
    }
  }
  // special targeting
  if (inGame && UI.special && UI.mouse.in) {
    const id = UI.special, mx = UI.mouse.x, my = UI.mouse.y;
    const R = { flare: 110, orbital: 38, drop: 14, nuke: 170 }[id];
    c.strokeStyle = id === 'nuke' ? 'rgba(255,60,40,0.9)' : 'rgba(255,200,80,0.9)'; c.lineWidth = 0.6;
    if (R) { c.setLineDash(id === 'flare' ? [2, 2] : []); c.beginPath(); c.arc(mx, my, R, 0, TAU); c.stroke(); c.setLineDash([]); }
    c.beginPath(); c.moveTo(mx - 5, my); c.lineTo(mx - 2, my); c.moveTo(mx + 2, my); c.lineTo(mx + 5, my); c.moveTo(mx, my - 5); c.lineTo(mx, my - 2); c.moveTo(mx, my + 2); c.lineTo(mx, my + 5); c.stroke();
    if (id === 'napalm' || id === 'gunship') {
      const hq = G.buildings.find(b => b.type === 'hq'); let dx = mx - hq.x, dy = my - hq.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const len = id === 'napalm' ? 140 : 110;
      c.lineWidth = id === 'napalm' ? 4 : 3; c.strokeStyle = 'rgba(255,140,40,0.35)';
      c.beginPath(); c.moveTo(mx - dx * len / 2, my - dy * len / 2); c.lineTo(mx + dx * len / 2, my + dy * len / 2); c.stroke();
    }
    if (id === 'nuke') { c.fillStyle = 'rgba(255,60,40,0.9)'; c.font = '6px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.fillText('FRIENDLY FIRE RADIUS', mx, my - R - 3); }
  }
  if (G.paused && UI.screen === 'game') { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 0, W, H); c.fillStyle = '#7dffc8'; c.font = '14px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.fillText('PAUSED', W / 2, H / 2); }
}
function ring(c, x, y, r, col, minR) {
  c.strokeStyle = col; c.lineWidth = 0.5; c.setLineDash([2, 2]); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  if (minR) { c.beginPath(); c.arc(x, y, minR, 0, TAU); c.stroke(); }
  c.setLineDash([]);
}
