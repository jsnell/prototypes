// COLOSSUS vs the Swarm — bootstrap and main loop.
// A game is built by boot(config) and torn down in place on restart (no page reload).
import * as THREE from 'three';
import { DIFF } from './config.js';
import { makeLayout } from './world.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { Foliage } from './foliage.js';
import { Env } from './env.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { Pathing } from './pathing.js';
import { Props } from './props.js';
import { Swarm } from './swarm.js';
import { Tank } from './tank.js';
import { Projectiles } from './projectiles.js';
import { SwarmAI, TankAI } from './ai.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Minimap } from './minimap.js';

export const BUILD = 2;

const params = new URLSearchParams(location.search);
const norender = params.has('norender');

// ------------------------------------------------------------------ renderer (shared by every game)
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 2000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
const audio = new Audio(null);
const title = document.getElementById('title');
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3];
let G = null;

function dispose(old) {
  if (!old) return;
  old.disposed = true;
  old.abort.abort();
  old.input.dispose();
  old.ui.dispose();
  old.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  old.terrain.heightTex.dispose();
  renderer.renderLists.dispose();
}

function boot(cfg) {
  dispose(G);
  const side = ['tank', 'swarm'].includes(cfg.side) ? cfg.side : 'none';
  const diffName = DIFF[cfg.diff] ? cfg.diff : 'normal';
  const seed = cfg.seed || Math.floor(Math.random() * 1e6);
  const abort = new AbortController();
  G = window.G = {
    side, diffName, diff: DIFF[diffName], seed, BUILD,
    time: 0, vt: 0, speed: 1, paused: false, slowmo: 0, over: false, winner: null,
    fastForward: false, disposed: false, abort, signal: abort.signal,
    stats: { shieldAbsorbed: 0, intercepts: 0, houses: 0, dmg: {} },
    sunDir: new THREE.Vector3(-0.55, 1, 0.38).normalize(),
    renderer, camera, audio,
  };
  audio.G = G;
  try { history.replaceState(null, '', side === 'none' ? location.pathname : `?side=${side}&diff=${diffName}&seed=${seed}`); } catch (e) { /* sandboxed */ }
  const scene = G.scene = new THREE.Scene();

  G.layout = makeLayout(seed);
  G.terrain = new Terrain(G.layout);
  G.terrain.buildMeshes(scene);
  G.cam = new CameraRig(G, camera);
  G.env = new Env(G);
  G.pathing = new Pathing(G);
  G.fx = new FX(G);
  G.water = new Water(G);
  G.foliage = new Foliage(G);
  G.terrain.listeners.push((i0, j0, i1, j1) => G.foliage.onTerrain(i0, j0, i1, j1));
  G.props = new Props(G);

  const L = G.layout;
  // the AI side gets the difficulty modifiers
  G.swarm = new Swarm(G, side === 'tank' ? G.diff.aiIncome : 1);
  G.swarm.addStructure('cp', L.cp.x, L.cp.z);
  for (const f of L.factories) G.swarm.addStructure('factory', f.x, f.z);
  G.tank = new Tank(G, L.tankStart.x, L.tankStart.z, 0, side === 'swarm' ? G.diff.aiHull : 1);
  G.proj = new Projectiles(G);
  if (side !== 'swarm') G.swarmAI = new SwarmAI(G, side === 'tank' ? G.diff : DIFF.normal);
  if (side !== 'tank') G.tankAI = new TankAI(G, side === 'swarm' ? G.diff : DIFF.normal);
  G.swarm.spawnStartArmy(L);

  G.input = new Input(G);
  G.ui = new UI(G);
  G.minimap = new Minimap(G);

  // opening camera
  const C = G.cam;
  if (side === 'tank') { C.want.dist = 95; C.want.pitch = 0.85; C.focus(G.tank.x, G.tank.z + 18); }
  else if (side === 'swarm') { C.want.dist = 120; C.focus(L.cp.x, L.cp.z - 30); }
  else { C.want.dist = 250; C.want.yaw = 0.35; }
  C.target.set(C.want.x, 6, C.want.z);
  C.dist = C.want.dist + 60; C.yaw = C.want.yaw - 0.3; C.pitch = C.want.pitch;

  // ---------------------------------------------------------------- game flow
  G.togglePause = () => {
    if (G.over) return;
    G.paused = !G.paused;
    audio.play('click', {});
  };
  G.setSpeed = (dir) => {
    let i = SPEEDS.indexOf(G.speed);
    if (i < 0) i = 2;
    i = Math.max(0, Math.min(SPEEDS.length - 1, i + dir));
    G.speed = SPEEDS[i];
    G.ui.toast(`Game speed ×${G.speed}`);
  };
  G.restart = (newSide) => boot({ side: newSide || 'none', diff: G.diffName });
  G.onTankDestroyed = () => {
    G.slowmo = 2.5;
    G.ui.log('💥 THE COLOSSUS IS DESTROYED!', G.side === 'tank' ? 'bad' : 'good', true);
    G.minimap.ping(G.tank.x, G.tank.z, '#ff5a4a');
    if (!G.winner) G.winner = 'swarm';
    endIn(G, 4.5);
  };
  G.onStructureDestroyed = (st) => {
    G.minimap.ping(st.x, st.z, '#ffd166');
    if (st.kind === 'cp' && !G.winner) {
      G.winner = 'tank';
      G.slowmo = 2;
      endIn(G, 4);
    }
  };
  const g = G;
  g.simStep = (dt) => simStep(g, dt);
  // headless-ish fast simulation for balance testing: G.simulate(seconds)
  g.simulate = (sec, step = 1 / 20) => {
    g.fastForward = true;
    const n = Math.ceil(sec / step);
    for (let k = 0; k < n; k++) {
      simStep(g, step);
      if (k % 20 === 0) { g.fx.update(step * 20, step * 20); g.terrain.rebuildDirty(1); }
      if (g.winner) break;
    }
    g.fastForward = false;
    return { t: g.time, winner: g.winner, hull: g.tank.hull, units: g.swarm.aliveCount(), built: g.swarm.stats.built, structures: g.swarm.structures.filter((s) => s.alive).map((s) => s.kind + ':' + Math.round(s.hp)) };
  };

  // ---------------------------------------------------------------- title screen
  if (side === 'none') {
    title.classList.remove('hidden');
    let diff = diffName;
    title.querySelectorAll('[data-diff]').forEach((b) => {
      b.classList.toggle('on', b.dataset.diff === diff);
      b.onclick = () => { diff = b.dataset.diff; title.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('on', x === b)); audio.play('click', {}); };
    });
    title.querySelectorAll('[data-side]').forEach((b) => {
      b.onclick = () => { audio.ensure(); boot({ side: b.dataset.side, diff }); };
    });
    document.getElementById('title-help').onclick = () => g.ui.toggleHelp(true);
    document.getElementById('title-watch').onclick = () => { title.classList.add('hidden'); audio.ensure(); };
    document.getElementById('build-tag').textContent = `build ${BUILD} · map #${seed}`;
  } else {
    title.classList.add('hidden');
    setTimeout(() => {
      if (g.disposed) return;
      if (side === 'tank') {
        g.ui.log('Right-click to drive · left-click to shoot · <b>1–5</b> route power', 'info', true);
        g.ui.log('Hold <b>Space</b> to swing shields toward the cursor · <b>F1</b> for all keys', 'info', true);
      } else {
        g.ui.log('Build with <b>Z X C V B N</b> · drag to select · right-click the Colossus to attack that side', 'info', true);
        g.ui.log('<b>F1</b> for all keys · <b>P</b> pauses (you can still give orders)', 'info', true);
      }
    }, 600);
  }
  return G;
}

