'use strict';
// ---------- core simulation ----------
let G = null;
const DT = 1 / 60;
const HASH = 16, HW = Math.ceil(W / HASH), HH = Math.ceil(H / HASH);

function newGame(opts) {
  const seed = opts.seed || (Math.random() * 1e9) | 0;
  const map = generateMap(seed);
  const biome = BIOMES[opts.biome];
  const terrain = bakeTerrain(map, biome);
  if (GFX.gl) { uploadTerrain(terrain); clearDecals(); }
  const fac = FACTIONS[opts.faction], diff = DIFFICULTIES[opts.difficulty];
  G = {
    opts, map, terrain, biome, fac, diff, seed,
    t: 0, phase: 'lull', phaseT: FIRST_LULL, wave: 0, speed: 1, paused: false,
    res: 260 + (opts.boost?.cache || 0), income: 0,
    buildings: [], occ: new Array(GW * GH).fill(null), ruins: [],
    enemies: [], marines: [], projs: [], fx: [], lights: [],
    parts: new Particles(26000),
    spawnQ: [], spawnT: 0, spawnDur: 30,
    kills: 0, lost: 0, built: 0, specialsUsed: 0,
    flowDirty: true, postsDirty: true,
    dist: new Float32Array(GW * GH), dirX: new Float32Array(GW * GH), dirY: new Float32Array(GW * GH),
    ldirX: new Float32Array(GW * GH), ldirY: new Float32Array(GW * GH),
    lightGrid: new Float32Array(GW * GH * 3),
    hashHead: new Int32Array(HW * HH), hashNext: new Int32Array(8000),
    shake: 0, flash: 0, dayness: 1, tagT: 0, slowmo: 1,
    spec: {}, msgs: [], over: false, result: null, demo: !!opts.demo,
    sunAng: 0.6, decalTick: 0, sfxT: {},
  };
  for (const id of SPECIAL_ORDER) {
    const d = SPECIALS[id];
    G.spec[id] = { cd: 0, charges: d.charges || 1, max: d.charges || 1, locked: d.locked && !opts.unlocked?.['s_' + id] };
  }
  G.cdMult = opts.boost?.relay ? 0.75 : 1;
  placeBuilding('hq', map.hq.x, map.hq.y, true);
  if (opts.boost?.survey) {
    const home = map.sectors.find(s => s.claimed);
    const cand = [...home.nb].map(i => map.sectors[i]).filter(s => !s.hive).sort((a, b) => b.richness - a.richness);
    if (cand[0]) cand[0].claimed = true;
  }
  if (opts.boost?.prefab) autoFortify(true);
  G.postsDirty = true;
  return G;
}

// ---------------- messages ----------------
function msg(text, col = '#cfe') { G.msgs.push({ text, col, t: 4 }); if (G.msgs.length > 5) G.msgs.shift(); }

// ---------------- territory ----------------
const tileClaimed = t => G.map.sectors[G.map.sectorOf[t]].claimed;
function claimCost(s) {
  const n = G.map.sectors.filter(x => x.claimed).length - 1;
  return Math.round(60 + 45 * n + 14 * n * n + s.richness * 15);
}
function canClaim(s) {
  if (!s || s.claimed || s.hive || G.phase !== 'lull') return false;
  for (const n of s.nb) if (G.map.sectors[n].claimed) return true;
  return false;
}
function tryClaim(s) {
  if (!canClaim(s)) return false;
  const c = claimCost(s); if (G.res < c) { msg('Not enough materiel', '#f86'); SFX.play('deny'); return false; }
  G.res -= c; s.claimed = true; G.postsDirty = true; G.flowDirty = true;
  msg('Sector secured', '#8fd'); SFX.play('claim');
  return true;
}
function frontierGaps() {
  const S = G.map.sectors;
  return G.map.gaps.filter(g => S[g.a].claimed !== S[g.b].claimed);
}

// ---------------- buildings ----------------
function canPlace(type, tx, ty) {
  const d = BUILDINGS[type];
  if (G.phase !== 'lull' && type !== 'hq' && type !== 'dropsentry') return false;
  let ore = 0;
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
    if (x < 0 || y < 0 || x >= GW || y >= GH) return false;
    const t = y * GW + x;
    if (G.occ[t] || G.map.tiles[t] === T_ROCK) return false;
    if (type !== 'hq' && type !== 'dropsentry' && !tileClaimed(t)) return false;
    if (G.map.tiles[t] === T_ORE) ore++;
  }
  if (d.perSector) {
    const sid = G.map.sectorOf[ty * GW + tx];
    if (G.buildings.filter(b => b.type === type && G.map.sectorOf[b.ty * GW + b.tx] === sid).length >= d.perSector) return false;
  }
  if (d.needsOre) return ore === d.w * d.h;
  if (ore && type !== 'dropsentry') return false;
  return true;
}
function placeBuilding(type, tx, ty, free = false) {
  const d = BUILDINGS[type];
  if (!free) {
    if (!canPlace(type, tx, ty)) return null;
    if (G.res < d.cost) return null;
    G.res -= d.cost;
  }
  const b = {
    type, d, tx, ty, w: d.w, h: d.h, x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE,
    hp: d.hp, maxHp: d.hp, cd: Math.random() * 0.5, ang: Math.PI, target: null, scanT: Math.random() * 0.2,
    dead: false, hitT: 0, anim: Math.random() * 10, life: d.life || 0, spawnT: 0, flameT: 0,
  };
  G.buildings.push(b);
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) G.occ[y * GW + x] = b;
  G.flowDirty = true;
  if (type !== 'hq' && type !== 'dropsentry') G.built++;
  return b;
}
function removeBuilding(b) {
  b.dead = true;
  for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) if (G.occ[y * GW + x] === b) G.occ[y * GW + x] = null;
  G.buildings.splice(G.buildings.indexOf(b), 1);
  G.flowDirty = true;
}
function destroyBuilding(b) {
  if (b.dead) return;
  removeBuilding(b);
  const big = b.w * b.h;
  explosion(b.x, b.y, 10 + big * 4, 0, false);
  for (let i = 0; i < 6 + big * 4; i++) G.parts.spawn(P_GIB, b.x + rnd(-4, 4) * b.w, b.y + rnd(-4, 4) * b.h, 2, rnd(-50, 50), rnd(-50, 50), rnd(30, 90), rnd(1, 2.5), 0.3, 0.3, 0.3, 1);
  stamp('scorch', b.x, b.y, 12 + b.w * 10, 0, 0, 0, 0.7, Math.random() * TAU);
  if (b.type === 'hq') { gameOver(false); return; }
  if (b.type !== 'dropsentry') { G.ruins.push({ type: b.type, tx: b.tx, ty: b.ty }); G.lost++; }
  if (b.type !== 'wall') msg(BUILDINGS[b.type].name + ' destroyed', '#f86');
}
function sellBuilding(b) {
  if (G.phase !== 'lull' || b.type === 'hq') return;
  G.res += Math.floor(b.d.cost * 0.6 * b.hp / b.maxHp);
  removeBuilding(b); SFX.play('sell');
}
function rebuildCost() { return G.ruins.reduce((s, r) => s + BUILDINGS[r.type].cost, 0); }
function rebuildAll() {
  if (G.phase !== 'lull') return;
  let n = 0;
  G.ruins = G.ruins.filter(r => {
    if (!canPlace(r.type, r.tx, r.ty)) return !G.occ[r.ty * GW + r.tx] && G.map.sectors[G.map.sectorOf[r.ty * GW + r.tx]].claimed;
    if (G.res < BUILDINGS[r.type].cost) return true;
    placeBuilding(r.type, r.tx, r.ty); n++; return false;
  });
  if (n) SFX.play('build');
}
function hurtBuilding(b, dmg) {
  if (b.dead) return;
  b.hp -= dmg; b.hitT = 0.12;
  if (b.hp <= 0) destroyBuilding(b);
}
function wallMask(b) {
  const o = (x, y) => { if (x < 0 || y < 0 || x >= GW || y >= GH) return false; const q = G.occ[y * GW + x]; return q && q.type === 'wall'; };
  return (o(b.tx, b.ty - 1) ? 1 : 0) | (o(b.tx + 1, b.ty) ? 2 : 0) | (o(b.tx, b.ty + 1) ? 4 : 0) | (o(b.tx - 1, b.ty) ? 8 : 0);
}
function computeIncome() {
  let inc = 2.2;
  for (const s of G.map.sectors) if (s.claimed) inc += 0.3;
  for (const b of G.buildings) if (b.d.income) inc += b.d.income;
  return inc;
}

