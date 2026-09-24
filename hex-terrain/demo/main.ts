import {
  AXIAL_DIRS,
  BIOME_LIST,
  FEATURE_IDS,
  FEATURES,
  HexMap,
  LEVEL_NAMES,
  SEASONS,
  TerrainRenderer,
  TerrainWorkerPool,
  generateWorld,
  hashString,
  hexDistance,
  type BiomeId,
  type FeatureId,
  type MapJSON,
  type Season,
} from '../src/index';
import TerrainWorker from '../src/render/terrain.worker?worker&inline';

// ---- configuration --------------------------------------------------------

type Tool = 'paint' | 'raise' | 'lower' | 'road' | 'river' | 'feature' | 'erase' | 'pan';

const TOOLS: { id: Tool; label: string; key: string; hint: string; icon: string }[] = [
  {
    id: 'paint',
    label: 'Terrain',
    key: 'B',
    hint: 'Drag to paint terrain. Edges blend into their neighbours.',
    icon: '<path d="M4 20c3 0 5-2 5-5l9-9a2 2 0 0 0-3-3l-9 9c-3 0-5 2-5 5"/><path d="M13 5l6 6"/>',
  },
  {
    id: 'raise',
    label: 'Raise',
    key: 'U',
    hint: 'Lift the land one step: lowland, rolling, hills, highlands, mountains.',
    icon: '<path d="M3 20l6-9 4 5 3-4 5 8z"/><path d="M12 8V2M9 5l3-3 3 3"/>',
  },
  {
    id: 'lower',
    label: 'Lower',
    key: 'J',
    hint: 'Lower the land one step.',
    icon: '<path d="M3 20l6-6 4 3 3-2 5 5z"/><path d="M12 2v7M9 6l3 3 3-3"/>',
  },
  {
    id: 'road',
    label: 'Road',
    key: 'R',
    hint: 'Drag from hex to hex to lay a road. Hold Alt to remove. Crossing a river builds a bridge.',
    icon: '<path d="M8 21l3-18M16 21l-3-18"/><path d="M12 7v2M12 13v2M12 19v1"/>',
  },
  {
    id: 'river',
    label: 'River',
    key: 'V',
    hint: 'Drag to run a river between hexes. Hold Alt to remove. Rivers carve valleys.',
    icon: '<path d="M3 7c3-2 5 2 9 0s6 2 9 0"/><path d="M3 12c3-2 5 2 9 0s6 2 9 0"/><path d="M3 17c3-2 5 2 9 0s6 2 9 0"/>',
  },
  {
    id: 'feature',
    label: 'Build',
    key: 'F',
    hint: 'Click a hex to place a structure. Click again to remove it.',
    icon: '<path d="M4 20V10l5-4 5 4v10z"/><path d="M14 20v-7h6v7"/><path d="M8 20v-4h2v4"/>',
  },
  {
    id: 'erase',
    label: 'Erase',
    key: 'E',
    hint: 'Reset hexes to lowland grass and remove roads, rivers and structures.',
    icon: '<path d="M8 20h12"/><path d="M4 16l9-9 6 6-7 7H8z"/><path d="M9 11l6 6"/>',
  },
  {
    id: 'pan',
    label: 'Move',
    key: 'H',
    hint: 'Drag to move around the map. Right-drag or Space-drag works with any tool.',
    icon: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  },
];

const MAP_SIZES = { s: [16, 11], m: [24, 16], l: [32, 21] } as const;
type MapSize = keyof typeof MAP_SIZES;
const HEX_SIZE = 36;
const STORE_KEY = 'hexfold-atlas-v1';
const SEED_WORDS = [
  'Aldermere', 'Brackwater', 'Cindervale', 'Duskmoor', 'Emberlee', 'Fallowmere', 'Greywater', 'Hollin',
  'Ironbrook', 'Juniper', 'Kestrel', 'Larchmont', 'Mirefield', 'Northwold', 'Oakhaven', 'Pellmoor',
  'Quarrydown', 'Ravensholm', 'Saltmarsh', 'Thornby', 'Umberlee', 'Vantmoor', 'Westmarch', 'Yarrowdale',
];

// ---- state ----------------------------------------------------------------

const state = {
  tool: 'paint' as Tool,
  biome: 'forest' as BiomeId,
  feature: 'village' as FeatureId,
  brush: 1,
  season: 'summer' as Season,
  hour: 14.5,
  grid: false,
  mapSize: 'm' as MapSize,
  seed: 'Aldermere',
};