function endIn(g, sec) {
  setTimeout(() => {
    if (g.over || g.disposed) return;
    g.over = true;
    if (g.side === 'none') {
      g.ui.log(g.winner === 'tank' ? '🏆 The Colossus wins this one.' : '🏆 The Swarm wins this one.', 'info', true);
      setTimeout(() => { if (!g.disposed) g.restart(null); }, 7000);
      return;
    }
    const win = g.winner === g.side;
    if (g.side === 'tank') g.ui.showEnd(win, win ? 'Command Post flattened!' : 'The Colossus has fallen', win ? 'Nothing could stop you. The swarm scatters.' : 'Death by a thousand tiny cuts.');
    else g.ui.showEnd(win, win ? 'The Colossus has fallen!' : 'Your Command Post is rubble', win ? 'A thousand tiny cuts did the job.' : 'It just… kept… coming.');
  }, sec * 1000 / Math.max(0.5, g.speed));
}

function simStep(g, dt) {
  g.time += dt;
  g.pathing.tick();
  if (g.swarmAI) g.swarmAI.update(dt);
  if (g.tankAI) g.tankAI.update(dt);
  g.tank.update(dt);
  g.swarm.update(dt);
  g.proj.update(dt);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!G) return;
  if (G.slowmo > 0) G.slowmo -= rdt;
  const sp = G.paused ? 0 : G.speed * (G.slowmo > 0 ? 0.3 : 1);
  const sdt = rdt * sp;
  if (sdt > 0) {
    const steps = Math.ceil(sdt / (1 / 30));
    for (let k = 0; k < steps; k++) simStep(G, sdt / steps);
  }
  G.vt += rdt;
  if (G.side === 'none' && !title.classList.contains('hidden')) G.cam.rotate(rdt * 0.04, 0);
  else if (G.side === 'none' && !G.cam.follow) G.cam.follow = G.tank;
  G.input.update(rdt);
  G.fx.update(sdt, rdt);
  G.water.update(G.vt);
  G.foliage.update(sdt, G.vt);
  G.env.update(rdt, G.vt);
  G.props.update(sdt, G.vt);
  G.tank.render(sdt, G.vt);
  G.swarm.render(sdt, G.vt);
  G.proj.render();
  G.terrain.rebuildDirty(4);
  G.cam.update(rdt);
  G.ui.update(rdt);
  G.minimap.update(rdt);
  if (!norender) renderer.render(G.scene, camera);
}

boot({ side: params.get('side'), diff: params.get('diff'), seed: parseInt(params.get('seed') || '', 10) || 0 });
requestAnimationFrame(frame);