// ---------------- flow fields ----------------
const heapF = new Heap(GW * GH);
function computeFlow() {
  G.flowDirty = false;
  flowField(G.dist, G.dirX, G.dirY, 22);
  const tmp = new Float32Array(GW * GH);
  flowField(tmp, G.ldirX, G.ldirY, 0.5);
}
function flowField(dist, dx, dy, wallCost) {
  const tiles = G.map.tiles, occ = G.occ;
  dist.fill(1e9); heapF.n = 0;
  for (const b of G.buildings) if (b.type !== 'wall') for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) { dist[y * GW + x] = 0; heapF.push(0, y * GW + x); }
  const blocked = t => tiles[t] === T_ROCK || (occ[t] && occ[t].type === 'wall');
  while (heapF.n) {
    const t = heapF.pop(), dcur = heapF.topKey;
    if (dcur > dist[t]) continue;
    const x = t % GW, y = (t / GW) | 0;
    for (let k = 0; k < 8; k++) {
      const ox = NB8[k * 2], oy = NB8[k * 2 + 1];
      const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx; if (tiles[n] === T_ROCK) continue;
      if (ox && oy && (blocked(y * GW + nx) || blocked(ny * GW + x))) continue;
      let c = (ox && oy) ? 1.414 : 1;
      if (occ[t] && occ[t].type === 'wall') c += wallCost; // cost of leaving a wall tile = breaking it
      const nd = dcur + c;
      if (nd < dist[n]) { dist[n] = nd; heapF.push(nd, n); }
    }
  }
  for (let t = 0; t < GW * GH; t++) {
    dx[t] = 0; dy[t] = 0; if (tiles[t] === T_ROCK || dist[t] === 0) continue;
    const x = t % GW, y = (t / GW) | 0; let best = dist[t], bx = 0, by = 0;
    for (let k = 0; k < 8; k++) {
      const ox = NB8[k * 2], oy = NB8[k * 2 + 1];
      const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx; if (tiles[n] === T_ROCK) continue;
      if (ox && oy && (blocked(y * GW + nx) || blocked(ny * GW + x))) continue;
      const v = dist[n] + ((ox && oy) ? 0.414 : 0) * 0.01;
      if (v < best) { best = v; bx = ox; by = oy; }
    }
    const l = Math.hypot(bx, by) || 1; dx[t] = bx / l; dy[t] = by / l;
  }
}
const NB8 = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1];

// marine fields: BFS distance to each post
function computePosts() {
  G.postsDirty = false;
  const fg = frontierGaps(), S = G.map.sectors;
  G.posts = fg.map(g => { const side = S[g.a].claimed ? g.a : g.b; const p = g.post[side]; return { x: p.x, y: p.y, nx: p.nx, ny: p.ny, field: null }; });
  if (!G.posts.length) { const hq = G.buildings.find(b => b.type === 'hq'); G.posts = [{ x: hq.x + 24, y: hq.y, nx: 1, ny: 0 }]; }
  const tiles = G.map.tiles;
  for (const p of G.posts) {
    const f = new Int16Array(GW * GH).fill(32000);
    const start = clamp(Math.floor(p.y / TILE), 0, GH - 1) * GW + clamp(Math.floor(p.x / TILE), 0, GW - 1);
    const q = [start]; f[start] = 0; let qi = 0;
    while (qi < q.length) {
      const t = q[qi++], x = t % GW, y = (t / GW) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + NB8[k * 2], ny = y + NB8[k * 2 + 1]; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const n = ny * GW + nx; if (tiles[n] === T_ROCK || f[n] <= f[t] + 1) continue;
        f[n] = f[t] + 1; q.push(n);
      }
    }
    p.field = f;
  }
  G.marines.forEach((m, i) => { m.post = i % G.posts.length; });
}

// ---------------- lights ----------------
function addLight(x, y, z, r, cr, cg, cb, dx = 0, dy = 0, cone = -2, soft = 0.15) {
  if (G.lights.length < 1150) G.lights.push({ x, y, z, r, cr, cg, cb, dx, dy, cone, soft });
}
function buildLightGrid() {
  const lg = G.lightGrid; lg.fill(0);
  for (const L of G.lights) {
    if (L.r < 40) continue; // muzzle flashes don't count as 'seeing' a target
    const tr = Math.ceil(L.r / TILE), cx = Math.floor(L.x / TILE), cy = Math.floor(L.y / TILE), r2 = L.r * L.r;
    for (let y = Math.max(0, cy - tr); y <= Math.min(GH - 1, cy + tr); y++) for (let x = Math.max(0, cx - tr); x <= Math.min(GW - 1, cx + tr); x++) {
      const ex = (x + 0.5) * TILE - L.x, ey = (y + 0.5) * TILE - L.y, d2 = ex * ex + ey * ey;
      if (d2 >= r2) continue;
      const l = Math.sqrt(d2), d = l / L.r;
      let k = (1 - d) * (1 - d);
      if (L.cone > -1.5) { const c = (ex * L.dx + ey * L.dy) / (l || 1); k *= smoothstep(L.cone - L.soft, L.cone, c); }
      const i = (y * GW + x) * 3; lg[i] += L.cr * k; lg[i + 1] += L.cg * k; lg[i + 2] += L.cb * k;
    }
  }
}
function lightAt(x, y) {
  const tx = clamp(Math.floor(x / TILE), 0, GW - 1), ty = clamp(Math.floor(y / TILE), 0, GH - 1), i = (ty * GW + tx) * 3;
  return G.dayness + (G.lightGrid[i] + G.lightGrid[i + 1] + G.lightGrid[i + 2]) / 3;
}