let map: HexMap;
let R: TerrainRenderer;
let pool: TerrainWorkerPool | undefined;
try {
  pool = new TerrainWorkerPool(() => new TerrainWorker(), Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)));
} catch {
  pool = undefined; // Workers unavailable: render on the main thread.
}
const view = { scale: 1, ox: 0, oy: 0 };
let hover = -1;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLElement>('stage');
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const busy = $<HTMLElement>('busy');

// ---- persistence -----------------------------------------------------------

function loadSaved(): { map: MapJSON; ui: Partial<typeof state> } | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let saveTimer = 0;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ map: map.toJSON(), ui: state }));
    } catch {
      /* storage unavailable: the map simply is not remembered */
    }
  }, 700);
}

// ---- undo -------------------------------------------------------------------

type Snapshot = { biome: Uint8Array; level: Uint8Array; feature: Uint8Array; roads: Uint8Array; rivers: Uint8Array };
const undoStack: Snapshot[] = [];

function snapshot(): Snapshot {
  return {
    biome: map.biome.slice(),
    level: map.level.slice(),
    feature: map.feature.slice(),
    roads: map.roads.slice(),
    rivers: map.rivers.slice(),
  };
}

function pushUndo(): void {
  undoStack.push(snapshot());
  if (undoStack.length > 60) undoStack.shift();
}

function undo(): void {
  const snap = undoStack.pop();
  if (!snap) return;
  const changed: number[] = [];
  for (let i = 0; i < map.size; i++) {
    if (
      map.biome[i] !== snap.biome[i] ||
      map.level[i] !== snap.level[i] ||
      map.feature[i] !== snap.feature[i] ||
      map.roads[i] !== snap.roads[i] ||
      map.rivers[i] !== snap.rivers[i]
    ) {
      changed.push(i);
    }
  }
  map.biome.set(snap.biome);
  map.level.set(snap.level);
  map.feature.set(snap.feature);
  map.roads.set(snap.roads);
  map.rivers.set(snap.rivers);
  R.invalidate(changed);
  scheduleSave();
}

// ---- map / renderer lifecycle ------------------------------------------------

function seedNumber(text: string): number {
  return hashString(text.trim().toLowerCase() || 'hexfold') % 1000003;
}

function newRenderer(): void {
  R?.dispose();
  R = new TerrainRenderer(map, {
    hexSize: HEX_SIZE,
    environment: { season: state.season, hour: state.hour },
    grid: state.grid,
    pool,
  });
  map.onChange(() => scheduleSave());
}

function generate(): void {
  const [cols, rows] = MAP_SIZES[state.mapSize];
  const seed = seedNumber(state.seed);
  map = new HexMap(cols, rows, seed);
  generateWorld(map, { seed });
  undoStack.length = 0;
  newRenderer();
  fitView();
  scheduleSave();
  draw();
}

function blankMap(): void {
  pushUndo();
  map.fill('grassland', 0);
  scheduleSave();
}

// ---- view transform ----------------------------------------------------------

let cssW = 0;
let cssH = 0;

function resize(): void {
  const r = stage.getBoundingClientRect();
  cssW = r.width;
  cssH = r.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function fitView(): void {
  if (!R) return;
  const pad = 24;
  const sc = Math.min((cssW - pad * 2) / R.width, (cssH - pad * 2) / R.height);
  view.scale = Math.max(0.2, Math.min(2.5, sc));
  view.ox = (cssW - R.width * view.scale) / 2;
  view.oy = (cssH - R.height * view.scale) / 2;
  draw();
}

function zoomAt(factor: number, sx: number, sy: number): void {
  const ns = Math.max(0.25, Math.min(4, view.scale * factor));
  const k = ns / view.scale;
  view.ox = sx - (sx - view.ox) * k;
  view.oy = sy - (sy - view.oy) * k;
  view.scale = ns;
  draw();
}

function toMap(sx: number, sy: number): [number, number] {
  return [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];
}

// ---- drawing -------------------------------------------------------------------

let frame = 0;
function draw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!R) return;
    if (R.needsHeavyUpdate) runHeavy();
    else if (R.needsUpdate) R.update();
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = view.scale < 1.5;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(R.canvas as HTMLCanvasElement, view.ox, view.oy, R.width * view.scale, R.height * view.scale);
    if (hover >= 0) drawHover();
  });
}

/** Whole-map renders run on the worker pool behind the busy overlay. */
let heavyScheduled = false;
function runHeavy(): void {
  if (R.busy || heavyScheduled) return;
  heavyScheduled = true;
  const target = R;
  busy.hidden = false;
  // Let the overlay paint before the main-thread parts of the render run.
  requestAnimationFrame(() =>
    setTimeout(() => {
      target
        .updateAsync()
        .catch(() => target.update())
        .finally(() => {
          heavyScheduled = false;
          busy.hidden = true;
          draw();
        });
    }, 16),
  );
}

