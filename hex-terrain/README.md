# hex-terrain

Procedural hex terrain tiles in a top-down oblique view. Hexes are drawn
undistorted, as seen from above. Heights lift the land up the screen, so tall
things (mountains, trees, towers) overlap the ranks behind them. Every pixel
is generated: there are no image assets.

The demo app, **Hexfold Atlas**, lets you paint terrain, raise and lower land,
lay roads and rivers, place structures, and switch seasons and time of day.

```
npm install
npm run dev        # demo at http://localhost:5173, test bench at /lab.html
npm test           # unit tests (vitest)
npm run build      # typecheck, build, and pack dist/artifact.html (single file)
```

## What it does

- **13 biomes**: grassland, forest, taiga, jungle, swamp, savanna, desert,
  badlands, tundra, snowfield, volcanic, ocean and lake.
- **5 elevation levels** (lowland to mountains). Height and biome are
  independent, so you get forested hills, desert mountains, snowy peaks and
  volcano cones.
- **Transitions**: biome borders are domain-warped and blended, and plants
  from both sides mix near a border. Neighbouring hexes of the same kind share
  one continuous noise field, so mountain ranges and forests have no seams.
- **Roads and rivers** run between hex centres and join exactly at edge
  midpoints. The terrain adjusts to them:
  - Rivers carve valleys and show rapids on steep ground.
  - Roads level a path through relief and zig-zag through mountains.
  - A road crossing a river gets a bridge.
  - A road that shares an edge with a river runs alongside the bank.
  - A road running into water ends at a jetty.
- **Structures** adapt to where they are:
  - Villages line their houses along roads and add a jetty and boat on the shore.
  - Towns get walls, with gates wherever roads cross them.
  - Farms lay out fields in the local tradition: hedged wheat, rice paddies,
    irrigated oasis plots, dry millet, or stone-walled hay meadows.
  - Mines dig into hillsides, or become quarries on flat ground.
  - Buildings take the regional style: timber-frame, log cabin, adobe, round
    hut, stilt house or stone.
  - Settlements flatten the ground they sit on.
- **Seasons and light**: spring blossom, autumn colour, and winter snow with
  bare trees and frozen lakes. The sun sweeps across the sky, with cast
  shadows, golden hour, and moonlit nights with lit windows and glowing lava.

## Using the library

```ts
import { HexMap, TerrainRenderer, generateWorld } from './src';

const map = new HexMap(24, 16, /* seed */ 7);
generateWorld(map, { seed: 7 });           // or paint it yourself:
const i = map.indexOf(3, 2);               // axial (q, r) -> hex index
map.setBiome(i, 'forest');
map.setLevel(i, 2);
map.connect('road', a, b);                 // a, b: adjacent hex indices
map.setFeature(i, 'village');

const renderer = new TerrainRenderer(map, {
  hexSize: 36,                             // circumradius in px
  environment: { season: 'autumn', hour: 17.5 },
});
renderer.update();                         // renders everything the first time
document.body.append(renderer.canvas as HTMLCanvasElement);

// Edits notify the renderer; update() re-renders only what changed.
map.setBiome(i, 'desert');
renderer.update();

renderer.pick(x, y);        // hex under a canvas pixel (respects elevation)
renderer.hexOutline(i);     // hex outline draped over the terrain, for overlays
renderer.setEnvironment({ season: 'winter' });
renderer.setGrid(true);
```

### Off-main-thread rendering

Whole-map renders (the first render, generating a world, changing season) can
run on a worker pool. The host creates the workers, so it works with any
bundler:

```ts
import { TerrainWorkerPool } from './src';
// Vite:
import TerrainWorker from './src/render/terrain.worker?worker';

const pool = new TerrainWorkerPool(() => new TerrainWorker(), 4);
const renderer = new TerrainRenderer(map, { hexSize: 36, pool });
await renderer.updateAsync();   // falls back to the main thread if workers fail
```

## How it works

Rendering happens in world space (the ground plane), then gets projected.

1. **Field** (`render/field.ts`) turns the hex map into continuous functions.
   For any point it gives blend weights between nearby hexes (after domain
   warping), ground height (per-level relief shaped by biome: ridged
   mountains, dunes, terraced mesas, volcano cones, marsh pools), water level,
   and the distance to roads and rivers.
2. **Surface** (`render/surface.ts`) shades each pixel's base colour: blended
   biome ground, rock on steep slopes, snow, beaches, surf, fields, settlement
   ground, roads, rivers and lava.
3. **Lighting** (`renderer.ts`): sun and ambient light, shadows ray-marched
   over the height field, ambient occlusion from a blurred height map, and
   glints on water.
4. **Projection**: each column is painted far-to-near, lifting every sample by
   its height. Slopes that face the viewer get vertical texture. The map's
   southern edge shows a cut-away of soil and water, like a diorama.
5. **Sprites** (`render/scatter.ts`, `render/sprites/`): plants and buildings
   are painted once with Canvas 2D and cached. Buildings use a small oblique
   3D face renderer. Sprites are blitted in software with a depth test, so
   terrain in front hides them correctly.

Edits re-run these passes only for the affected region. That region is the
edited hexes plus their blend reach, with lighting extended in the direction
shadows fall.

## Layout

```
src/core     hex math, noise, colour, seeded random
src/model    HexMap, biomes, features
src/render   field, surface, terrain passes, renderer, sprites, worker pool
src/gen      world generator (continents, climate, rivers, settlements, roads)
demo/        Hexfold Atlas editor (index.html) and visual test bench (lab.html)
test/        vitest unit tests
```
