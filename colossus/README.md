# COLOSSUS vs the Swarm

A real-time tactics prototype riffing on Bolo / Ogre: **one enormous fortress-tank
with six systems to juggle** vs **a horde of tiny single-purpose vehicles** that
only win when they work together. Single player — pick a side and the AI plays
the other (or watch AI vs AI from the title screen).

Cute, cheerful voxel diorama: deformable terrain (craters, scorch, tread ruts),
faceted water with shore foam and ripples, trees and flowers swaying in the
wind (and shaking, charring, toppling when things explode), drifting clouds,
birds that scatter, crushable cottages, collapsible bridges, voxel particle
explosions, screen shake, and a procedural sound kit.

## Running

Static page with ES modules, so serve it over HTTP:

```sh
cd colossus
python3 -m http.server 8000
# open http://localhost:8000
```

Three.js (r170) is vendored in `vendor/`; no build step. Fonts come from Google
Fonts if reachable, and fall back to system fonts otherwise.

## Playing the Colossus

Roll north and flatten the swarm's **Command Post**. Factories along the way
are optional, but each one you wreck cuts their income.

The reactor makes ~10 power; the five powered systems want up to 19.

| System | Power buys | Knocked out by hits from |
|---|---|---|
| ⚛️ Reactor | (source) power output; Overdrive = +3 power, builds heat | rear, above |
| ⚙️ Treads | speed & turning | sides, bombs |
| 💥 Main gun | reload speed (big splash, 62 range) | front, above |
| ✴️ Flak | fire rate of 4 corner guns; shoots down missiles & mortar shells | sides, above |
| 🛡️ Shields | regen into four facings (front/right/rear/left) | front, above |
| 🔧 Repair | drones fix the worst system, or the one you pin | rear, above |

Damaged systems work worse; a system at 0% goes **offline** until repaired to
35%. Heat 100 = reactor **SCRAM** (no power for 5s and reactor damage).

Controls: right-click to drive (Shift queues waypoints, right-click a building
to ram it), left-click to fire / lock the main gun, `1`–`5` add power
(Shift removes; adding when full steals from the fattest system), `Z X C`
power presets, `G` overdrive, hold `Space` to swing shield regen toward the
cursor (`U` = auto), `R` cycles the repair pin, `Tab` toggles main-gun
auto-fire, `H` stops, `F` follows.

## Playing the Swarm

Grind the Colossus down before it reaches your Command Post. Income comes from
the CP and each factory.

| Unit | Key | Role |
|---|---|---|
| Zipper | Z | hover scout, fast, crosses water, peppers shields |
| Plinker | X | gun buggy, the workhorse |
| Whizzer | C | rocket truck; missiles wreck systems but flak can swat them |
| Lobber | V | mortar; outranges the main gun, hits from above, misses moving targets |
| Boomer | B | kamikaze sapper; slips under shields, shreds treads |
| Fuzzer | N | EMP jammer; drains the facing shield and scrambles a system |

Controls: `Z X C V B N` build (Shift ×5), `Tab`/click a factory to choose
where, right-click ground with nothing selected to set the rally point.
Drag-select, double-click for all of a type, `Ctrl+#` groups. **Right-click
the Colossus to attack the side you clicked** — units circle round to it.
`G` engage from where they are, `Y` surround, `T` scatter, `H` hold,
`R` fall back.

## Common

WASD / arrows pan, Q/E rotate, wheel zooms toward the cursor, right-drag pans,
middle-drag (or Alt+drag) orbits. `P` pauses — you can still give orders while
paused. `[` `]` change game speed, `M` mutes, `F1` / `?` shows all keys.

## URL params & debugging

- `?side=tank|swarm&diff=easy|normal|hard&seed=N` — start directly
- `?norender` — run the simulation without drawing (for balance testing)
- `window.G` — live game state; `G.simulate(seconds)` fast-forwards the sim
  headlessly and returns a summary (used to balance AI vs AI runs)

## Layout

- `src/main.js` bootstrap & loop · `config.js` all the tunables
- `terrain.js` voxel heightmap, chunk meshing w/ AO, craters · `water.js` · `foliage.js` · `env.js` (lights, clouds, birds) · `props.js` (cottages, windmills, bridges)
- `tank.js` the Colossus (power, heat, shields, damage model, visuals) · `swarm.js` units, factories, orders
- `projectiles.js` · `fx.js` particles/rings/lights/shake · `audio.js` synth sfx
- `pathing.js` flow fields for the swarm, A* for the tank · `ai.js` both AIs
- `camera.js` · `input.js` · `ui.js` HUD · `minimap.js`