function drawHover(): void {
  const hexes = brushHexes(hover);
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);
  ctx.lineJoin = 'round';
  for (const h of hexes) {
    const pts = R.hexOutline(h);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.lineWidth = 3 / view.scale;
    ctx.strokeStyle = 'rgba(20,16,8,0.35)';
    ctx.stroke();
    ctx.lineWidth = 1.5 / view.scale;
    ctx.strokeStyle = 'rgba(255,236,190,0.95)';
    ctx.stroke();
  }
  ctx.restore();
}

function brushHexes(center: number): number[] {
  const radius = state.tool === 'paint' || state.tool === 'raise' || state.tool === 'lower' || state.tool === 'erase' ? state.brush - 1 : 0;
  if (radius <= 0) return [center];
  const c = map.axialOf(center);
  const out: number[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = -radius; dr <= radius; dr++) {
      const q = c.q + dq;
      const r = c.r + dr;
      if (hexDistance(c, { q, r }) > radius) continue;
      const i = map.indexOf(q, r);
      if (i >= 0) out.push(i);
    }
  }
  return out;
}

// ---- status line ------------------------------------------------------------------

const hoverInfo = $<HTMLElement>('hover-info');
const hoverCoords = $<HTMLElement>('hover-coords');

function updateStatus(): void {
  if (hover < 0) {
    hoverInfo.textContent = 'Drag to paint. Right-drag to move, scroll to zoom.';
    hoverCoords.textContent = '';
    return;
  }
  const c = map.cell(hover);
  const biome = BIOME_LIST.find((b) => b.id === c.biome)!;
  const parts: string[] = [biome.name];
  if (!biome.water) parts.push(LEVEL_NAMES[c.level]);
  if (c.feature) parts.push(FEATURES[c.feature].name);
  if (c.roads) parts.push('Road');
  if (c.rivers) parts.push('River');
  hoverInfo.textContent = parts.join(' · ');
  hoverCoords.textContent = `col ${c.col}, row ${c.row}`;
}

// ---- editing ------------------------------------------------------------------------

interface Stroke {
  visited: Set<number>;
  last: number;
  erasePaths: boolean;
}
let stroke: Stroke | null = null;

/** Hexes on the straight line between two hexes (inclusive), for fast drags. */
function hexLine(a: number, b: number): number[] {
  const A = map.axialOf(a);
  const B = map.axialOf(b);
  const n = hexDistance(A, B);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const fq = A.q + (B.q - A.q) * t + 1e-6;
    const fr = A.r + (B.r - A.r) * t + 1e-6;
    const fs = -fq - fr;
    let q = Math.round(fq);
    let r = Math.round(fr);
    const s = Math.round(fs);
    const dq = Math.abs(q - fq);
    const dr = Math.abs(r - fr);
    const ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    const idx = map.indexOf(q, r);
    if (idx >= 0 && out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

function applyAt(hex: number): void {
  if (!stroke || hex < 0) return;
  const tool = state.tool;
  if (tool === 'road' || tool === 'river') {
    if (stroke.last >= 0 && stroke.last !== hex) {
      const line = hexLine(stroke.last, hex);
      map.batch(() => {
        for (let k = 0; k + 1 < line.length; k++) {
          if (stroke!.erasePaths) map.disconnect(tool, line[k], line[k + 1]);
          else map.connect(tool, line[k], line[k + 1]);
        }
      });
    }
    stroke.last = hex;
    return;
  }
  if (tool === 'feature') {
    if (stroke.visited.has(hex)) return;
    stroke.visited.add(hex);
    const cur = map.featureAt(hex);
    map.setFeature(hex, cur === state.feature ? null : state.feature);
    return;
  }
  map.batch(() => {
    for (const h of brushHexes(hex)) {
      if (stroke!.visited.has(h)) continue;
      stroke!.visited.add(h);
      if (tool === 'paint') map.setBiome(h, state.biome);
      else if (tool === 'raise') map.setLevel(h, map.level[h] + 1);
      else if (tool === 'lower') map.setLevel(h, map.level[h] - 1);
      else if (tool === 'erase') map.resetHex(h);
    }
  });
}

// ---- pointer input -----------------------------------------------------------------

const pointers = new Map<number, { x: number; y: number }>();
let panning: { x: number; y: number } | null = null;
let pinch: { dist: number; cx: number; cy: number } | null = null;
let spaceDown = false;

function localPoint(e: PointerEvent | WheelEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function hexAtScreen(sx: number, sy: number): number {
  const [mx, my] = toMap(sx, sy);
  return R.pick(mx, my);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = localPoint(e);
  pointers.set(e.pointerId, { x, y });
  if (pointers.size === 2) {
    // Two fingers: pinch-zoom and pan, cancel any stroke in progress.
    stroke = null;
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    return;
  }
  if (e.button === 1 || e.button === 2 || state.tool === 'pan' || spaceDown) {
    panning = { x, y };
    canvas.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;
  pushUndo();
  stroke = { visited: new Set(), last: -1, erasePaths: e.altKey };
  const hex = hexAtScreen(x, y);
  applyAt(hex);
  draw();
});

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = localPoint(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    view.ox += cx - pinch.cx;
    view.oy += cy - pinch.cy;
    zoomAt(dist / (pinch.dist || dist), cx, cy);
    pinch = { dist, cx, cy };
    return;
  }
  if (panning) {
    view.ox += x - panning.x;
    view.oy += y - panning.y;
    panning = { x, y };
    draw();
    return;
  }
  const hex = hexAtScreen(x, y);
  if (hex !== hover) {
    hover = hex;
    updateStatus();
    draw();
  }
  if (stroke) {
    applyAt(hex);
    draw();
  }
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    if (stroke && stroke.visited.size === 0 && stroke.last < 0) undoStack.pop();
    stroke = null;
    panning = null;
    canvas.classList.remove('panning');
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (!stroke && hover !== -1) {
    hover = -1;
    updateStatus();
    draw();
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [x, y] = localPoint(e);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), x, y);
  },
  { passive: false },
);

