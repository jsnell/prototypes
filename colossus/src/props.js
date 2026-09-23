// Neutral set dressing that can be flattened: cottages, windmills, bridges.
import * as THREE from 'three';
import { MAP_W as W, WATER_LEVEL } from './config.js';
import { buildHouse, buildWindmill, buildBridgeSegment } from './models.js';
import { mulberry32, rand } from './util.js';

const HOUSE_COLORS = [[1, 0.95, 0.86], [0.9, 0.43, 0.32], [0.55, 0.35, 0.24]];

export class Props {
  constructor(G) {
    this.G = G;
    const T = G.terrain, L = G.layout;
    const rng = mulberry32(L.seed * 17 + 3);
    this.houses = [];
    this.windmills = [];
    for (const v of L.villages) {
      const n = 3 + Math.floor(rng() * 3);
      const placed = [];
      for (let k = 0; k < n * 4 && placed.length < n; k++) {
        const a = rng() * Math.PI * 2, r = 2 + rng() * 6;
        const x = Math.round(v.x + Math.cos(a) * r) + 0.5, z = Math.round(v.z + Math.sin(a) * r) + 0.5;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 4.2)) continue;
        const h = T.heightAt(x, z);
        if (h < WATER_LEVEL + 1) continue;
        let flat = true;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (T.heightAt(x + di, z + dj) !== h) flat = false;
        if (!flat) continue;
        placed.push({ x, z });
        const windmill = placed.length === 1 && rng() < 0.6;
        const b = windmill ? buildWindmill() : buildHouse(Math.floor(rng() * 8));
        const obj = windmill ? b.group : b.group;
        obj.position.set(x, h, z);
        obj.rotation.y = Math.floor(rng() * 4) * Math.PI / 2;
        G.scene.add(obj);
        const house = { x, z, y: h, obj, alive: true, windmill, blades: b.blades, chimney: b.chimney, smokeT: rng() * 3 };
        this.houses.push(house);
        G.pathing.setBlock(x, z, 1.5, 1, false);
      }
    }
    // bridges: contiguous bridge cells along the roads
    this.bridges = [];
    const seen = new Uint8Array(T.bridge.length);
    for (let k = 0; k < T.bridge.length; k++) {
      if (!T.bridge[k] || seen[k]) continue;
      // flood fill a component
      const comp = [], stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const c = stack.pop(); comp.push(c);
        const i = c % W, j = (c / W) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = (j + dj) * W + i + di;
          if (T.inside(i + di, j + dj) && T.bridge[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
      for (const c of comp) { const i = c % W, j = (c / W) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
      const horizontal = (i1 - i0) > (j1 - j0);
      const len = horizontal ? i1 - i0 + 3 : j1 - j0 + 3;
      const m = buildBridgeSegment(len, horizontal);
      m.position.set((i0 + i1 + 1) / 2, 4.9, (j0 + j1 + 1) / 2);
      G.scene.add(m);
      this.bridges.push({ cells: comp, obj: m, alive: true, x: m.position.x, z: m.position.z, i0, i1, j0, j1, fall: 0 });
    }
  }

  destroyHouse(h, crushed = false) {
    if (!h.alive) return;
    h.alive = false;
    const G = this.G;
    const cols = [];
    for (const c of HOUSE_COLORS) cols.push(...c);
    cols.push(0.95, 0.9, 0.8);
    G.fx.debrisBurst(h.x, h.y + 1, h.z, cols, crushed ? 16 : 22, crushed ? 5 : 8, 0.4);
    for (let k = 0; k < 8; k++) G.fx.puff(h.x + rand(-1.5, 1.5), h.y + rand(0, 2), h.z + rand(-1.5, 1.5), [0.86, 0.82, 0.75], 1.6, 2.2, 1.2);
    G.fx.shake(0.1, h.x, h.z);
    G.audio.play(crushed ? 'crush' : 'crack', { x: h.x, z: h.z, vol: 1 });
    h.dying = 0.001;
    G.pathing.setBlock(h.x, h.z, 1.5, 0, false);
    G.stats.houses++;
  }

  // explosion
  blast(x, z, r) {
    for (const h of this.houses) if (h.alive && Math.hypot(h.x - x, h.z - z) < r + 1.2) this.destroyHouse(h);
    for (const b of this.bridges) {
      if (!b.alive) continue;
      if (x > b.i0 - r && x < b.i1 + 1 + r && z > b.j0 - r && z < b.j1 + 1 + r) this.collapseBridge(b);
    }
  }

  crushIn(x, z, r, inside) {
    for (const h of this.houses) if (h.alive && Math.hypot(h.x - x, h.z - z) < r && inside(h.x, h.z)) this.destroyHouse(h, true);
    for (const b of this.bridges) {
      if (!b.alive) continue;
      for (const c of b.cells) {
        const cx = c % W + 0.5, cz = ((c / W) | 0) + 0.5;
        if (Math.hypot(cx - x, cz - z) < r && inside(cx, cz)) { this.collapseBridge(b); break; }
      }
    }
  }

  collapseBridge(b) {
    if (!b.alive) return;
    b.alive = false; b.fall = 0.001;
    const G = this.G, T = G.terrain;
    for (const c of b.cells) T.bridge[c] = 0;
    G.pathing.computeEdges(b.i0 - 2, b.j0 - 2, b.i1 + 2, b.j1 + 2);
    G.pathing.version++;
    G.fx.debrisBurst(b.x, 5, b.z, [0.69, 0.48, 0.29, 0.63, 0.42, 0.25], 20, 6, 0.4);
    G.fx.splash(b.x, WATER_LEVEL, b.z, 1.5);
    G.audio.play('crack', { x: b.x, z: b.z, vol: 1 });
    G.ui && G.ui.log('A bridge collapsed!', 'info');
  }

  update(dt, vt) {
    const G = this.G;
    for (const h of this.houses) {
      if (h.alive) {
        if (h.windmill && h.blades) h.blades.rotation.z = vt * 1.2;
        else if (h.chimney) {
          h.smokeT -= dt;
          if (h.smokeT <= 0) {
            h.smokeT = 0.5 + Math.random() * 0.6;
            const c = h.chimney.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), h.obj.rotation.y);
            G.fx.puff(h.x + c.x, h.y + c.y, h.z + c.z, [0.93, 0.93, 0.95], 0.6, 2.5, 0.9);
          }
        }
      } else if (h.dying) {
        h.dying += dt;
        const t = Math.min(1, h.dying / 0.6);
        h.obj.scale.set(1 + t * 0.2, Math.max(0.02, 1 - t), 1 + t * 0.2);
        if (t >= 1) { G.scene.remove(h.obj); h.dying = 0; }
      }
    }
    for (const b of this.bridges) {
      if (b.fall > 0 && b.fall < 3) {
        b.fall += dt;
        b.obj.position.y = 4.9 - b.fall * b.fall * 1.5;
        b.obj.rotation.z = Math.sin(b.fall * 3) * 0.1 * b.fall;
        if (b.fall >= 3) G.scene.remove(b.obj);
      }
    }
  }
}
