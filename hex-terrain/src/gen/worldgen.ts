import { hexDistance } from '../core/hex';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { MAX_LEVEL, type BiomeId } from '../model/biomes';
import type { FeatureId } from '../model/features';
import type { HexMap } from '../model/map';

export interface WorldGenOptions {
  seed: number;
  /** Fraction of the map covered by sea (roughly). */
  sea?: number;
  /** -1 (cold) .. 1 (hot) climate shift. */
  warmth?: number;
  /** -1 (dry) .. 1 (wet). */
  wetness?: number;
  settlements?: boolean;
}

interface Cell {
  e: number;
  t: number;
  m: number;
}

/**
 * Fill a map with a plausible world: continents from noise, climate bands,
 * rivers that run downhill to the sea, settlements where life is easy and a
 * road network connecting them.
 */
export function generateWorld(map: HexMap, opts: WorldGenOptions): void {
  const rng = new Rng(opts.seed);
  const nE = new Noise2D(opts.seed + 1);
  const nM = new Noise2D(opts.seed + 2);
  const nT = new Noise2D(opts.seed + 3);
  const n = map.size;
  const seaFrac = opts.sea ?? 0.32;
  const warmth = opts.warmth ?? 0;
  const wetness = opts.wetness ?? 0;
  const cells: Cell[] = new Array(n);

  const cols = map.cols;
  const rows = map.rows;
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = (i - col) / cols;
    const x = col / cols;
    const y = (row + (col & 1) * 0.5) / rows;
    const aspect = cols / rows;
    // Continental shape: noise plus a gentle falloff toward the map border.
    const dx = (x - 0.5) * 2;
    const dy = (y - 0.5) * 2;
    const edge = Math.max(Math.abs(dx), Math.abs(dy));
    let e = nE.fbm(x * 2.2 * aspect, y * 2.2, 5) * 0.9 + nE.ridged(x * 3 * aspect + 9, y * 3 + 4, 3) * 0.55;
    e -= Math.pow(edge, 3) * 0.75;
    const t = 0.04 + y * 0.96 + nT.fbm(x * 2.5, y * 2.5, 3) * 0.22 + warmth * 0.25;
    const m = 0.5 + nM.fbm(x * 2.6 * aspect, y * 2.6, 4) * 1.0 + wetness * 0.25;
    cells[i] = { e, t, m };
  }

  // Sea level from the requested sea fraction.
  const sorted = cells.map((c) => c.e).sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(seaFrac * (n - 1))];
  const landMax = sorted[n - 1];

  const biome: BiomeId[] = new Array(n);
  const level = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (c.e < seaLevel) {
      biome[i] = 'ocean';
      continue;
    }
    const h = (c.e - seaLevel) / (landMax - seaLevel);
    const lvl = h < 0.14 ? 0 : h < 0.3 ? 1 : h < 0.48 ? 2 : h < 0.68 ? 3 : 4;
    level[i] = Math.min(MAX_LEVEL, lvl);
    // Cooler with altitude.
    const t = c.t - lvl * 0.07;
    biome[i] = pickBiome(t, c.m, lvl, rng);
  }

  // Coastal moisture: land next to sea gets wetter.
  for (let i = 0; i < n; i++) {
    if (biome[i] === 'ocean') continue;
    if (biome[i] === 'desert' && map.neighbors(i).filter((nb) => biome[nb] === 'ocean').length >= 3) biome[i] = 'savanna';
  }

  // A volcano or two among the high peaks.
  const peaks = [...Array(n).keys()].filter((i) => biome[i] !== 'ocean' && level[i] === 4);
  const volcanoes = Math.min(peaks.length, rng.int(0, 3));
  for (let k = 0; k < volcanoes; k++) {
    const p = rng.pick(peaks);
    biome[p] = 'volcanic';
    for (const nb of map.neighbors(p)) if (biome[nb] !== 'ocean' && level[nb] >= 2 && rng.chance(0.5)) biome[nb] = 'volcanic';
  }

  // Inland lakes in some local minima.
  for (let i = 0; i < n; i++) {
    if (biome[i] === 'ocean' || level[i] > 2) continue;
    const nbs = map.neighbors(i);
    if (nbs.length < 6 || nbs.some((nb) => biome[nb] === 'ocean')) continue;
    if (nbs.every((nb) => cells[nb].e >= cells[i].e) && rng.chance(0.55)) biome[i] = 'lake';
  }

  map.batch(() => {
    map.fill('ocean');
    for (let i = 0; i < n; i++) {
      map.setBiome(i, biome[i]);
      map.setLevel(i, biome[i] === 'ocean' ? 0 : level[i]);
    }
    const isWater = (i: number) => biome[i] === 'ocean' || biome[i] === 'lake';

    // ---- rivers ----
    const riverCount = Math.round(n / 70) + rng.int(0, 3);
    const sources = [...Array(n).keys()]
      .filter((i) => !isWater(i) && level[i] >= 2 && cells[i].m > 0.45 && biome[i] !== 'volcanic')
      .sort(() => rng.next() - 0.5);
    const onRiver = new Uint8Array(n);
    let made = 0;
    for (const src of sources) {
      if (made >= riverCount) break;
      if (onRiver[src] || map.neighbors(src).some((nb) => onRiver[nb])) continue;
      const path = [src];
      const seen = new Set(path);
      let cur = src;
      let ok = false;
      for (let steps = 0; steps < 60; steps++) {
        let best = -1;
        let bestE = Infinity;
        for (const nb of map.neighbors(cur)) {
          if (seen.has(nb)) continue;
          const ev = isWater(nb) ? -10 : cells[nb].e + level[nb] * 0.05 + rng.next() * 0.02;
          if (ev < bestE) {
            bestE = ev;
            best = nb;
          }
        }
        if (best < 0) break;
        path.push(best);
        seen.add(best);
        if (isWater(best) || onRiver[best]) {
          ok = true;
          break;
        }
        cur = best;
      }
      if (!ok || path.length < 3) continue;
      for (let k = 0; k + 1 < path.length; k++) {
        map.connect('river', path[k], path[k + 1]);
        if (!isWater(path[k])) onRiver[path[k]] = 1;
      }
      made++;
    }

    if (opts.settlements === false) return;

    // ---- settlements ----
    const habitable = (i: number) => !isWater(i) && biome[i] !== 'snow' && biome[i] !== 'volcanic';
    const score = (i: number) => {
      if (!habitable(i)) return -Infinity;
      let sc = 1 - level[i] * 0.3;
      if (onRiver[i]) sc += 0.8;
      if (map.neighbors(i).some((nb) => biome[nb] === 'ocean')) sc += 0.6;
      if (['grassland', 'forest', 'savanna', 'jungle'].includes(biome[i])) sc += 0.5;
      if (biome[i] === 'desert' || biome[i] === 'tundra') sc -= 0.4;
      return sc + rng.next() * 0.6;
    };
    const ranked = [...Array(n).keys()].filter(habitable).sort((a, b) => score(b) - score(a));
    const placed: { i: number; f: FeatureId }[] = [];
    const farFrom = (i: number, minD: number) => placed.every((p) => hexDistance(map.axialOf(p.i), map.axialOf(i)) >= minD);
    const put = (i: number, f: FeatureId) => {
      map.setFeature(i, f);
      placed.push({ i, f });
    };
    const scale = n / 400;
    const towns = Math.max(1, Math.round(2.5 * scale));
    const villages = Math.max(2, Math.round(7 * scale));
    for (const i of ranked) {
      if (placed.filter((p) => p.f === 'town').length >= towns) break;
      if (level[i] <= 1 && farFrom(i, 6)) put(i, 'town');
    }
    for (const i of ranked) {
      if (placed.filter((p) => p.f === 'village').length >= villages) break;
      if (level[i] <= 2 && farFrom(i, 3)) put(i, 'village');
    }
    // Farms next to settlements on arable land.
    for (const p of placed.slice()) {
      if (p.f !== 'village' && p.f !== 'town') continue;
      const opts2 = map.neighbors(p.i).filter((nb) => habitable(nb) && !map.featureAt(nb) && level[nb] <= 1 && !['desert', 'badlands', 'tundra', 'conifer'].includes(biome[nb]));
      const k = p.f === 'town' ? 2 : 1;
      for (let j = 0; j < k && opts2.length; j++) {
        const f = opts2.splice(rng.int(0, opts2.length), 1)[0];
        if (rng.chance(0.75)) put(f, 'farm');
      }
    }
    // Castles on hills near towns, towers and mines in the high country, a few ruins.
    const hills = ranked.filter((i) => (level[i] === 2 || level[i] === 3) && !map.featureAt(i));
    for (const i of hills) {
      if (placed.filter((p) => p.f === 'castle').length >= Math.max(1, Math.round(1.5 * scale))) break;
      if (farFrom(i, 4)) put(i, 'castle');
    }
    const high = [...Array(n).keys()].filter((i) => habitable(i) && level[i] >= 3 && !map.featureAt(i)).sort(() => rng.next() - 0.5);
    let mines = 0;
    let towers = 0;
    for (const i of high) {
      if (mines < Math.round(2 * scale) && farFrom(i, 2)) {
        put(i, 'mine');
        mines++;
      } else if (towers < Math.round(1.5 * scale) && farFrom(i, 3)) {
        put(i, 'tower');
        towers++;
      }
    }
    const any = [...Array(n).keys()].filter((i) => habitable(i) && !map.featureAt(i)).sort(() => rng.next() - 0.5);
    for (let k = 0, placedRuins = 0; k < any.length && placedRuins < Math.round(2 * scale); k++) {
      if (farFrom(any[k], 3)) {
        put(any[k], 'ruins');
        placedRuins++;
      }
    }

    // ---- roads: minimum spanning tree over settlements, routed with A* ----
    const hubs = placed.filter((p) => p.f === 'town' || p.f === 'village' || p.f === 'castle').map((p) => p.i);
    const connected = new Set<number>(hubs.slice(0, 1));
    const edges: [number, number][] = [];
    while (connected.size < hubs.length) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (const a of connected) {
        for (const b of hubs) {
          if (connected.has(b)) continue;
          const d = hexDistance(map.axialOf(a), map.axialOf(b));
          if (d < bestD) {
            bestD = d;
            best = [a, b];
          }
        }
      }
      if (!best) break;
      connected.add(best[1]);
      if (bestD <= 9) edges.push(best);
    }
    for (const [a, b] of edges) {
      const path = route(map, a, b, (i) => {
        if (isWater(i)) return Infinity;
        let c = 1 + level[i] * 0.9;
        if (['forest', 'jungle', 'swamp', 'conifer'].includes(biome[i])) c += 0.8;
        if (map.rivers[i]) c += 0.6;
        if (map.roads[i]) c *= 0.45;
        return c;
      });
      if (!path) continue;
      for (let k = 0; k + 1 < path.length; k++) map.connect('road', path[k], path[k + 1]);
    }
  });
}