// ---------------- waves ----------------
function buildWave(n) {
  const fac = G.fac, diff = G.diff;
  let budget = 50 * Math.pow(1.5, n - 1) * diff.count;
  if (n === WAVES) budget *= 1.8;
  const types = Object.entries(fac.types).filter(([k, t]) => !t.boss && t.from <= n);
  const tw = types.reduce((s, [, t]) => s + t.w, 0);
  const list = [];
  while (budget > 0) {
    let r = Math.random() * tw, pickT = types[0];
    for (const tt of types) { r -= tt[1].w; if (r <= 0) { pickT = tt; break; } }
    list.push(pickT[0]); budget -= pickT[1].cost;
  }
  // spawn points
  const S = G.map.sectors, tiles = G.map.tiles;
  const right = [], sides = [];
  for (let y = 0; y < GH; y++) { const t = y * GW + GW - 1; if (tiles[t] !== T_ROCK) right.push(t); }
  if (n >= 4) for (let x = 0; x < GW; x++) for (const y of [0, GH - 1]) {
    const t = y * GW + x; const s = S[G.map.sectorOf[t]];
    if (tiles[t] !== T_ROCK && !s.claimed && s.col >= 2) sides.push(t);
  }
  const q = [];
  let i = 0;
  while (i < list.length) {
    const grp = rndi(6, 18);
    const fromSide = sides.length && Math.random() < Math.min(0.45, 0.12 * (n - 3));
    const t = fromSide ? pick(sides) : pick(right);
    for (let k = 0; k < grp && i < list.length; k++, i++) {
      const type = list[i]; const td = fac.types[type];
      q.push({ type, t, burrow: td.beh === 'burrow' });
    }
  }
  if (n === WAVES) { const boss = Object.keys(fac.types).find(k => fac.types[k].boss); q.push({ type: boss, t: pick(right), boss: true, delay: true }); }
  return q;
}
function startWave() {
  G.wave++;
  G.phase = 'night';
  G.spawnQ = buildWave(G.wave);
  G.spawnTotal = G.spawnQ.length;
  G.spawnDur = 22 + G.wave * 3.5;
  G.spawnT = 0; G.waveT = 0;
  msg(G.wave === WAVES ? 'FINAL WAVE — ' + G.spawnQ.length + ' contacts' : 'WAVE ' + G.wave + ' — ' + G.spawnQ.length + ' contacts inbound', '#f66');
  SFX.play('klaxon');
}
function endWave() {
  if (G.wave >= WAVES) { gameOver(true); return; }
  G.phase = 'lull'; G.phaseT = LULL;
  msg('Wave ' + G.wave + ' repelled. Dawn.', '#8fd');
  SFX.play('dawn');
}
function gameOver(won) {
  if (G.over) return;
  G.over = true; G.result = { won, wave: G.wave, time: G.t, kills: G.kills };
  G.overT = 0;
  if (won) { msg('EVAC INBOUND — COLONY HOLDS', '#8fd'); SFX.play('dawn'); }
  else { msg('COMMAND DROPSHIP LOST', '#f44'); G.slowmo = 0.25; SFX.play('bigboom'); }
}
function spawnEnemy(type, x, y, opt = {}) {
  if (G.enemies.length >= 3800) return null;
  const td = G.fac.types[type];
  const elite = !td.boss && Math.random() < G.diff.elite;
  const hp = td.hp * G.diff.hp * (elite ? 2.2 : 1) * (td.boss ? 1 : 1 + 0.07 * Math.max(0, G.wave - 1));
  const e = {
    type, td, x, y, vx: 0, vy: 0, hp, maxHp: hp, atkCd: Math.random(), elite,
    ang: Math.PI, walk: Math.random() * 10, burn: 0, z: 0, leap: 0, lvx: 0, lvy: 0,
    burrowT: opt.burrow ? 1.6 : 0, spitT: Math.random(), minionT: 3, dead: false,
    rad: td.big ? (td.boss ? 6 : 4) : 1.6, speed: td.speed * (elite ? 1.15 : 1) * rnd(0.9, 1.1),
    stuckT: 0,
  };
  G.enemies.push(e);
  return e;
}
function updateSpawning(dt) {
  if (!G.spawnQ.length) return;
  G.spawnT += dt;
  const target = Math.floor(G.spawnTotal * Math.min(1, G.spawnT / G.spawnDur));
  let spawned = G.spawnTotal - G.spawnQ.length;
  while (spawned < target && G.spawnQ.length) {
    const s = G.spawnQ[0];
    if (s.delay && G.spawnQ.length > 1) { G.spawnQ.push(G.spawnQ.shift()); continue; }
    G.spawnQ.shift(); spawned++;
    let x, y;
    if (s.burrow) {
      const cl = G.map.sectors.filter(q => q.claimed);
      const sec = pick(cl);
      let t = 0; for (let k = 0; k < 30; k++) { t = pick(sec.tiles); if (G.map.tiles[t] !== T_ROCK && !G.occ[t]) break; }
      x = (t % GW + 0.5) * TILE; y = (((t / GW) | 0) + 0.5) * TILE;
    } else {
      x = (s.t % GW + 0.5) * TILE + rnd(-3, 3); y = (((s.t / GW) | 0) + 0.5) * TILE + rnd(-3, 3);
    }
    const e = spawnEnemy(s.type, x, y, { burrow: s.burrow });
    if (s.boss && e) { msg('!!! ' + G.fac.types[s.type].sprite.toUpperCase() + ' DETECTED !!!', '#f44'); SFX.play('screech', x, 1); G.shake = 4; }
  }
}

// ---------------- enemy spatial hash ----------------
function rebuildHash() {
  const head = G.hashHead, next = G.hashNext; head.fill(-1);
  const en = G.enemies; if (next.length < en.length) G.hashNext = new Int32Array(en.length * 2);
  const nx = G.hashNext;
  for (let i = 0; i < en.length; i++) {
    const e = en[i]; const c = clamp((e.y / HASH) | 0, 0, HH - 1) * HW + clamp((e.x / HASH) | 0, 0, HW - 1);
    nx[i] = head[c]; head[c] = i;
  }
}
function forNear(x, y, r, fn) {
  const x0 = clamp(((x - r) / HASH) | 0, 0, HW - 1), x1 = clamp(((x + r) / HASH) | 0, 0, HW - 1);
  const y0 = clamp(((y - r) / HASH) | 0, 0, HH - 1), y1 = clamp(((y + r) / HASH) | 0, 0, HH - 1);
  const head = G.hashHead, next = G.hashNext, en = G.enemies, r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    for (let i = head[cy * HW + cx]; i !== -1; i = next[i]) { const e = en[i]; if (!e.dead && dist2(e.x, e.y, x, y) <= r2) if (fn(e) === false) return; }
  }
}
function nearestEnemy(x, y, r, minR = 0) {
  let best = null, bd = r * r; const m2 = minR * minR;
  forNear(x, y, r, e => { if (e.burrowT > 0) return; const d = dist2(e.x, e.y, x, y); if (d < bd && d >= m2) { bd = d; best = e; } });
  return best;
}

