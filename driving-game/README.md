# SKYRUSH GP

A low-poly 3D arcade driving game for mobile browsers. One closed sky-circuit
that mixes flat-out speed with precision driving and stunts:

- **Full-throttle start straight** with boost pads and banked sweepers
- **Gap jump** — boost off a ramp and clear a hole in the sky
- **Precision zigzag** — narrow switchbacks with nothing but air on either side
- **Wall ride** — a 90°-banked canyon corner
- **Corkscrew** — a full 360° barrel-roll section
- **Whoops** — a rhythm section of bumps for catching air

Steering mid-air barrel-rolls the car; land a full roll for bonus points and a
speed boost. Score comes from air time, wall rides, drifts, stunts, and laps.

## Controls

| | Mobile | Desktop |
|---|---|---|
| Throttle | automatic | automatic |
| Steer | drag on the left side of the screen | ←/→ or A/D |
| Brake / drift | hold the BRAKE button | SPACE or ↓/S |
| Respawn | ↺ button | R |

## Running

It's a static page, but it uses ES modules so it needs to be served over HTTP:

```sh
cd driving-game
python3 -m http.server 8000
# open http://localhost:8000 (or your machine's LAN IP from a phone)
```

Also works as-is on GitHub Pages. Three.js is vendored in `vendor/`, so there
are no external dependencies and no build step.

## Updating

Browsers cache `game.js` aggressively (and the game disables pull-to-refresh
since touch gestures are used for steering). `index.html` loads
`game.js?v=N` and the title screen shows the running build number with a
"tap here to force-update" link. **When changing `game.js`, bump `BUILD` in
`game.js` and the `?v=` suffix in `index.html` together.**

## Debug/test hooks

- `?auto=1` — autopilot drives the track (used for automated playtesting)
- `?fast=1` — skip the countdown
- `window.GAME` — live game state in the console