function pickBiome(t: number, m: number, lvl: number, rng: Rng): BiomeId {
  if (t < 0.07) return 'snow';
  if (t < 0.25) return m > 0.5 ? 'conifer' : 'tundra';
  if (t < 0.55) {
    if (lvl >= 3) return m > 0.5 ? 'conifer' : 'grassland';
    if (m > 0.95 && lvl === 0) return 'swamp';
    if (m > 0.52) return 'forest';
    return rng.chance(0.15) ? 'forest' : 'grassland';
  }
  if (t < 0.78) {
    if (m < 0.18) return 'badlands';
    if (m < 0.38) return 'savanna';
    if (m > 0.95 && lvl === 0) return 'swamp';
    return m > 0.62 ? 'forest' : 'grassland';
  }
  if (m < 0.34) return lvl >= 2 && rng.chance(0.5) ? 'badlands' : 'desert';
  if (m < 0.55) return 'savanna';
  return 'jungle';
}

/** A* over the hex grid with a per-hex entry cost. */
function route(map: HexMap, from: number, to: number, cost: (i: number) => number): number[] | null {
  const goal = map.axialOf(to);
  const open = new Map<number, number>([[from, 0]]);
  const g = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  while (open.size) {
    let cur = -1;
    let best = Infinity;
    for (const [k, f] of open) if (f < best) {
      best = f;
      cur = k;
    }
    if (cur === to) {
      const path = [cur];
      while (came.has(cur)) {
        cur = came.get(cur)!;
        path.push(cur);
      }
      return path.reverse();
    }
    open.delete(cur);
    for (const nb of map.neighbors(cur)) {
      const c = nb === to ? 1 : cost(nb);
      if (!Number.isFinite(c)) continue;
      const ng = (g.get(cur) ?? 0) + c;
      if (ng < (g.get(nb) ?? Infinity)) {
        g.set(nb, ng);
        came.set(nb, cur);
        open.set(nb, ng + hexDistance(map.axialOf(nb), goal) * 0.9);
      }
    }
  }
  return null;
}