// ---------------- damage & gore ----------------
function hurtEnemy(e, dmg, dx = 0, dy = 0, src) {
  if (e.dead) return;
  e.hp -= dmg;
  const bl = BLOOD[G.fac.blood];
  const n = Math.min(4, 1 + (dmg / 6) | 0);
  const bk = bl.emis ? P_ACID : P_BLOOD;
  for (let i = 0; i < n; i++) G.parts.spawn(bk, e.x, e.y, 2, dx * rnd(20, 60) + rnd(-25, 25), dy * rnd(20, 60) + rnd(-25, 25), rnd(10, 45), 1, bl.col[0], bl.col[1], bl.col[2], 1);
  if (e.hp <= 0) killEnemy(e, dx, dy);
}
function killEnemy(e, dx, dy) {
  if (e.dead) return;
  e.dead = true; G.kills++;
  const bl = BLOOD[G.fac.blood];
  const sz = e.td.boss ? 5 : e.td.big ? 3 : 1;
  const n = 8 + sz * 12;
  const bk = bl.emis ? P_ACID : P_BLOOD;
  for (let i = 0; i < n; i++) G.parts.spawn(bk, e.x, e.y, 2, dx * rnd(10, 70) + rnd(-50, 50) * sz * 0.6, dy * rnd(10, 70) + rnd(-50, 50) * sz * 0.6, rnd(15, 70), rnd(1, 1.6), bl.col[0], bl.col[1], bl.col[2], 1);
  for (let i = 0; i < 1 + sz * 2; i++) G.parts.spawn(P_GIB, e.x, e.y, 2, rnd(-40, 40), rnd(-40, 40), rnd(20, 60), 1, 0.1 + bl.decal[0] * 0.5, 0.1 + bl.decal[1] * 0.5, 0.1 + bl.decal[2] * 0.5, 1);
  stamp(Math.random() < 0.5 ? 'splat' : 'splat2', e.x + dx * 3, e.y + dy * 3, (6 + sz * 5) * rnd(0.8, 1.2), bl.decal[0], bl.decal[1], bl.decal[2], 0.85, Math.random() * TAU);
  if (bl.emis) stampE('splat', e.x, e.y, (5 + sz * 4), bl.emis[0], bl.emis[1], bl.emis[2], 0.12, Math.random() * TAU);
  if (G.fac.blood === 'acid') {
    // acid blood eats nearby structures
    const tx = (e.x / TILE) | 0, ty = (e.y / TILE) | 0;
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const b = G.occ[y * GW + x]; if (b && dist2(b.x, b.y, e.x, e.y) < (6 + b.w * 4) ** 2) { hurtBuilding(b, 5 * sz); if (Math.random() < 0.5) G.parts.spawn(P_SMOKE, e.x, e.y, 2, rnd(-3, 3), rnd(-3, 3), 8, 3, 0.4, 0.5, 0.2, 0.4); }
    }
  }
  if (e.td.beh === 'explode') bloaterBurst(e);
  if (e.td.boss) { explosion(e.x, e.y, 40, 0, false); msg('Hostile leader down!', '#8fd'); }
  if (Math.random() < 0.05 || e.td.big) SFX.play('squelch', e.x, e.td.big ? 1 : 0.4);
}
function bloaterBurst(e) {
  const r = e.td.radius;
  for (let i = 0; i < 40; i++) G.parts.spawn(P_BLOOD, e.x, e.y, 3, rnd(-90, 90), rnd(-90, 90), rnd(20, 80), rnd(1, 2), 0.5, 0.55, 0.15, 1);
  for (let i = 0; i < 10; i++) G.parts.spawn(P_SMOKE, e.x + rnd(-6, 6), e.y + rnd(-6, 6), 3, rnd(-10, 10), rnd(-10, 10), 6, rnd(5, 9), 0.35, 0.4, 0.15, 0.6);
  stamp('splat', e.x, e.y, r * 1.6, 0.3, 0.35, 0.08, 0.9, Math.random() * TAU);
  addFxLight(e.x, e.y, 4, 50, 0.5, 0.7, 0.1, 0.4);
  areaDamage(e.x, e.y, r, e.td.dmg, e);
  SFX.play('squelch', e.x, 1);
}
function areaDamage(x, y, r, dmg, skip, hitBuildings = true, falloff = true) {
  forNear(x, y, r, e => { if (e !== skip) { const d = Math.sqrt(dist2(e.x, e.y, x, y)); const k = falloff ? 1 - d / r * 0.6 : 1; const l = d || 1; hurtEnemy(e, dmg * k, (e.x - x) / l, (e.y - y) / l); } });
  for (const m of G.marines) if (dist2(m.x, m.y, x, y) < r * r) hurtMarine(m, dmg * 0.8);
  if (hitBuildings) {
    const tr = Math.ceil(r / TILE), cx = (x / TILE) | 0, cy = (y / TILE) | 0, seen = new Set();
    for (let ty = cy - tr; ty <= cy + tr; ty++) for (let tx = cx - tr; tx <= cx + tr; tx++) {
      if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) continue;
      const b = G.occ[ty * GW + tx]; if (!b || seen.has(b)) continue;
      if (dist2((tx + 0.5) * TILE, (ty + 0.5) * TILE, x, y) < r * r) { seen.add(b); hurtBuilding(b, dmg * 0.6); }
    }
  }
}
function explosion(x, y, r, dmg, hurtOwn = true, opts = {}) {
  const P = G.parts;
  const n = Math.min(120, 10 + r * 2.5);
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = rnd(10, 60) * r / 12; P.spawn(P_FIRE, x + rnd(-2, 2), y + rnd(-2, 2), rnd(0, 4), Math.cos(a) * s, Math.sin(a) * s, rnd(0, 20), rnd(2, 4) * Math.max(1, r / 16), 1, 0.7, 0.3, 1); }
  for (let i = 0; i < n * 0.6; i++) { const a = Math.random() * TAU, s = rnd(40, 150) * Math.max(1, r / 20); P.spawn(P_SPARK, x, y, 2, Math.cos(a) * s, Math.sin(a) * s, rnd(20, 90), 1, 1, 0.8, 0.4, 1); }
  for (let i = 0; i < n * 0.4; i++) P.spawn(P_SMOKE, x + rnd(-r, r) * 0.5, y + rnd(-r, r) * 0.5, 3, rnd(-8, 8), rnd(-8, 8), rnd(4, 10), rnd(4, 8) * Math.max(1, r / 16), 0.12, 0.11, 0.1, 0.75);
  for (let i = 0; i < Math.min(30, r); i++) P.spawn(P_DIRT, x, y, 1, rnd(-60, 60), rnd(-60, 60), rnd(30, 110), 1, 0.25, 0.2, 0.16, 1);
  P.spawn(P_FLASH, x, y, 4, 0, 0, 0, r * 2.6, 1, 0.8, 0.5, 1);
  P.spawn(P_RING, x, y, 1, 0, 0, 0, r * 0.4, 1, 0.7, 0.4, 0.6);
  addFxLight(x, y, 12, r * 5, 3.2, 1.9, 0.9, 0.5 + r / 60);
  stamp('scorch', x, y, r * 2.2, 0.02, 0.02, 0.02, 0.6, Math.random() * TAU);
  stampE('soft32', x, y, r * 1.6, 0.9, 0.35, 0.05, 1, 0);
  G.shake = Math.max(G.shake, Math.min(6, r / 8));
  if (dmg > 0) areaDamage(x, y, r, dmg, null, hurtOwn);
  if (!opts.quiet) SFX.play(r > 30 ? 'bigboom' : 'boom', x, Math.min(1, r / 20));
}
function addFxLight(x, y, z, r, cr, cg, cb, life) {
  G.fx.push({ kind: 'light', x, y, z, r, cr, cg, cb, t: 0, life });
}
function hurtMarine(m, dmg) {
  if (m.dead) return;
  m.hp -= dmg;
  const bl = BLOOD.human;
  for (let i = 0; i < 2; i++) G.parts.spawn(P_BLOOD, m.x, m.y, 2, rnd(-30, 30), rnd(-30, 30), rnd(10, 40), 1, bl.col[0], bl.col[1], bl.col[2], 1);
  if (m.hp <= 0) {
    m.dead = true;
    for (let i = 0; i < 16; i++) G.parts.spawn(P_BLOOD, m.x, m.y, 2, rnd(-50, 50), rnd(-50, 50), rnd(10, 60), 1.3, bl.col[0], bl.col[1], bl.col[2], 1);
    stamp('splat2', m.x, m.y, 8, bl.decal[0], bl.decal[1], bl.decal[2], 0.9, Math.random() * TAU);
    SFX.play('scream', m.x, 0.6);
  }
}

