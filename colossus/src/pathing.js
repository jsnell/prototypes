// Flow fields (Dijkstra) for swarm units, A* for the Colossus.
import { MAP_W as W, MAP_D as D, WATER_LEVEL } from './config.js';
import { clamp } from './util.js';

const N = W * D;
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

class Heap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k2 = new Float32Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const top = V[0];
    this.popKey = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return top;
  }
}

export class Pathing {
  constructor(G) {
    this.G = G;
    this.T = G.terrain;
    this.block = new Uint8Array(N);
    this.tankBlock = new Uint8Array(N);
    this.tankCost = new Float32Array(N);
    this.fields = new Map();
    this.heap = new Heap(N * 2);
    this.version = 0;
    this.budget = 2;
    // per-cell neighbour masks + edge costs, per unit class
    this.mask = [new Uint8Array(N), new Uint8Array(N)];
    this.ecost = [new Float32Array(N * 8), new Float32Array(N * 8)];
    this.computeEdges(0, 0, W - 1, D - 1);
    this.computeTankCost(0, 0, W - 1, D - 1);
    this.T.listeners.push((i0, j0, i1, j1) => {
      this.computeTankCost(i0 - 4, j0 - 4, i1 + 4, j1 + 4);
      this.computeEdges(i0 - 2, j0 - 2, i1 + 2, j1 + 2);
      this.version++;
    });
  }
  tick() { this.budget = 1; }

