# COLONIAL DEFENSE

A horde-defense city builder for the browser: *They Are Billions* pacing, an
*Aliens*-style setting, and tiny C&C-scale pixel art under a modern
deferred-lighting pipeline. You hold a colony for 10 nights (about 25–30 min).

## Running

No build step and no dependencies. Open `index.html` in a desktop browser with
WebGL2, or serve the folder:

```sh
cd colonial-defense && python3 -m http.server 8000
```

URL hashes: `#play` skips the menu, and `#unlockall` unlocks every requisition
(for testing).

## How a scenario plays

- **Day (lull):** the map is split into rock-walled **sectors** joined by
  narrow **gaps**. Click a highlighted sector to claim it. Build extractors on
  ore, drag barricades across the gaps on your frontier, and put up turrets and
  floodlights. The timer counts down to nightfall. **CALL WAVE** starts the next
  night early and turns the leftover time into materiel.
- **Night (attack):** you can't build. Turrets and marines fight on their own.
  A turret only hits reliably what it can *see*, so floodlights, flares, fires
  and the tracker pulse are what make your guns work. Your part is choosing
  where and when to call stratagems.
- Damaged buildings repair for free at dawn, and **REBUILD** re-queues all
  destroyed structures in one click. That removes the busywork.
- Enemies arrive from the right edge. From night 4 they also come from the top
  and bottom edges of unclaimed sectors. Claiming land grows your economy, but
  it also moves your frontier. Night 10 brings a boss.

Controls: `1-9` build · `Q W E R T Y U` stratagems · drag to lay walls ·
right-click / `Esc` cancel · `X` sell selected · `F` call wave · `Space` pause ·
1×/2×/3× speed buttons.

## Content

| | Start | Requisition (meta-unlock) |
|---|---|---|
| Factions | Xeno Hive (acid blood damages your walls) | Husk Plague (hordes plus bloaters that explode), Chitin Swarm (tiny mites; leapers jump walls; burrowers surface inside your base) |
| Biomes | Barren Moon | Ice Shelf, Fungal Jungle (glowing flora), Ash Volcano (lava seams) |
| Threat | Recruit | Veteran → Hardened → Nightmare → *Game Over, Man* (more enemies, more HP, elites) |
| Buildings | Barricade, Sentry Gun, Floodlight, Extractor, Hab Dome, Barracks | Incinerator, Mortar Pit, Rail Battery |
| Stratagems | Flare, Tracker Pulse, Orbital Lance | Napalm Run, Sentry Drop, Gunship Strafe, Dust Off (a nuke that also hits your own base) |
| Boosters | – | Supply Cache I–III, Forward Survey, Prefab Defenses, Orbital Relay |

**Scrip** = (minutes survived × 6 + nights held × 8 + evac bonus) × threat
multiplier × faction multiplier. It is saved in `localStorage`.

## Tech notes

- `js/render.js`: WebGL2 deferred renderer at 640×360. The G-buffer holds
  albedo, normal+height and emissive+gloss. Stages:
  - an ambient/sun pass with ray-marched heightfield shadows and AO
  - up to ~1100 point/spot lights per frame, each ray-marching shadows through
    the height buffer, so units, walls and ridges cast real shadows from muzzle
    flashes
  - additive and alpha particles
  - two-level bloom, ACES tonemapping, grain, and optional scanlines
  - nearest-neighbour upscale
- `js/sprites.js`: every sprite is generated procedurally as a tiny
  heightfield, with 16 facings and 2 animation frames. Normals come from the
  heights, which is why 5-pixel aliens get glossy highlights.
- Blood, scorch marks and brass casings are stamped into persistent decal
  textures that fade slowly. Acid blood also writes an emissive decal that
  glows for a while.
- `js/game.js`: Dijkstra flow fields toward your buildings. Walls cost extra,
  so a horde routes around a wall if it can and chews through it if it can't.
  A spatial hash handles separation and targeting. About 2.5k live enemies
  cost roughly 5 ms per sim step.
- `js/fx.js`: particles, stratagems, the demo autoplayer (it runs behind the
  menu), and world drawing.

## Known gaps / next steps

- Balance has been tuned against a dumb autoplayer, not people. Recruit should
  be winnable, and the bot starts losing on Hardened.
- No minimap or edge scrolling, by design (single screen).
- Sound is placeholder WebAudio synthesis.
- Faction behaviours differ, but unit art could use a lot more love.