// ---------------- enemies ----------------
function updateEnemies(dt) {
  const en = G.enemies, occ = G.occ, tiles = G.map.tiles;
  // marine lookup grid (tile-coarse)
  const mg = G.marineGrid || (G.marineGrid = new Map()); mg.clear();
  for (const m of G.marines) { if (m.dead) continue; const k = ((m.y / HASH) | 0) * HW + ((m.x / HASH) | 0); if (!mg.has(k)) mg.set(k, []); mg.get(k).push(m); }
  const head = G.hashHead, next = G.hashNext;
  for (let i = 0; i < en.length; i++) {
    const e = en[i]; if (e.dead) continue;
    const td = e.td;
    if (e.burrowT > 0) {
      e.burrowT -= dt;
      if (Math.random() < 0.5) G.parts.spawn(P_DIRT, e.x, e.y, 0, rnd(-30, 30), rnd(-30, 30), rnd(20, 50), 1, 0.3, 0.25, 0.18, 1);
      if (e.burrowT <= 0) { stamp('splat2', e.x, e.y, 10, 0.1, 0.08, 0.06, 0.7, Math.random() * TAU); SFX.play('burrow', e.x, 0.5); }
      continue;
    }
    if (e.burn > 0) {
      e.burn -= dt; e.hp -= 9 * dt;
      if (Math.random() < 0.35) G.parts.spawn(P_FIRE, e.x + rnd(-1.5, 1.5), e.y + rnd(-1.5, 1.5), 2, rnd(-5, 5), rnd(-5, 5), rnd(10, 20), rnd(1.5, 2.5), 1, 0.6, 0.2, 1);
      if (Math.random() < 0.06) addLight(e.x, e.y, 4, 22, 0.9, 0.45, 0.1);
      if (e.hp <= 0) { killEnemy(e, 0, 0); continue; }
    }
    e.atkCd -= dt;
    const tx = clamp((e.x / TILE) | 0, 0, GW - 1), ty = clamp((e.y / TILE) | 0, 0, GH - 1), t = ty * GW + tx;
    // leaping in progress
    if (e.leap > 0) {
      e.leap -= dt; const nx = e.x + e.lvx * dt, ny = e.y + e.lvy * dt;
      const nt = clamp((ny / TILE) | 0, 0, GH - 1) * GW + clamp((nx / TILE) | 0, 0, GW - 1);
      if (tiles[nt] !== T_ROCK) { e.x = nx; e.y = ny; }
      e.z = Math.sin(clamp(1 - e.leap / 0.55, 0, 1) * Math.PI) * 9;
      if (e.leap <= 0) e.z = 0;
      continue;
    }
    // melee marines nearby
    let foe = null;
    const mk = ((e.y / HASH) | 0) * HW + ((e.x / HASH) | 0);
    for (const off of [0, -1, 1, -HW, HW]) { const arr = mg.get(mk + off); if (arr) for (const m of arr) if (!m.dead && dist2(m.x, m.y, e.x, e.y) < (e.rad + 5) ** 2) { foe = m; break; } if (foe) break; }
    if (foe) {
      e.ang = Math.atan2(foe.y - e.y, foe.x - e.x);
      if (e.atkCd <= 0) { e.atkCd = 1 / td.rate; if (td.beh === 'explode') { e.hp = 0; killEnemy(e, 0, 0); continue; } hurtMarine(foe, td.dmg); }
      continue;
    }
    const leapT = td.beh === 'leap';
    let dx = leapT ? G.ldirX[t] : G.dirX[t], dy = leapT ? G.ldirY[t] : G.dirY[t];
    // sub-tile steering toward tile centre along path to avoid corner hugging
    // ranged
    if (td.beh === 'spit') {
      e.spitT -= dt;
      if (e.spitT <= 0) {
        e.spitT = 0.4; e.spitTarget = null;
        if (G.dist[t] * TILE < td.range + 8) {
          const r = Math.ceil(td.range / TILE); let bd = 1e9;
          for (let yy = ty - r; yy <= ty + r; yy += 1) for (let xx = tx - r; xx <= tx + r; xx += 1) {
            if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue;
            const b = occ[yy * GW + xx]; if (!b || b.type === 'wall') continue;
            const d = dist2(b.x, b.y, e.x, e.y); if (d < bd && d < td.range * td.range) { bd = d; e.spitTarget = b; }
          }
        }
      }
      const b = e.spitTarget;
      if (b && !b.dead) {
        e.ang = Math.atan2(b.y - e.y, b.x - e.x);
        if (e.atkCd <= 0) { e.atkCd = 1 / td.rate; spit(e, b); }
        continue;
      }
    }
    // attack whatever blocks the way
    const ax = e.x + dx * (e.rad + 2.5), ay = e.y + dy * (e.rad + 2.5);
    const at = clamp((ay / TILE) | 0, 0, GH - 1) * GW + clamp((ax / TILE) | 0, 0, GW - 1);
    let blocker = occ[at] || occ[t];
    if (blocker && leapT && blocker.type === 'wall' && e.atkCd < 0.5) {
      e.leap = 0.55; e.lvx = dx * 55; e.lvy = dy * 55; SFX.play('skitter', e.x, 0.3); continue;
    }
    if (blocker) {
      e.ang = Math.atan2(blocker.y - e.y, blocker.x - e.x);
      if (e.atkCd <= 0) {
        e.atkCd = 1 / td.rate;
        if (td.beh === 'explode') { e.hp = 0; killEnemy(e, 0, 0); continue; }
        hurtBuilding(blocker, td.dmg * (td.bldMult || 1));
        for (let k = 0; k < 2; k++) G.parts.spawn(P_SPARK, ax, ay, 3, rnd(-40, 40), rnd(-40, 40), rnd(10, 40), 1, 1, 0.8, 0.5, 1);
        if (Math.random() < 0.15) SFX.play('clang', ax, 0.3);
      }
      e.vx *= 0.5; e.vy *= 0.5;
      continue;
    }
    // boss minions
    if (td.boss) {
      e.minionT -= dt;
      if (e.minionT <= 0) { e.minionT = 2.2; for (let k = 0; k < 4; k++) spawnEnemy(td.minion, e.x + rnd(-6, 6), e.y + rnd(-6, 6)); }
    }
    // separation
    let sx = 0, sy = 0, cnt = 0;
    const cx0 = clamp(((e.x - 4) / HASH) | 0, 0, HW - 1), cx1 = clamp(((e.x + 4) / HASH) | 0, 0, HW - 1);
    const cy0 = clamp(((e.y - 4) / HASH) | 0, 0, HH - 1), cy1 = clamp(((e.y + 4) / HASH) | 0, 0, HH - 1);
    for (let cy = cy0; cy <= cy1 && cnt < 10; cy++) for (let cx = cx0; cx <= cx1 && cnt < 10; cx++) {
      for (let j = head[cy * HW + cx]; j !== -1 && cnt < 10; j = next[j]) {
        if (j === i) continue; const o = en[j]; if (o.dead || o.burrowT > 0) continue;
        const ddx = e.x - o.x, ddy = e.y - o.y, d2 = ddx * ddx + ddy * ddy, rr = e.rad + o.rad + 0.6;
        if (d2 < rr * rr && d2 > 0.0001) { const d = Math.sqrt(d2); const k = (rr - d) / rr; sx += ddx / d * k; sy += ddy / d * k; cnt++; }
        else if (d2 <= 0.0001) { sx += rnd(-1, 1); sy += rnd(-1, 1); }
      }
    }
    const sp = e.speed;
    let tvx = dx * sp + sx * sp * 1.4, tvy = dy * sp + sy * sp * 1.4;
    e.vx += (tvx - e.vx) * Math.min(1, dt * 8); e.vy += (tvy - e.vy) * Math.min(1, dt * 8);
    let nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
    const pass = (x, y) => { if (x < 0.5 || y < 0.5 || x > W - 0.5 || y > H - 0.5) return false; const q = clamp((y / TILE) | 0, 0, GH - 1) * GW + clamp((x / TILE) | 0, 0, GW - 1); return tiles[q] !== T_ROCK && !occ[q]; };
    if (pass(nx, ny)) { e.x = nx; e.y = ny; }
    else if (pass(nx, e.y)) { e.x = nx; e.vy *= 0.5; }
    else if (pass(e.x, ny)) { e.y = ny; e.vx *= 0.5; }
    else { e.vx *= -0.3; e.vy *= -0.3; }
    const spd = Math.hypot(e.vx, e.vy);
    if (spd > 2) { const ta = Math.atan2(e.vy, e.vx); let da = ta - e.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); e.ang += da * Math.min(1, dt * 10); }
    e.walk += spd * dt * 0.35;
  }
  // compact
  let j = 0; for (let i = 0; i < en.length; i++) if (!en[i].dead) en[j++] = en[i]; en.length = j;
}
function spit(e, b) {
  const d = Math.hypot(b.x - e.x, b.y - e.y), T = d / 80 + 0.2;
  const acid = G.fac.blood === 'acid';
  G.projs.push({ kind: 'spit', x: e.x, y: e.y, sx: e.x, sy: e.y, tx: b.x + rnd(-3, 3), ty: b.y + rnd(-3, 3), t: 0, T, dmg: e.td.dmg, col: acid ? [0.6, 1, 0.1] : [0.3, 0.6, 1] });
  SFX.play('spit', e.x, 0.3);
}

