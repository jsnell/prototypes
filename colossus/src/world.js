// Map layout: where things go. Deterministic from the seed.
import { MAP_W as W, MAP_D as D } from './config.js';
import { mulberry32 } from './util.js';

export function makeLayout(seed) {
  const r = mulberry32(seed * 7919 + 13);
  const river = {
    base: 66 + r() * 10, a1: 6 + r() * 4, f1: 0.035 + r() * 0.02, p1: r() * 6.28,
    a2: 2.5 + r() * 1.5, f2: 0.11 + r() * 0.03, p2: r() * 6.28,
  };
  const riverZ = (x) => river.base + river.a1 * Math.sin(x * river.f1 + river.p1) + river.a2 * Math.sin(x * river.f2 + river.p2);

  const tankStart = { x: W / 2, z: 17 };
  const cpX = W / 2 + (r() - 0.5) * 30;
  const cp = { x: cpX, z: 160 };
  const side = r() < 0.5 ? -1 : 1;
  const factories = [
    { x: 24 + r() * 10, z: 102 + r() * 10 },
    { x: W - 24 - r() * 10, z: 106 + r() * 10 },
    { x: cpX + side * (24 + r() * 6), z: 146 + r() * 6 },
  ];
  factories[2].x = Math.max(20, Math.min(W - 20, factories[2].x));

  const fords = [22 + r() * 22, W - 22 - r() * 22];
  const bridgeX = W / 2 + (r() - 0.5) * 16;

  const lake = { x: r() < 0.5 ? 22 : W - 22, z: 34 + r() * 14, r: 7 + r() * 3 };
  const mesas = [];
  for (let n = 0; n < 2; n++) {
    mesas.push({ x: 24 + r() * (W - 48), z: 90 + r() * 40, r: 4.5 + r() * 2.5, h: 13 + Math.floor(r() * 3) });
  }

  // roads: main road start -> bridge -> cp, plus branches
  const mid1 = { x: W / 2 + (r() - 0.5) * 20, z: 42 };
  const bridge = { x: bridgeX, z: riverZ(bridgeX) };
  const mid2 = { x: W / 2 + (r() - 0.5) * 20, z: 118 };
  const roads = [
    [tankStart, mid1, { x: bridge.x, z: bridge.z - 9 }, { x: bridge.x, z: bridge.z + 9 }, mid2, cp],
    [mid2, factories[0]],
    [mid2, factories[1]],
    [cp, factories[2]],
  ];

  // villages: spots away from everything important
  const villages = [];
  const avoid = [tankStart, cp, ...factories, lake, ...mesas];
  let tries = 0;
  while (villages.length < 5 && tries++ < 400) {
    const v = { x: 16 + r() * (W - 32), z: 26 + r() * (D - 60) };
    if (Math.abs(v.z - riverZ(v.x)) < 14) continue;
    if (avoid.some((a) => Math.hypot(a.x - v.x, a.z - v.z) < 20)) continue;
    if (villages.some((a) => Math.hypot(a.x - v.x, a.z - v.z) < 26)) continue;
    villages.push(v);
  }

  return { seed, river, riverZ, tankStart, cp, factories, fords, lake, mesas, roads, villages, rand: r };
}