  computeEdges(i0, j0, i1, j1) {
    const T = this.T;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(W - 1, i1); j1 = Math.min(D - 1, j1);
    for (let cls = 0; cls < 2; cls++) {
      const M = this.mask[cls], E = this.ecost[cls];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        let m = 0;
        for (let q = 0; q < 8; q++) {
          const ni = i + NB[q][0], nj = j + NB[q][1];
          if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue;
          const nk = nj * W + ni;
          if (!this.passable(cls, nk) || !this.stepOk(cls, k, nk)) continue;
          if (q >= 4) {
            const c1 = j * W + ni, c2 = nj * W + i;
            if (!this.passable(cls, c1) || !this.passable(cls, c2)) continue;
          }
          m |= 1 << q;
          let c = NB[q][2];
          if (cls === 0 && T.H[nk] < WATER_LEVEL && !T.bridge[nk]) c *= 1.6;
          c += Math.abs(this.effH(cls, nk) - this.effH(cls, k)) * 0.3;
          E[k * 8 + q] = c;
        }
        M[k] = m;
      }
    }
  }

  // ---- unit classes: 0 = ground, 1 = hover
  effH(cls, k) {
    const T = this.T;
    if (cls === 0) return T.bridge[k] ? 5 : T.H[k];
    return Math.max(T.H[k], 4);
  }
  passable(cls, k) {
    if (this.block[k]) return false;
    if (cls === 1) return true;
    return this.T.H[k] >= 4 || this.T.bridge[k] === 1;
  }
  stepOk(cls, a, b) { return Math.abs(this.effH(cls, a) - this.effH(cls, b)) <= 1; }

  canMove(cls, x0, z0, x1, z1) {
    const i1 = Math.floor(x1), j1 = Math.floor(z1);
    if (i1 < 1 || j1 < 1 || i1 >= W - 1 || j1 >= D - 1) return false;
    const i0 = Math.floor(x0), j0 = Math.floor(z0);
    if (i0 === i1 && j0 === j1) return true;
    const a = j0 * W + i0, b = j1 * W + i1;
    if (!this.passable(cls, b)) return !this.passable(cls, a) && this.effH(cls, b) <= this.effH(cls, a) + 1;
    if (!this.passable(cls, a)) return true;
    if (!this.stepOk(cls, a, b)) return false;
    if (i0 !== i1 && j0 !== j1) {
      const c1 = j0 * W + i1, c2 = j1 * W + i0;
      const ok1 = this.passable(cls, c1) && this.stepOk(cls, a, c1);
      const ok2 = this.passable(cls, c2) && this.stepOk(cls, a, c2);
      if (!ok1 && !ok2) return false;
    }
    return true;
  }

  setBlock(x, z, half, v, tankToo = false) {
    for (let j = Math.floor(z - half); j < Math.ceil(z + half); j++) for (let i = Math.floor(x - half); i < Math.ceil(x + half); i++) {
      if (i < 0 || j < 0 || i >= W || j >= D) continue;
      this.block[j * W + i] = v;
      if (tankToo) this.tankBlock[j * W + i] = v;
    }
    if (tankToo) this.computeTankCost(Math.floor(x - half) - 4, Math.floor(z - half) - 4, Math.ceil(x + half) + 4, Math.ceil(z + half) + 4);
    this.computeEdges(Math.floor(x - half) - 2, Math.floor(z - half) - 2, Math.ceil(x + half) + 2, Math.ceil(z + half) + 2);
    this.version++;
  }

  // flow field toward (gx,gz); every cell within r of the goal is a sink
  field(cls, gx, gz, r = 1) {
    const gi = clamp(Math.floor(gx), 0, W - 1), gj = clamp(Math.floor(gz), 0, D - 1);
    const key = cls + ':' + gi + ':' + gj + ':' + Math.round(r);
    let f = this.fields.get(key);
    if (f && (f.version === this.version || this.budget <= 0)) return f;
    if (f) { this.budget--; this.fields.delete(key); }
    const dist = f ? f.dist.fill(Infinity) : new Float32Array(N).fill(Infinity);
    const H = this.heap; H.clear();
    const ri = Math.ceil(r) + 1;
    let seeded = 0;
    for (let rr = 0; rr < 14 && !seeded; rr++) {
      const rad = rr === 0 ? ri : ri + rr;
      for (let j = gj - rad; j <= gj + rad; j++) for (let i = gi - rad; i <= gi + rad; i++) {
        if (i < 0 || j < 0 || i >= W || j >= D) continue;
        const d = Math.hypot(i + 0.5 - gx, j + 0.5 - gz);
        if (d > (rr === 0 ? r + 0.5 : rad)) continue;
        const k = j * W + i;
        if (!this.passable(cls, k)) continue;
        dist[k] = rr === 0 ? 0 : d * 0.01; H.push(dist[k], k); seeded++;
      }
    }
    const M = this.mask[cls], E = this.ecost[cls];
    const OFF = [1, -1, W, -W, W + 1, -W + 1, W - 1, -W - 1];
    while (H.n > 0) {
      const k = H.pop();
      const dk = H.popKey;
      if (dk > dist[k]) continue;
      const m = M[k];
      if (!m) continue;
      for (let q = 0; q < 8; q++) {
        if (!(m & (1 << q))) continue;
        const nk = k + OFF[q];
        const nd = dk + E[k * 8 + q];
        if (nd < dist[nk]) { dist[nk] = nd; H.push(nd, nk); }
      }
    }
    f = { dist, cls, version: this.version };
    if (this.fields.size > 48) this.fields.delete(this.fields.keys().next().value);
    this.fields.set(key, f);
    return f;
  }

  // direction to follow on a field, or null when at the sink / lost
  dirAt(f, x, z) {
    const i = Math.floor(x), j = Math.floor(z);
    if (i < 0 || j < 0 || i >= W || j >= D) return null;
    const k = j * W + i, cls = f.cls;
    let best = f.dist[k], bk = -1, bi = 0, bj = 0;
    if (best === 0) return null;
    const free = !this.passable(cls, k);
    const m = this.mask[cls][k];
    for (let q = 0; q < 8; q++) {
      const ni = i + NB[q][0], nj = j + NB[q][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue;
      if (!free && !(m & (1 << q))) continue;
      const nk = nj * W + ni;
      const d = f.dist[nk];
      if (d >= best) continue;
      best = d; bk = nk; bi = ni; bj = nj;
    }
    if (bk < 0) return null;
    const dx = bi + 0.5 - x, dz = bj + 0.5 - z;
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  // ---- the Colossus
  computeTankCost(i0, j0, i1, j1) {
    const H = this.T.H;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(W - 1, i1); j1 = Math.min(D - 1, j1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (i < 6 || j < 6 || i >= W - 6 || j >= D - 6 || this.tankBlock[k]) { this.tankCost[k] = Infinity; continue; }
        let mn = 99, mx = -99;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
          const h = H[(j + dj) * W + i + di];
          if (h < mn) mn = h; if (h > mx) mx = h;
        }
        const range = mx - mn;
        const depth = WATER_LEVEL - mn;
        if (range > 5 || depth > 3.4) { this.tankCost[k] = Infinity; continue; }
        this.tankCost[k] = 1 + range * 0.35 + (H[k] < WATER_LEVEL ? 1.3 : 0);
      }
    }
  }
  tankOk(x, z) {
    const i = Math.floor(x), j = Math.floor(z);
    if (i < 0 || j < 0 || i >= W || j >= D) return false;
    return this.tankCost[j * W + i] < Infinity;
  }
  tankLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.7);
    for (let s = 0; s <= n; s++) {
      const t = s / (n || 1);
      const i = Math.floor(ax + (bx - ax) * t), j = Math.floor(az + (bz - az) * t);
      const c = this.tankCost[j * W + i];
      if (!(c < 3.2)) return false;
    }
    return true;
  }
  nearestTankCell(x, z, maxR = 20) {
    const gi = Math.floor(x), gj = Math.floor(z);
    for (let r = 0; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let j = gj - r; j <= gj + r; j++) for (let i = gi - r; i <= gi + r; i++) {
        if (Math.max(Math.abs(i - gi), Math.abs(j - gj)) !== r) continue;
        if (i < 0 || j < 0 || i >= W || j >= D) continue;
        const k = j * W + i;
        if (this.tankCost[k] < Infinity) { const d = Math.hypot(i - gi, j - gj); if (d < bd) { bd = d; best = k; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  tankPath(sx, sz, gx, gz) {
    let s = this.nearestTankCell(sx, sz, 8), g = this.nearestTankCell(gx, gz, 24);
    if (s < 0 || g < 0) return null;
    const gi0 = g % W, gj0 = (g / W) | 0;
    const gscore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const H = this.heap; H.clear();
    const h = (k) => { const di = Math.abs(k % W - gi0), dj = Math.abs(((k / W) | 0) - gj0); return (di + dj) + (1.4142 - 2) * Math.min(di, dj); };
    gscore[s] = 0; H.push(h(s), s);
    let found = false, iter = 0;
    while (H.n > 0 && iter++ < 60000) {
      const k = H.pop();
      if (k === g) { found = true; break; }
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % W, j = (k / W) | 0;
      for (let q = 0; q < 8; q++) {
        const ni = i + NB[q][0], nj = j + NB[q][1];
        const nk = nj * W + ni;
        const c = this.tankCost[nk];
        if (!(c < Infinity) || closed[nk]) continue;
        const ng = gscore[k] + NB[q][2] * c;
        if (ng < gscore[nk]) { gscore[nk] = ng; came[nk] = k; H.push(ng + h(nk), nk); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = g; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    // string pulling
    const pts = cells.map((k) => ({ x: k % W + 0.5, z: ((k / W) | 0) + 0.5 }));
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = a + 1;
      while (b + 1 < pts.length && this.tankLine(pts[a].x, pts[a].z, pts[b + 1].x, pts[b + 1].z)) b++;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }
}
