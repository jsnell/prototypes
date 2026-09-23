'use strict';
// ---------- map generation: sectors separated by rock ridges with gaps ----------
const T_GROUND = 0, T_ROCK = 1, T_ORE = 2;

function generateMap(seed) {
  const rng = mulberry32(seed);
  const nz = makeNoise(seed + 11);
  const COLS = 6, ROWS = 3;
  const tiles = new Uint8Array(GW * GH);
  const sectorOf = new Int16Array(GW * GH);
  const sectors = [];
  const cw = GW / COLS, ch = GH / ROWS;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const jx = c === 0 ? 0.35 : 0.5, jy = 0.5;
    sectors.push({
      id: sectors.length, col: c, row: r,
      sx: (c + jx + (rng() - 0.5) * 0.5) * cw, sy: (r + jy + (rng() - 0.5) * 0.5) * ch,
      tiles: [], nb: new Set(), hive: c === COLS - 1, claimed: false, ore: [],
    });
  }
  // voronoi with warped distance for organic borders
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const wx = x + nz(x * 0.12, y * 0.12) * 2.4, wy = y + nz(x * 0.12 + 50, y * 0.12) * 2.4;
    let best = 1e9, bi = 0;
    for (const s of sectors) { const d = dist2(wx, wy, s.sx, s.sy * 1.0); if (d < best) { best = d; bi = s.id; } }
    sectorOf[y * GW + x] = bi; sectors[bi].tiles.push(y * GW + x);
  }
  // borders
  const pairTiles = new Map();
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const a = sectorOf[y * GW + x];
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy; if (nx >= GW || ny >= GH) continue;
      const b = sectorOf[ny * GW + nx]; if (a === b) continue;
      const key = Math.min(a, b) * 100 + Math.max(a, b);
      if (!pairTiles.has(key)) pairTiles.set(key, new Set());
      pairTiles.get(key).add(y * GW + x); pairTiles.get(key).add(ny * GW + nx);
      sectors[a].nb.add(b); sectors[b].nb.add(a);
    }
  }
  const gaps = [];
  const gapTiles = new Set();
  for (const [key, set] of pairTiles) {
    const a = Math.floor(key / 100), b = key % 100;
    const arr = [...set];
    for (const t of arr) tiles[t] = T_ROCK;
    if (arr.length < 6) continue;
    // centroid of border, pick nearest tile as gap centre; long borders get a second gap
    let mx = 0, my = 0; for (const t of arr) { mx += t % GW; my += Math.floor(t / GW); }
    mx /= arr.length; my /= arr.length;
    const centres = [];
    let c0 = arr.reduce((bst, t) => dist2(t % GW, Math.floor(t / GW), mx, my) < dist2(bst % GW, Math.floor(bst / GW), mx, my) ? t : bst, arr[0]);
    centres.push(c0);
    if (arr.length > 34 && rng() < 0.6) {
      const far = arr.reduce((bst, t) => dist2(t % GW, Math.floor(t / GW), c0 % GW, Math.floor(c0 / GW)) > dist2(bst % GW, Math.floor(bst / GW), c0 % GW, Math.floor(c0 / GW)) ? t : bst, arr[0]);
      // second gap halfway between centre and far end
      const hx = (c0 % GW + far % GW) / 2, hy = (Math.floor(c0 / GW) + Math.floor(far / GW)) / 2;
      const c1 = arr.reduce((bst, t) => dist2(t % GW, Math.floor(t / GW), hx, hy) < dist2(bst % GW, Math.floor(bst / GW), hx, hy) ? t : bst, arr[0]);
      centres.push(c1);
    }
    for (const c of centres) {
      const cx = c % GW, cy = Math.floor(c / GW);
      const rad = 1.5 + rng() * 0.5;
      const gt = arr.filter(t => dist2(t % GW, Math.floor(t / GW), cx, cy) <= rad * rad);
      gaps.push({ a, b, tiles: gt, tx: cx, ty: cy, x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE });
      for (const t of gt) gapTiles.add(t);
    }
  }
  // map edge ridges are unnecessary; clear gaps (after all ridges so junctions don't plug them)
  for (const t of gapTiles) tiles[t] = T_GROUND;
  for (const g of gaps) tiles[g.ty * GW + g.tx] = T_GROUND;
  // scattered outcrops for texture
  for (const s of sectors) {
    const n = Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const t = s.tiles[Math.floor(rng() * s.tiles.length)];
      const cx = t % GW, cy = Math.floor(t / GW);
      if (gaps.some(g => dist2(g.tx, g.ty, cx, cy) < 36)) continue;
      const r = 0.8 + rng() * 1.2;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy; if (x < 1 || y < 1 || x >= GW - 1 || y >= GH - 1) continue;
        if (dx * dx + dy * dy <= r * r + nz(x, y) && sectorOf[y * GW + x] === s.id) tiles[y * GW + x] = T_ROCK;
      }
    }
  }
  // HQ: in col 0, row 1
  const home = sectors[1 * COLS + 0];
  home.claimed = true;
  let hqx = clamp(Math.round(home.sx - 2), 2, GW - 8), hqy = clamp(Math.round(home.sy - 1.5), 3, GH - 6);
  for (let y = hqy - 2; y < hqy + 5; y++) for (let x = hqx - 2; x < hqx + 6; x++) {
    if (x >= 0 && y >= 0 && x < GW && y < GH && sectorOf[y * GW + x] === home.id) tiles[y * GW + x] = T_GROUND;
  }
  // connectivity: flood from hq, rock-fill unreachable pockets
  const seen = new Uint8Array(GW * GH); const q = [hqy * GW + hqx]; seen[q[0]] = 1;
  while (q.length) {
    const t = q.pop(); const x = t % GW, y = Math.floor(t / GW);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx; if (seen[n] || tiles[n] === T_ROCK) continue; seen[n] = 1; q.push(n);
    }
  }
  for (let i = 0; i < GW * GH; i++) if (!seen[i]) tiles[i] = T_ROCK;
  // ore deposits (2x2)
  const okOre = (x, y) => {
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
      const X = x + dx, Y = y + dy; if (X < 1 || Y < 1 || X >= GW - 1 || Y >= GH - 1) return false;
      const t = Y * GW + X; if (tiles[t] !== T_GROUND || gapTiles.has(t)) return false;
      if (X >= hqx - 1 && X < hqx + 5 && Y >= hqy - 1 && Y < hqy + 4) return false;
    }
    const s = sectorOf[y * GW + x];
    return sectorOf[(y + 1) * GW + x + 1] === s && sectorOf[y * GW + x + 1] === s && sectorOf[(y + 1) * GW + x] === s;
  };
  for (const s of sectors) {
    if (s.hive) continue;
    const want = s === home ? 2 : (s.col >= 3 ? 2 + (rng() < 0.5 ? 1 : 0) : 1 + (rng() < 0.6 ? 1 : 0));
    for (let tries = 0; tries < 200 && s.ore.length < want; tries++) {
      const t = s.tiles[Math.floor(rng() * s.tiles.length)];
      const x = t % GW, y = Math.floor(t / GW);
      if (!okOre(x, y)) continue;
      if (s.ore.some(o => dist2(o.x, o.y, x, y) < 25)) continue;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tiles[(y + dy) * GW + x + dx] = T_ORE;
      s.ore.push({ x, y });
    }
  }
  // adjacency is defined by passable gaps, not by touching borders
  for (const s of sectors) s.nb = new Set();
  for (const g of gaps) { sectors[g.a].nb.add(g.b); sectors[g.b].nb.add(g.a); }
  // per-sector gap posts (point on the sector's own side of each gap)
  for (const g of gaps) {
    g.post = {};
    for (const sid of [g.a, g.b]) {
      const s = sectors[sid];
      // step from gap centre toward sector seed a couple of tiles
      const dx = s.sx - g.tx, dy = s.sy - g.ty, l = Math.hypot(dx, dy) || 1;
      let px = g.tx + dx / l * 3, py = g.ty + dy / l * 3;
      let tx = clamp(Math.round(px), 0, GW - 1), ty = clamp(Math.round(py), 0, GH - 1);
      if (tiles[ty * GW + tx] === T_ROCK) { tx = g.tx; ty = g.ty; }
      g.post[sid] = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, nx: -dx / l, ny: -dy / l };
    }
  }
  const map = { seed, tiles, sectorOf, sectors, gaps, gapTiles, hq: { x: hqx, y: hqy }, cols: COLS, rows: ROWS };
  // centroid of each sector's walkable tiles (for labels)
  for (const s of sectors) {
    let mx = 0, my = 0, n = 0;
    for (const t of s.tiles) if (tiles[t] !== T_ROCK) { mx += t % GW; my += Math.floor(t / GW); n++; }
    s.cx = n ? (mx / n + 0.5) * TILE : s.sx * TILE; s.cy = n ? (my / n + 0.5) * TILE : s.sy * TILE; s.area = n;
    s.richness = s.ore.length;
  }
  return map;
}