// ---- panel UI ----------------------------------------------------------------------

function setChecked(container: HTMLElement, pred: (el: HTMLElement) => boolean): void {
  container.querySelectorAll<HTMLElement>('[role=radio]').forEach((el) => el.setAttribute('aria-checked', String(pred(el))));
}

const toolsEl = $<HTMLElement>('tools');
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool';
  b.setAttribute('role', 'radio');
  b.dataset.tool = t.id;
  b.title = `${t.label} (${t.key})`;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span>`;
  b.addEventListener('click', () => selectTool(t.id));
  toolsEl.appendChild(b);
}

function selectTool(tool: Tool): void {
  state.tool = tool;
  setChecked(toolsEl, (el) => el.dataset.tool === tool);
  $<HTMLElement>('tool-hint').textContent = TOOLS.find((t) => t.id === tool)!.hint;
  $<HTMLElement>('biome-group').hidden = tool !== 'paint';
  $<HTMLElement>('feature-group').hidden = tool !== 'feature';
  $<HTMLElement>('brush-group').hidden = !['paint', 'raise', 'lower', 'erase'].includes(tool);
  draw();
}

const biomesEl = $<HTMLElement>('biomes');
for (const b of BIOME_LIST) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'swatch';
  el.setAttribute('role', 'radio');
  el.dataset.biome = b.id;
  el.innerHTML = `<span class="chip" style="background:${b.swatch}"></span>${b.name}`;
  el.addEventListener('click', () => {
    state.biome = b.id;
    setChecked(biomesEl, (x) => x.dataset.biome === b.id);
  });
  biomesEl.appendChild(el);
}

const featuresEl = $<HTMLElement>('features');
for (const id of FEATURE_IDS) {
  const f = FEATURES[id];
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'feature';
  el.setAttribute('role', 'radio');
  el.dataset.feature = id;
  el.innerHTML = `<b>${f.name}</b><span>${f.hint}</span>`;
  el.addEventListener('click', () => {
    state.feature = id;
    setChecked(featuresEl, (x) => x.dataset.feature === id);
  });
  featuresEl.appendChild(el);
}

const brushEl = $<HTMLElement>('brush');
brushEl.querySelectorAll<HTMLElement>('button').forEach((b) =>
  b.addEventListener('click', () => {
    state.brush = Number(b.dataset.size);
    setChecked(brushEl, (x) => x === b);
  }),
);

const seasonsEl = $<HTMLElement>('seasons');
for (const s of SEASONS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.season = s;
  b.textContent = s[0].toUpperCase() + s.slice(1);
  b.addEventListener('click', () => setSeason(s));
  seasonsEl.appendChild(b);
}

function setSeason(s: Season): void {
  state.season = s;
  setChecked(seasonsEl, (x) => x.dataset.season === s);
  R.setEnvironment({ season: s });
  draw();
  scheduleSave();
}

const hourEl = $<HTMLInputElement>('hour');
const hourOut = $<HTMLOutputElement>('hour-out');
function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
hourEl.addEventListener('input', () => {
  state.hour = Number(hourEl.value);
  hourOut.textContent = formatHour(state.hour);
  R.setEnvironment({ hour: state.hour });
  draw();
  scheduleSave();
});

const gridEl = $<HTMLInputElement>('grid');
gridEl.addEventListener('change', () => {
  state.grid = gridEl.checked;
  R.setGrid(state.grid);
  draw();
  scheduleSave();
});

const seedEl = $<HTMLInputElement>('seed');
seedEl.addEventListener('change', () => {
  state.seed = seedEl.value.trim() || 'Aldermere';
});
seedEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    state.seed = seedEl.value.trim() || 'Aldermere';
    generate();
  }
});

const sizeEl = $<HTMLElement>('map-size');
sizeEl.querySelectorAll<HTMLElement>('button').forEach((b) =>
  b.addEventListener('click', () => {
    state.mapSize = b.dataset.size as MapSize;
    setChecked(sizeEl, (x) => x === b);
  }),
);

$('generate').addEventListener('click', () => {
  state.seed = seedEl.value.trim() || 'Aldermere';
  generate();
});
$('random-seed').addEventListener('click', () => {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  state.seed = `${word}-${Math.floor(Math.random() * 900 + 100)}`;
  seedEl.value = state.seed;
  generate();
});
const confirmEl = $<HTMLElement>('clear-confirm');
$('clear').addEventListener('click', () => (confirmEl.hidden = false));
$('clear-no').addEventListener('click', () => (confirmEl.hidden = true));
$('clear-yes').addEventListener('click', () => {
  confirmEl.hidden = true;
  blankMap();
  draw();
});
$('undo').addEventListener('click', () => {
  undo();
  draw();
});

$('zoom-in').addEventListener('click', () => zoomAt(1.25, cssW / 2, cssH / 2));
$('zoom-out').addEventListener('click', () => zoomAt(0.8, cssW / 2, cssH / 2));
$('zoom-fit').addEventListener('click', fitView);

const panel = $<HTMLElement>('panel');
const drawerToggle = $<HTMLButtonElement>('drawer-toggle');
drawerToggle.addEventListener('click', () => {
  const collapsed = panel.classList.toggle('collapsed');
  drawerToggle.setAttribute('aria-expanded', String(!collapsed));
  drawerToggle.textContent = collapsed ? 'Tools' : 'Hide';
  requestAnimationFrame(resize);
});

// ---- keyboard ----------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    draw();
    return;
  }
  if (e.key === ' ') {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
  if (t && !e.ctrlKey && !e.metaKey && !e.altKey) selectTool(t.id);
  if (e.key === 'g' || e.key === 'G') {
    gridEl.checked = !gridEl.checked;
    gridEl.dispatchEvent(new Event('change'));
  }
  if (e.key === '[') setBrush(state.brush - 1);
  if (e.key === ']') setBrush(state.brush + 1);
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceDown = false;
});

function setBrush(n: number): void {
  state.brush = Math.max(1, Math.min(3, n));
  setChecked(brushEl, (x) => Number(x.dataset.size) === state.brush);
}

// ---- boot ------------------------------------------------------------------------------

function boot(): void {
  const saved = loadSaved();
  if (saved?.ui) Object.assign(state, saved.ui);
  seedEl.value = state.seed;
  hourEl.value = String(state.hour);
  hourOut.textContent = formatHour(state.hour);
  gridEl.checked = state.grid;
  setChecked(seasonsEl, (x) => x.dataset.season === state.season);
  setChecked(sizeEl, (x) => x.dataset.size === state.mapSize);
  setChecked(biomesEl, (x) => x.dataset.biome === state.biome);
  setChecked(featuresEl, (x) => x.dataset.feature === state.feature);
  setBrush(state.brush);
  selectTool(state.tool);
  updateStatus();
  resize();
  new ResizeObserver(resize).observe(stage);

  if (saved?.map) {
    try {
      map = HexMap.fromJSON(saved.map);
    } catch {
      generate();
      return;
    }
    newRenderer();
    fitView();
    draw();
  } else generate();
}

boot();

// Expose for debugging and automated checks.
(window as unknown as { hexfold: unknown }).hexfold = {
  get map() {
    return map;
  },
  get renderer() {
    return R;
  },
  state,
  AXIAL_DIRS,
};
