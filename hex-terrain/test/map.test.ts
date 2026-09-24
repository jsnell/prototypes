import { describe, expect, it } from 'vitest';
import { opposite } from '../src/core/hex';
import { HexMap } from '../src/model/map';

describe('HexMap', () => {
  it('keeps road masks symmetric between neighbours', () => {
    const m = new HexMap(6, 5, 1);
    const a = 2 * 6 + 2;
    for (let d = 0; d < 6; d++) {
      const b = m.neighbor(a, d);
      expect(m.connect('road', a, b)).toBe(true);
      expect(m.roads[a] & (1 << d)).toBeTruthy();
      expect(m.roads[b] & (1 << opposite(d))).toBeTruthy();
    }
    expect(m.connect('road', a, 0)).toBe(false); // not adjacent
    m.disconnect('road', a, m.neighbor(a, 0));
    expect(m.roads[a] & 1).toBe(0);
    expect(m.roads[m.neighbor(a, 0)] & (1 << 3)).toBe(0);
  });

  it('refuses structures on water and clears them when a hex floods', () => {
    const m = new HexMap(4, 4, 1);
    m.setFeature(5, 'village');
    m.setBiome(5, 'ocean');
    expect(m.featureAt(5)).toBeNull();
    expect(m.setFeature(5, 'town')).toBe(false);
  });

  it('batches change notifications', () => {
    const m = new HexMap(4, 4, 1);
    const calls: number[][] = [];
    m.onChange((ids) => calls.push(ids));
    m.batch(() => {
      m.setBiome(1, 'desert');
      m.setLevel(1, 3);
      m.setBiome(2, 'forest');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sort()).toEqual([1, 2]);
  });

  it('serialises and restores', () => {
    const m = new HexMap(5, 4, 42);
    m.setBiome(3, 'jungle');
    m.setLevel(3, 2);
    m.setFeature(3, 'mine');
    m.connect('river', 3, m.neighbor(3, 2));
    const copy = HexMap.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(copy.toJSON()).toEqual(m.toJSON());
  });
});
