import { describe, expect, it } from 'vitest';
import { DIR_VECTORS, HexLayout } from '../src/core/hex';
import { HexMap } from '../src/model/map';
import { Sample, TerrainField } from '../src/render/field';
import { buildHexPaths } from '../src/render/paths';
import { generateWorld } from '../src/gen/worldgen';

function mixedMap(): HexMap {
  const m = new HexMap(8, 6, 3);
  const biomes = ['grassland', 'forest', 'desert', 'badlands', 'snow', 'volcanic', 'ocean', 'lake'] as const;
  for (let i = 0; i < m.size; i++) {
    m.setBiome(i, biomes[(i * 7) % biomes.length]);
    m.setLevel(i, (i * 3) % 5);
  }
  return m;
}

describe('TerrainField', () => {
  const map = mixedMap();
  const layout = new HexLayout(32);
  const field = new TerrainField(map, layout);
  const S = new Sample();

  it('produces normalised blend weights', () => {
    for (let k = 0; k < 400; k++) {
      const x = 20 + ((k * 37) % 300);
      const y = 20 + ((k * 53) % 250);
      if (!field.prepare(x, y, S)) continue;
      let wh = 0;
      let wc = 0;
      for (let j = 0; j < S.n; j++) {
        wh += S.wh[j];
        wc += S.wc[j];
      }
      expect(wh).toBeCloseTo(1, 5);
      expect(wc).toBeCloseTo(1, 5);
    }
  });

  it('is continuous across hex borders (no seams or cliffs from blending)', () => {
    // Walk along a line crossing many hexes; neighbouring samples stay close.
    let prev: number | null = null;
    let worst = 0;
    for (let x = 40; x < 360; x += 0.25) {
      const y = 100 + x * 0.3;
      if (!field.prepare(x, y, S)) {
        prev = null;
        continue;
      }
      const h = field.height(x, y, S);
      if (prev !== null) worst = Math.max(worst, Math.abs(h - prev));
      prev = h;
    }
    // A quarter pixel step should never jump more than a couple of pixels, even on mesas.
    expect(worst).toBeLessThan(2.5);
  });

  it('is deterministic', () => {
    const f2 = new TerrainField(mixedMap(), new HexLayout(32));
    const S2 = new Sample();
    for (const [x, y] of [[50, 60], [123.5, 77.25], [200, 180]]) {
      field.prepare(x, y, S);
      f2.prepare(x, y, S2);
      expect(field.height(x, y, S)).toBe(f2.height(x, y, S2));
    }
  });
});

describe('road and river paths', () => {
  it('meet exactly at the shared edge midpoint', () => {
    const L = new HexLayout(32);
    const ax = L.centerX(2);
    const ay = L.centerY(2, 1);
    for (let d = 0; d < 6; d++) {
      const bx = ax + DIR_VECTORS[d][0] * L.apothem * 2;
      const by = ay + DIR_VECTORS[d][1] * L.apothem * 2;
      const back = (d + 3) % 6;
      const pa = buildHexPaths(L, ax, ay, (1 << d) | (1 << ((d + 2) % 6)), { wiggle: 0.2, switchbacks: 2, seed: 5 })!;
      const pb = buildHexPaths(L, bx, by, 1 << back, { wiggle: 0.1, switchbacks: 0, seed: 9 })!;
      const ends = (p: typeof pa) => p.lines.flatMap((l) => [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]);
      const mx = ax + DIR_VECTORS[d][0] * L.apothem;
      const my = ay + DIR_VECTORS[d][1] * L.apothem;
      const near = (pts: number[][]) => pts.some(([x, y]) => Math.hypot(x - mx, y - my) < 1e-3);
      expect(near(ends(pa))).toBe(true);
      expect(near(ends(pb))).toBe(true);
    }
  });
});

describe('generateWorld', () => {
  it('is deterministic and makes land, sea and connected settlements', () => {
    const a = new HexMap(24, 16, 7);
    const b = new HexMap(24, 16, 7);
    generateWorld(a, { seed: 7 });
    generateWorld(b, { seed: 7 });
    expect(a.toJSON()).toEqual(b.toJSON());
    const water = [...Array(a.size).keys()].filter((i) => a.isWater(i)).length;
    expect(water).toBeGreaterThan(a.size * 0.15);
    expect(water).toBeLessThan(a.size * 0.7);
    const towns = [...Array(a.size).keys()].filter((i) => a.featureAt(i) === 'town' || a.featureAt(i) === 'village');
    expect(towns.length).toBeGreaterThan(3);
    const withRoads = towns.filter((i) => a.roads[i] !== 0).length;
    expect(withRoads).toBeGreaterThan(towns.length / 2);
  });
});