// ---------------- turrets ----------------
function updateBuildings(dt) {
  let t = 0;
  const lull = G.phase === 'lull';
  for (let i = G.buildings.length - 1; i >= 0; i--) {
    const b = G.buildings[i]; if (!b || b.dead) continue;
    b.anim += dt; if (b.hitT > 0) b.hitT -= dt;
    if (lull && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.05 * dt);
    if (b.hp < b.maxHp * 0.5 && Math.random() < 0.08) G.parts.spawn(P_SMOKE, b.x + rnd(-3, 3) * b.w, b.y + rnd(-3, 3) * b.h, 6, rnd(-2, 2), rnd(-2, 2), rnd(5, 10), rnd(3, 5), 0.1, 0.1, 0.1, 0.5);
    if (b.hp < b.maxHp * 0.3 && Math.random() < 0.05) G.parts.spawn(P_FIRE, b.x + rnd(-3, 3) * b.w, b.y + rnd(-3, 3) * b.h, 4, 0, 0, rnd(8, 15), rnd(2, 3), 1, 0.6, 0.2, 1);
    if (b.life) { b.life -= dt; if (b.life <= 0) { destroyBuilding(b); continue; } }
    const d = b.d;
    if (b.type === 'barracks') {
      const mine = G.marines.filter(m => m.home === b).length;
      if (mine < d.marines) { b.spawnT -= dt; if (b.spawnT <= 0) { b.spawnT = lull ? 1.5 : 9; spawnMarine(b); } }
    }
    if (!d.turret && d.weapon !== 'cannon') continue;
    b.cd -= dt; b.scanT -= dt;
    const tgtOk = b.target && !b.target.dead && dist2(b.target.x, b.target.y, b.x, b.y) <= d.range * d.range;
    if (!tgtOk) { b.target = null; if (b.scanT <= 0) { b.scanT = 0.15 + Math.random() * 0.1; b.target = nearestEnemy(b.x, b.y, d.range, d.minRange || 0); } }
    const tg = b.target;
    if (!tg) { if (d.weapon === 'flame') b.flameT = 0; continue; }
    const want = Math.atan2(tg.y - b.y, tg.x - b.x);
    let da = Math.atan2(Math.sin(want - b.ang), Math.cos(want - b.ang));
    const turn = (d.weapon === 'rail' ? 2.5 : d.weapon === 'mortar' ? 99 : 9) * dt;
    b.ang += clamp(da, -turn, turn);
    if (Math.abs(da) > 0.25 || b.cd > 0) continue;
    fireWeapon(b, tg);
  }
}
function fireWeapon(b, tg) {
  const d = b.d, P = G.parts;
  const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
  const mz = d.weapon === 'rail' ? 9 : d.weapon === 'cannon' ? 10 : 4;
  const mx = b.x + ca * mz, my = b.y + sa * mz - 3;
  if (d.weapon === 'mg') {
    b.cd = 1 / d.rate * rnd(0.85, 1.15);
    const lit = lightAt(tg.x, tg.y) > 0.28 || tg.tagged > 0;
    const hit = Math.random() < (lit ? 0.9 : 0.42);
    const ex = hit ? tg.x : tg.x + rnd(-10, 10), ey = hit ? tg.y : tg.y + rnd(-10, 10);
    tracer(mx, my, ex, ey, 1, 0.75, 0.35);
    P.spawn(P_FLASH, mx, my, 3, 0, 0, 0, rnd(5, 8), 1, 0.7, 0.3, 1);
    addLight(mx, my, 5, 34, 1.3, 0.85, 0.45);
    P.spawn(P_CASING, b.x, b.y, 4, -sa * rnd(15, 30) + rnd(-5, 5), ca * rnd(15, 30) + rnd(-5, 5), rnd(20, 40), 1, 0.8, 0.6, 0.2, 1);
    if (hit) hurtEnemy(tg, d.dmg, ca, sa);
    else { P.spawn(P_DIRT, ex, ey, 0, rnd(-15, 15), rnd(-15, 15), rnd(10, 30), 1, 0.3, 0.25, 0.2, 1); }
    SFX.play('mg', b.x, 0.35);
  } else if (d.weapon === 'flame') {
    b.cd = 1 / d.rate;
    b.flameT = 0.15;
    for (let k = 0; k < 3; k++) {
      const a = b.ang + rnd(-0.3, 0.3), s = rnd(60, 110);
      P.spawn(P_FIRE, mx, my, 3, Math.cos(a) * s, Math.sin(a) * s, rnd(0, 10), rnd(1.5, 3), 1, 0.65, 0.25, 1, 0.35);
    }
    if (Math.random() < 0.3) addLight(b.x + ca * 14, b.y + sa * 14, 5, 55, 1.6, 0.8, 0.25);
    forNear(b.x, b.y, d.range, e => {
      const a = Math.atan2(e.y - b.y, e.x - b.x);
      if (Math.abs(Math.atan2(Math.sin(a - b.ang), Math.cos(a - b.ang))) < 0.42) { hurtEnemy(e, d.dmg, 0, 0); e.burn = 3.5; }
    });
    SFX.play('flame', b.x, 0.4);
  } else if (d.weapon === 'mortar') {
    b.cd = 1 / d.rate;
    const lead = Math.hypot(tg.x - b.x, tg.y - b.y) / 140 + 0.8;
    const tx = tg.x + tg.vx * lead * 0.8 + rnd(-6, 6), ty = tg.y + tg.vy * lead * 0.8 + rnd(-6, 6);
    G.projs.push({ kind: 'shell', x: b.x, y: b.y, sx: b.x, sy: b.y - 5, tx, ty, t: 0, T: lead, dmg: d.dmg, r: d.splash });
    P.spawn(P_FLASH, b.x, b.y - 6, 6, 0, 0, 0, 12, 1, 0.7, 0.3, 1);
    for (let k = 0; k < 6; k++) P.spawn(P_SMOKE, b.x, b.y - 4, 6, rnd(-6, 6), rnd(-6, 6), rnd(10, 20), rnd(3, 5), 0.3, 0.3, 0.3, 0.5);
    addLight(b.x, b.y, 8, 50, 2, 1.2, 0.5);
    SFX.play('mortar', b.x, 0.6);
  } else if (d.weapon === 'rail') {
    b.cd = 1 / d.rate;
    const L = d.range, ex = b.x + ca * L, ey = b.y + sa * L;
    // everything along the line
    for (const e of G.enemies) {
      if (e.dead || e.burrowT > 0) continue;
      const px = e.x - b.x, py = e.y - b.y, along = px * ca + py * sa;
      if (along < 0 || along > L) continue;
      const perp = Math.abs(-px * sa + py * ca);
      if (perp < e.rad + 2) { hurtEnemy(e, d.dmg, ca, sa); for (let k = 0; k < 3; k++) P.spawn(P_SPARK, e.x, e.y, 3, ca * rnd(40, 120) + rnd(-30, 30), sa * rnd(40, 120) + rnd(-30, 30), rnd(10, 40), 1, 0.5, 0.8, 1, 1); }
    }
    G.fx.push({ kind: 'beam', x1: mx, y1: my, x2: ex, y2: ey, t: 0, life: 0.35 });
    P.spawn(P_FLASH, mx, my, 6, 0, 0, 0, 22, 0.5, 0.8, 1, 1);
    G.shake = Math.max(G.shake, 1.5);
    SFX.play('rail', b.x, 0.8);
  } else if (d.weapon === 'cannon') {
    b.cd = 1 / d.rate;
    tracer(mx, my, tg.x, tg.y, 1, 0.9, 0.6, 2);
    P.spawn(P_FLASH, mx, my, 8, 0, 0, 0, 16, 1, 0.8, 0.4, 1);
    addLight(mx, my, 10, 60, 2.2, 1.4, 0.7);
    explosion(tg.x, tg.y, d.splash, d.dmg, false, { quiet: true });
    SFX.play('cannon', b.x, 0.7);
  }
}
function tracer(x1, y1, x2, y2, r, g, b, w = 1) {
  const a = Math.atan2(y2 - y1, x2 - x1), d = Math.hypot(x2 - x1, y2 - y1);
  const s = 520;
  G.parts.spawn(P_TRACER, x1, y1, 3, Math.cos(a) * s, Math.sin(a) * s, 0, w, r, g, b, 1, d / s);
}

