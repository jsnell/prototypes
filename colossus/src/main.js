// COLOSSUS vs the Swarm — bootstrap and main loop.
import * as THREE from 'three';
import { MAP_W, MAP_D, DIFF, TANK } from './config.js';
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

export const BUILD = 1;

const params = new URLSearchParams(location.search);
const side = ['tank', 'swarm'].includes(params.get('side')) ? params.get('side') : 'none';
const diffName = DIFF[params.get('diff')] ? params.get('diff') : 'normal';
const seed = parseInt(params.get('seed') || '', 10) || Math.floor(Math.random() * 1e6);
const norender = params.has('norender');

const G = window.G = {
  side, diffName, diff: DIFF[diffName], seed, BUILD,
  time: 0, vt: 0, speed: 1, paused: false, slowmo: 0, over: false, winner: null,
  fastForward: false,
  stats: { shieldAbsorbed: 0, intercepts: 0, houses: 0, dmg: {} },
  sunDir: new THREE.Vector3(-0.55, 1, 0.38).normalize(),
};

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
G.renderer = renderer;
const scene = G.scene = new THREE.Scene();
const camera = G.camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 2000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ------------------------------------------------------------------ world
G.layout = makeLayout(seed);
G.terrain = new Terrain(G.layout);
G.terrain.buildMeshes(scene);
G.cam = new CameraRig(G, camera);
G.env = new Env(G);
G.pathing = new Pathing(G);
G.fx = new FX(G);
G.audio = new Audio(G);
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
if (side !== 'swarm') G.swarmAI = side === 'tank' ? new SwarmAI(G, G.diff) : new SwarmAI(G, DIFF.normal);
if (side !== 'tank') G.tankAI = side === 'swarm' ? new TankAI(G, G.diff) : new TankAI(G, DIFF.normal);
G.swarm.spawnStartArmy(L);

G.input = new Input(G);
G.ui = new UI(G);
G.minimap = new Minimap(G);

// opening camera
if (side === 'tank') { G.cam.want.dist = 95; G.cam.want.pitch = 0.85; G.cam.focus(G.tank.x, G.tank.z + 18); }
else if (side === 'swarm') { G.cam.want.dist = 120; G.cam.focus(L.cp.x, L.cp.z - 30); }
else { G.cam.want.dist = 250; G.cam.want.yaw = 0.35; }
G.cam.target.set(G.cam.want.x, 6, G.cam.want.z);
G.cam.dist = G.cam.want.dist + 60; G.cam.yaw = G.cam.want.yaw - 0.3; G.cam.pitch = G.cam.want.pitch;

// ------------------------------------------------------------------ game flow
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3];
G.togglePause = () => {
  if (G.over) return;
  G.paused = !G.paused;
  G.audio.play('click', {});
};
G.setSpeed = (dir) => {
  let i = SPEEDS.indexOf(G.speed);
  if (i < 0) i = 2;
  i = Math.max(0, Math.min(SPEEDS.length - 1, i + dir));
  G.speed = SPEEDS[i];
  G.ui.toast(`Game speed ×${G.speed}`);
};
G.restart = (newSide) => {
  const p = new URLSearchParams();
  if (newSide) { p.set('side', newSide); p.set('diff', G.diffName); }
  location.search = p.toString();
};
G.onTankDestroyed = () => {
  G.slowmo = 2.5;
  G.ui.log('💥 THE COLOSSUS IS DESTROYED!', G.side === 'tank' ? 'bad' : 'good', true);
  G.minimap.ping(G.tank.x, G.tank.z, '#ff5a4a');
  if (!G.winner) G.winner = 'swarm';
  endIn(4.5);
};
G.onStructureDestroyed = (st) => {
  G.minimap.ping(st.x, st.z, '#ffd166');
  if (st.kind === 'cp' && !G.winner) {
    G.winner = 'tank';
    G.slowmo = 2;
    endIn(4);
  }
};
function endIn(sec) {
  setTimeout(() => {
    if (G.over) return;
    G.over = true;
    if (G.side === 'none') { setTimeout(() => { if (!document.getElementById('title').classList.contains('hidden')) G.restart(null); }, 6000); return; }
    const win = G.winner === G.side;
    if (G.side === 'tank') G.ui.showEnd(win, win ? 'Command Post flattened!' : 'The Colossus has fallen', win ? 'Nothing could stop you. The swarm scatters.' : 'Death by a thousand tiny cuts.');
    else G.ui.showEnd(win, win ? 'The Colossus has fallen!' : 'Your Command Post is rubble', win ? 'A thousand tiny cuts did the job.' : 'It just… kept… coming.');
  }, sec * 1000 / Math.max(0.5, G.speed));
}

