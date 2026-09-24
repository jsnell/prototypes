// Visual test bench: renders a scene chosen by the URL hash and reports timings.
import { HexMap, TerrainRenderer, generateWorld, hexDistance, type Season } from '../src/index';

const params = new URLSearchParams(location.hash.slice(1));
const scene = params.get('scene') ?? 'world';
const size = Number(params.get('size') ?? 36);
const season = (params.get('season') ?? 'summer') as Season;
const hour = Number(params.get('hour') ?? 14.5);
const seed = Number(params.get('seed') ?? 7);

let map: HexMap;
if (scene === 'features') {
  map = new HexMap(12, 8, seed);
  const at = (c: number, r: number) => r * map.cols + c;
  const set = (c: number, r: number, b: any, l = 0, f: any = null) => {
    map.setBiome(at(c, r), b);
    map.setLevel(at(c, r), l);
    if (f) map.setFeature(at(c, r), f);
  };
  // Connect waypoints, stepping greedily through neighbours between them.
  const path = (kind: 'road' | 'river', cells: [number, number][]) => {
    for (let k = 0; k + 1 < cells.length; k++) {
      let cur = at(...cells[k]);
      const goal = at(...cells[k + 1]);
      while (cur !== goal) {
        const g = map.axialOf(goal);
        let best = -1;
        let bd = Infinity;
        for (const nb of map.neighbors(cur)) {
          const d = hexDistance(map.axialOf(nb), g);
          if (d < bd) { bd = d; best = nb; }
        }
        map.connect(kind, cur, best);
        cur = best;
      }
    }
  };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) set(c, r, 'grassland', 0);
  // Sea along the bottom-right.
  for (const [c, r] of [[8, 7], [9, 7], [10, 7], [11, 7], [9, 6], [10, 6], [11, 6], [11, 5], [10, 5]] as [number, number][]) set(c, r, 'ocean');
  // Hills and mountains top-left.
  set(0, 0, 'grassland', 3); set(1, 0, 'grassland', 4); set(2, 0, 'conifer', 4); set(0, 1, 'forest', 2); set(1, 1, 'grassland', 3, 'mine'); set(2, 1, 'grassland', 2, 'castle');
  set(3, 0, 'forest', 1); set(4, 0, 'forest', 1); set(3, 1, 'forest'); set(4, 1, 'forest', 1, 'tower');
  set(6, 0, 'grassland', 1, 'ruins'); set(7, 0, 'forest'); set(8, 0, 'forest'); set(9, 0, 'swamp'); set(10, 0, 'swamp', 0, 'village'); set(11, 0, 'jungle');
  set(5, 3, 'grassland', 0, 'town'); set(3, 3, 'grassland', 0, 'village'); set(4, 4, 'grassland', 0, 'farm'); set(4, 2, 'grassland', 0, 'farm');
  set(8, 4, 'grassland', 0, 'village'); set(9, 5, 'grassland', 0, 'village');
  set(0, 6, 'desert', 0, 'village'); set(1, 6, 'desert'); set(0, 7, 'desert'); set(1, 7, 'badlands', 1); set(2, 7, 'savanna', 0, 'village'); set(3, 7, 'savanna');
  set(0, 4, 'tundra', 0, 'village'); set(0, 5, 'snow', 1); set(1, 5, 'tundra'); set(0, 3, 'conifer');
  set(6, 6, 'jungle', 0, 'village'); set(7, 6, 'jungle'); set(6, 7, 'jungle'); set(7, 7, 'lake');
  set(10, 2, 'volcanic', 4); set(11, 2, 'volcanic', 2); set(10, 3, 'volcanic', 1); set(11, 1, 'jungle', 1);
  // River from the hills to the sea, crossed by the main road.
  path('river', [[3, 0], [3, 1], [4, 1], [5, 2], [6, 2], [7, 3], [7, 4], [8, 5], [8, 6], [9, 6]]);
  path('road', [[2, 1], [3, 2], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [8, 4], [9, 4], [9, 5]]);
  path('road', [[5, 3], [5, 4], [5, 5], [6, 6]]);
  path('road', [[3, 3], [2, 4], [1, 5], [0, 4]]);
  path('road', [[9, 5], [10, 5]]);
} else if (scene === 'world') {
  map = new HexMap(Number(params.get('cols') ?? 24), Number(params.get('rows') ?? 16), seed);
  generateWorld(map, { seed });
} else {
  // Showcase: one column per biome, levels rising down the rows.
  const biomes = ['grassland','forest','conifer','jungle','swamp','savanna','desert','badlands','tundra','snow','volcanic','lake','ocean'] as const;
  map = new HexMap(biomes.length, 6, seed);
  for (let c = 0; c < biomes.length; c++) for (let r = 0; r < 6; r++) {
    const i = r * map.cols + c;
    map.setBiome(i, biomes[c]);
    map.setLevel(i, Math.min(4, r));
  }
}
const t0 = performance.now();
const R = new TerrainRenderer(map, { hexSize: size, environment: { season, hour }, grid: params.get('grid') === '1' });
R.update();
const ms = performance.now() - t0;
const c = R.canvas as HTMLCanvasElement;
document.body.appendChild(c);
(window as any).__done = { ms, passes: R.passTimes, stats: R.lastStats, w: R.width, h: R.height };