// ---------------- marines ----------------
function spawnMarine(b) {
  if (G.postsDirty) computePosts();
  const m = { x: b.x + rnd(-4, 4), y: b.y + 6, hp: 30, home: b, post: G.marines.length % G.posts.length, ang: 0, cd: 0, burst: 0, target: null, scanT: 0, walk: 0, ox: rnd(-7, 7), oy: rnd(-7, 7), dead: false };
  G.marines.push(m);
}
function updateMarines(dt) {
  if (G.postsDirty) computePosts();
  const tiles = G.map.tiles, P = G.parts;
  for (const m of G.marines) {
    if (m.dead) continue;
    if (m.home.dead) { m.hp -= dt * 2; }
    m.cd -= dt; m.scanT -= dt;
    if (!m.target || m.target.dead || dist2(m.target.x, m.target.y, m.x, m.y) > 60 * 60) {
      m.target = null; if (m.scanT <= 0) { m.scanT = 0.2 + Math.random() * 0.1; m.target = nearestEnemy(m.x, m.y, 58); }
    }
    if (m.target) {
      const tg = m.target; m.ang = Math.atan2(tg.y - m.y, tg.x - m.x);
      if (m.cd <= 0) {
        if (m.burst <= 0) m.burst = 4;
        m.burst--; m.cd = m.burst > 0 ? 0.075 : rnd(0.45, 0.8);
        const ca = Math.cos(m.ang), sa = Math.sin(m.ang);
        const lit = lightAt(tg.x, tg.y) > 0.28 || tg.tagged > 0;
        const hit = Math.random() < (lit ? 0.85 : 0.5);
        const mx = m.x + ca * 3, my = m.y + sa * 3 - 2;
        tracer(mx, my, hit ? tg.x : tg.x + rnd(-8, 8), hit ? tg.y : tg.y + rnd(-8, 8), 1, 0.85, 0.5);
        P.spawn(P_FLASH, mx, my, 3, 0, 0, 0, rnd(4, 6), 1, 0.8, 0.4, 1);
        addLight(mx, my, 4, 26, 1.1, 0.75, 0.4);
        if (Math.random() < 0.5) P.spawn(P_CASING, m.x, m.y, 3, -sa * 20 + rnd(-5, 5), ca * 20 + rnd(-5, 5), rnd(15, 30), 1, 0.8, 0.6, 0.2, 1);
        if (hit) hurtEnemy(tg, 4, ca, sa);
        SFX.play('rifle', m.x, 0.25);
      }
      continue;
    }
    // walk to post
    const post = G.posts[m.post % G.posts.length];
    const gx = post.x + m.ox, gy = post.y + m.oy;
    let dx = 0, dy = 0;
    const tx = clamp((m.x / TILE) | 0, 0, GW - 1), ty = clamp((m.y / TILE) | 0, 0, GH - 1);
    if (dist2(m.x, m.y, gx, gy) < 144 || post.field[ty * GW + tx] <= 1) { dx = gx - m.x; dy = gy - m.y; }
    else {
      let best = post.field[ty * GW + tx];
      for (let k = 0; k < 4; k++) {
        const nx = tx + NB8[k * 2], ny = ty + NB8[k * 2 + 1]; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const v = post.field[ny * GW + nx]; if (v < best) { best = v; dx = (nx + 0.5) * TILE - m.x; dy = (ny + 0.5) * TILE - m.y; }
      }
    }
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      const s = 22 * dt; const nx = m.x + dx / l * s, ny = m.y + dy / l * s;
      const nt = clamp((ny / TILE) | 0, 0, GH - 1) * GW + clamp((nx / TILE) | 0, 0, GW - 1);
      if (tiles[nt] !== T_ROCK) { m.x = nx; m.y = ny; }
      m.ang = Math.atan2(dy, dx); m.walk += s * 0.4;
    } else if (post) { m.ang = Math.atan2(-post.ny, -post.nx); }
  }
  G.marines = G.marines.filter(m => !m.dead);
}