// ---------- terrain bake: per-pixel albedo / height / normal / emissive ----------
function bakeTerrain(map, biome) {
  const B = biome, nz = makeNoise(map.seed + 3), nz2 = makeNoise(map.seed + 7);
  const alb = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4), emi = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const g1 = hex(B.g1), g2 = hex(B.g2), g3 = hex(B.g3), r1 = hex(B.r1), r2 = hex(B.r2);
  // rock distance field at pixel level (smooth ridges): blur the tile mask
  const rockT = new Float32Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) rockT[i] = map.tiles[i] === T_ROCK ? 1 : 0;
  const sampleRock = (px, py) => {
    const fx = px / TILE - 0.5, fy = py / TILE - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const g = (x, y) => (x < 0 || y < 0 || x >= GW || y >= GH) ? 0 : rockT[y * GW + x];
    return lerp(lerp(g(x0, y0), g(x0 + 1, y0), tx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), tx), ty);
  };
  const rng = mulberry32(map.seed + 99);
  const craters = [];
  if (B.feature === 'craters') for (let i = 0; i < 28; i++) craters.push({ x: rng() * W, y: rng() * H, r: 4 + rng() * rng() * 22 });
  const col = new Float32Array(W * H * 3), spec = new Float32Array(W * H), em = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const n1 = fbm(nz, x * 0.02, y * 0.02, 4), n2 = fbm(nz2, x * 0.09, y * 0.09, 3), n3 = nz(x * 0.4, y * 0.4);
    let rk = sampleRock(x + n2 * 3, y + n1 * 3);
    let h = 1.2 + n1 * 1.5 + n2 * 0.8 + (rng() < 0.03 ? rng() * 1.2 : 0);
    let c = mix3(mix3(g2, g1, clamp(n1 * 0.8 + 0.55, 0, 1)), g3, clamp(n2 * 1.2, 0, 1) * 0.6);
    let s = B.spec * (0.6 + n3 * 0.3), e = null;
    for (const cr of craters) {
      const d = Math.hypot(x - cr.x, y - cr.y) / cr.r;
      if (d < 1.3) { h += d < 1 ? -(1 - d * d) * cr.r * 0.12 : 0; h += Math.exp(-Math.pow((d - 1) / 0.15, 2)) * cr.r * 0.08; if (d < 0.9) c = mix3(c, g2, 0.35); }
    }
    if (B.feature === 'drifts') { const dr = fbm(nz2, x * 0.015, y * 0.05, 3); h += Math.max(0, dr) * 5; c = mix3(c, g3, clamp(dr * 2, 0, 1)); s += Math.max(0, dr) * 0.3; }
    if (B.feature === 'lava') {
      const ridge = Math.abs(fbm(nz2, x * 0.018, y * 0.018, 4));
      if (ridge < 0.045 && rk < 0.2) { const k = 1 - ridge / 0.045; e = [1.0 * k, 0.28 * k * k, 0.03 * k]; c = mix3(c, [0.4, 0.1, 0.02], k); h -= k * 1.5; }
    }
    if (B.feature === 'glowflora' && rk < 0.3) {
      const f = nz(x * 0.7 + 13, y * 0.7);
      if (f > 0.62 && n1 > -0.1) { e = rng() < 0.5 ? [0.05, 0.35, 0.3] : [0.25, 0.1, 0.4]; h += 1; c = [0.2, 0.3, 0.25]; }
    }
    if (rk > 0.02) {
      const rh = smoothstep(0.05, 0.75, rk);
      const strata = Math.sin((x * 0.3 + y * 0.9) * 0.4 + n2 * 4) * 0.5 + 0.5;
      h = lerp(h, 9 + rh * 9 + n2 * 4 + n3 * 1.2, rh);
      c = mix3(c, mix3(r1, r2, strata * 0.7 + n3 * 0.2), rh);
      s = lerp(s, B.spec * 0.7 + 0.1, rh);
      if (B.feature === 'drifts' && n2 > 0.1) c = mix3(c, g3, 0.6 * rh);
    }
    hgt[i] = h;
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; spec[i] = s;
    if (e) { em[i * 3] = e[0]; em[i * 3 + 1] = e[1]; em[i * 3 + 2] = e[2]; }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, j = i * 4;
    const hL = hgt[y * W + Math.max(0, x - 1)], hR = hgt[y * W + Math.min(W - 1, x + 1)];
    const hU = hgt[Math.max(0, y - 1) * W + x], hD = hgt[Math.min(H - 1, y + 1) * W + x];
    const nx = (hL - hR) * 0.5, ny = (hU - hD) * 0.5, l = Math.hypot(nx, ny, 1);
    alb[j] = col[i * 3] * 255; alb[j + 1] = col[i * 3 + 1] * 255; alb[j + 2] = col[i * 3 + 2] * 255; alb[j + 3] = 255;
    nrm[j] = (nx / l * 0.5 + 0.5) * 255; nrm[j + 1] = (ny / l * 0.5 + 0.5) * 255; nrm[j + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[j + 3] = clamp(hgt[i] / HMAX, 0, 1) * 255;
    emi[j] = clamp(em[i * 3], 0, 1) * 255; emi[j + 1] = clamp(em[i * 3 + 1], 0, 1) * 255; emi[j + 2] = clamp(em[i * 3 + 2], 0, 1) * 255; emi[j + 3] = clamp(spec[i], 0, 1) * 255;
  }
  return { alb, nrm, emi, hgt };
}