function simStep(dt) {
  G.time += dt;
  G.pathing.tick();
  if (G.swarmAI) G.swarmAI.update(dt);
  if (G.tankAI) G.tankAI.update(dt);
  G.tank.update(dt);
  G.swarm.update(dt);
  G.proj.update(dt);
}
G.simStep = simStep;

// headless-ish fast simulation for balance testing: G.simulate(seconds)
G.simulate = (sec, step = 1 / 20) => {
  G.fastForward = true;
  const n = Math.ceil(sec / step);
  for (let k = 0; k < n; k++) {
    simStep(step);
    if (k % 20 === 0) { G.fx.update(step * 20, step * 20); G.terrain.rebuildDirty(1); }
    if (G.winner) break;
  }
  G.fastForward = false;
  return { t: G.time, winner: G.winner, hull: G.tank.hull, units: G.swarm.aliveCount(), built: G.swarm.stats.built, structures: G.swarm.structures.filter((s) => s.alive).map((s) => s.kind + ':' + Math.round(s.hp)) };
};

// ------------------------------------------------------------------ title screen
const title = document.getElementById('title');
if (side === 'none') {
  title.classList.remove('hidden');
  let diff = diffName;
  title.querySelectorAll('[data-diff]').forEach((b) => {
    b.classList.toggle('on', b.dataset.diff === diff);
    b.onclick = () => { diff = b.dataset.diff; title.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('on', x === b)); G.audio.play('click', {}); };
  });
  title.querySelectorAll('[data-side]').forEach((b) => {
    b.onclick = () => { const p = new URLSearchParams(); p.set('side', b.dataset.side); p.set('diff', diff); location.search = p.toString(); };
  });
  const hb = document.getElementById('title-help');
  if (hb) hb.onclick = () => G.ui.toggleHelp(true);
  const wb = document.getElementById('title-watch');
  if (wb) wb.onclick = () => { title.classList.add('hidden'); G.audio.ensure(); };
  document.getElementById('build-tag').textContent = `build ${BUILD} · map #${seed}`;
} else {
  title.classList.add('hidden');
  setTimeout(() => {
    if (side === 'tank') {
      G.ui.log('Right-click to drive · left-click to shoot · <b>1–5</b> route power', 'info', true);
      G.ui.log('Hold <b>Space</b> to swing shields toward the cursor · <b>F1</b> for all keys', 'info', true);
    } else {
      G.ui.log('Build with <b>Z X C V B N</b> · drag to select · right-click the Colossus to attack that side', 'info', true);
      G.ui.log('<b>F1</b> for all keys · <b>P</b> pauses (you can still give orders)', 'info', true);
    }
  }, 600);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (G.slowmo > 0) G.slowmo -= rdt;
  const sp = G.paused ? 0 : G.speed * (G.slowmo > 0 ? 0.3 : 1);
  const sdt = rdt * sp;
  if (sdt > 0) {
    const steps = Math.ceil(sdt / (1 / 30));
    for (let k = 0; k < steps; k++) simStep(sdt / steps);
  }
  G.vt += rdt;
  if (side === 'none' && !title.classList.contains('hidden')) G.cam.rotate(rdt * 0.04, 0);
  else if (side === 'none' && !G.cam.follow) G.cam.follow = G.tank;
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
  if (!norender) renderer.render(scene, camera);
}
requestAnimationFrame(frame);