// ---------------- projectiles & effects ----------------
function updateProjs(dt) {
  const P = G.parts;
  for (const p of G.projs) {
    p.t += dt; const k = Math.min(1, p.t / p.T);
    p.x = lerp(p.sx, p.tx, k); p.y = lerp(p.sy, p.ty, k);
    if (p.kind === 'shell') {
      p.z = Math.sin(k * Math.PI) * (20 + p.T * 30);
      if (Math.random() < 0.6) P.spawn(P_SMOKE, p.x, p.y, p.z, 0, 0, 0, 2, 0.4, 0.4, 0.4, 0.3);
      if (k >= 1) { p.done = true; explosion(p.tx, p.ty, p.r, p.dmg, false); }
    } else if (p.kind === 'spit') {
      p.z = Math.sin(k * Math.PI) * 12;
      P.spawn(P_GLOW, p.x, p.y, p.z, 0, 0, 0, 2, p.col[0], p.col[1], p.col[2], 0.8);
      if (Math.random() < 0.3) addLight(p.x, p.y, p.z + 2, 18, p.col[0] * 0.6, p.col[1] * 0.6, p.col[2] * 0.6);
      if (k >= 1) {
        p.done = true;
        const b = G.occ[clamp((p.ty / TILE) | 0, 0, GH - 1) * GW + clamp((p.tx / TILE) | 0, 0, GW - 1)];
        if (b) hurtBuilding(b, p.dmg);
        for (const m of G.marines) if (dist2(m.x, m.y, p.tx, p.ty) < 36) hurtMarine(m, p.dmg);
        for (let i = 0; i < 8; i++) P.spawn(P_SPARK, p.tx, p.ty, 2, rnd(-40, 40), rnd(-40, 40), rnd(10, 30), 1, p.col[0], p.col[1], p.col[2], 1);
        stampE('splat2', p.tx, p.ty, 5, p.col[0] * 0.3, p.col[1] * 0.3, p.col[2] * 0.3, 0.4, Math.random() * TAU);
        stamp('splat2', p.tx, p.ty, 5, p.col[0] * 0.4, p.col[1] * 0.4, p.col[2] * 0.4, 0.8, Math.random() * TAU);
        P.spawn(P_SMOKE, p.tx, p.ty, 2, 0, 0, 6, 4, p.col[0] * 0.4, p.col[1] * 0.4, p.col[2] * 0.4, 0.5);
      }
    }
  }
  G.projs = G.projs.filter(p => !p.done);
}
function updateFx(dt) {
  const P = G.parts;
  for (const f of G.fx) {
    f.t += dt;
    if (f.update) { if (f.update(f, dt) === false) f.done = true; }
    else if (f.t >= f.life) f.done = true;
  }
  G.fx = G.fx.filter(f => !f.done);
}
function fxLights() {
  for (const f of G.fx) {
    if (f.kind === 'light') { const k = 1 - f.t / f.life; addLight(f.x, f.y, f.z, f.r * (0.6 + 0.4 * k), f.cr * k * k, f.cg * k * k, f.cb * k * k); }
    else if (f.kind === 'beam') {
      const k = 1 - f.t / f.life;
      for (let i = 0; i <= 4; i++) addLight(lerp(f.x1, f.x2, i / 4), lerp(f.y1, f.y2, i / 4), 8, 50, 0.4 * k, 0.8 * k, 1.8 * k);
    }
    if (f.light) f.light(f);
  }
}

// ---------------- main step ----------------
function step(dt) {
  if (G.paused) return;
  dt *= G.slowmo;
  G.t += dt;
  if (G.flowDirty) computeFlow();
  if (G.over) { G.overT += dt; G.slowmo = Math.min(1, G.slowmo + dt * 0.3); }
  // phase
  if (!G.over) {
    if (G.phase === 'lull') {
      G.phaseT -= dt;
      if (G.phaseT <= 0) startWave();
    } else {
      G.waveT += dt;
      updateSpawning(dt);
      if (!G.spawnQ.length && !G.enemies.length) endWave();
    }
  }
  const nightTarget = G.phase === 'night' || G.over && !G.result.won ? 0 : (G.phaseT < 8 ? G.phaseT / 8 : 1);
  G.dayness += (nightTarget - G.dayness) * Math.min(1, dt * (nightTarget > G.dayness ? 0.5 : 1.2));
  G.income = computeIncome();
  if (!G.over) G.res += G.income * dt;
  G.tagT -= dt;
  G.lights.length = 0;
  rebuildHash();
  updateEnemies(dt);
  rebuildHash();
  updateBuildings(dt);
  updateMarines(dt);
  updateProjs(dt);
  updateFx(dt);
  for (const s of Object.values(G.spec)) if (s.charges < s.max) { s.cd -= dt; if (s.cd <= 0) { s.charges++; if (s.charges < s.max) s.cd = s.base; } }
  for (const e of G.enemies) if (e.tagged > 0) e.tagged -= dt;
  G.parts.update(dt);
  for (const m of G.msgs) m.t -= dt;
  G.msgs = G.msgs.filter(m => m.t > 0);
  G.shake *= Math.pow(0.02, dt); G.flash *= Math.pow(0.05, dt);
  if (G.demo) demoTick(dt);
}
