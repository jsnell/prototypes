'use strict';
// ---------- boot, main loop, screens ----------
let acc = 0, lastNow = 0, awarded = null;

function layout() {
  const st = $('stage'), r = st.getBoundingClientRect();
  const fit = Math.min(r.width / W, r.height / H);
  const ints = Math.floor(fit);
  const scale = ints >= 2 && ints >= fit * 0.9 ? ints : fit;
  const cw = Math.floor(W * scale), ch = Math.floor(H * scale);
  const left = Math.floor((r.width - cw) / 2), top = Math.floor((r.height - ch) / 2);
  for (const c of [$('gl'), $('ov')]) { c.style.left = left + 'px'; c.style.top = top + 'px'; c.style.width = cw + 'px'; c.style.height = ch + 'px'; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  $('gl').width = Math.round(cw * dpr); $('gl').height = Math.round(ch * dpr);
  $('ov').width = W * 2; $('ov').height = H * 2;
}

function lightingEnv() {
  const B = G.biome, d = G.dayness;
  const amb = mix3(B.night, B.day, d);
  // sun sweeps across the sky over the day; moon hangs low
  const prog = G.phase === 'lull' ? 1 - G.phaseT / (G.wave === 0 ? FIRST_LULL : LULL) : 1;
  const az = lerp(-2.4, -0.7, clamp(prog, 0, 1)), el = lerp(0.75, 0.42, Math.abs(prog - 0.5) * 2);
  const sunDir = [Math.cos(az) * Math.cos(el), -Math.sin(az) * Math.cos(el) * -1, Math.sin(el)];
  const sl = Math.hypot(...sunDir); sunDir[0] /= sl; sunDir[1] /= sl; sunDir[2] /= sl;
  const moonDir = [0.55, -0.5, 0.67];
  const dir = d > 0.3 ? sunDir : moonDir;
  const warm = smoothstep(0.25, 0.9, d);
  const sunCol = mix3(B.moon, [B.sun[0] * 1.35, B.sun[1] * 1.35 * lerp(0.6, 1, warm), B.sun[2] * 1.35 * lerp(0.4, 1, warm)], smoothstep(0.15, 0.85, d));
  return {
    amb, sunDir: dir, sunCol, emScale: 2.2, exposure: lerp(1.5, 1.0, d), flash: G.flash, bloom: lerp(1.2, 0.7, d), bloomThresh: lerp(0.55, 0.9, d),
    shake: [Math.round((Math.random() - 0.5) * G.shake * 2), Math.round((Math.random() - 0.5) * G.shake * 2)], time: G.t,
    decalFade: 0,
  };
}

function render() {
  const env = lightingEnv();
  G.decalTick++;
  env.decalFade = (G.decalTick % 90 === 0 ? 1 : 0) | (G.decalTick % 3 === 0 ? 2 : 0);
  for (const b of [GFX.bG, GFX.bE, GFX.bS, GFX.bL, GFX.bTop]) b.reset();
  const base = G.lights.length;
  fxLights();
  drawWorld(env);
  if (G.decalTick % 2 === 0) buildLightGrid();
  for (const L of G.lights) GFX.bL.light(L.x, L.y, L.z, L.r, L.cr, L.cg, L.cb, L.dx, L.dy, L.cone, L.soft);
  G.lights.length = base;
  renderFrame(env);
  GFX.bDC.reset(); GFX.bDE.reset();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (lastNow || now)) / 1000); lastNow = now;
  if (!G) return;
  acc += dt * (G.paused ? 0 : G.speed);
  let steps = 0;
  while (acc >= DT && steps < 8) { step(DT); acc -= DT; steps++; }
  if (steps === 8) acc = 0;
  render();
  drawOverlay();
  UI.hudT -= dt;
  if (UI.hudT <= 0 && UI.screen === 'game') { UI.hudT = 0.1; updateHUD(); }
  if (G.demo && G.over && G.overT > 4) restartDemo();
  if (UI.screen === 'game' && G.over && G.overT > (G.result.won ? 5 : 3.5)) showEnd();
}

function restartDemo() {
  const fac = pick(Object.keys(FACTIONS).filter(f => Meta.factionOpen(f)));
  newGame({ demo: true, faction: fac, biome: Meta.data.sel.biome, difficulty: 0, boost: {}, unlocked: { b_flamer: true, b_mortar: true } });
  // a ready-made base so the attract mode looks lived-in
  const S = G.map.sectors; const home = S.find(s => s.claimed);
  const nb = [...home.nb].map(i => S[i]).filter(s => !s.hive);
  for (const s of nb.slice(0, 2)) s.claimed = true;
  G.postsDirty = true;
  G.res = 2000; G.phase = 'lull';
  for (let i = 0; i < 40; i++) autoBuildStep();
  autoFortify(true);
  G.res = 300; G.wave = 2 + rndi(0, 3); G.phaseT = 6; G.dayness = 0.3;
  initWeather();
}

function startGame() {
  SFX.init();
  awarded = null;
  newGame(Meta.gameOpts());
  initWeather();
  UI.screen = 'game'; cancelAll();
  $('menu').style.display = 'none'; $('end').style.display = 'none';
  buildHUD(); updateHUD();
  msg('Claim sectors, wall the gaps, light the dark. Night falls in ' + FIRST_LULL + 's.', '#cfe');
}
function showMenu() {
  UI.screen = 'menu';
  $('end').style.display = 'none'; $('menu').style.display = 'block';
  buildMenu();
  restartDemo();
}
function showEnd() {
  if (UI.screen === 'end') return;
  UI.screen = 'end';
  awarded = Meta.award(G);
  const won = G.result.won;
  $('endTitle').textContent = won ? 'COLONY HOLDS' : 'COLONY LOST';
  $('endTitle').style.color = won ? 'var(--hi)' : 'var(--bad)';
  $('endSub').textContent = G.fac.name + ' · ' + G.biome.name + ' · ' + G.diff.name;
  const rows = [['Hostiles killed', G.kills], ['Structures lost', G.lost], ['Stratagems called', G.specialsUsed]];
  for (const [k, v] of awarded.parts) rows.push([k, v]);
  rows.push(['Threat multiplier', '×' + awarded.mult.toFixed(2)]);
  rows.push(['<b style="color:var(--warn)">SCRIP EARNED</b>', '<b style="color:var(--warn)">' + awarded.total + '</b>']);
  $('endStats').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('end').style.display = 'flex';
}

function boot() {
  try {
    buildAtlas();
    initRenderer($('gl'));
  } catch (e) {
    console.error(e);
    $('err').style.display = 'flex'; $('err').textContent = 'Could not start: ' + e.message + ' (this needs a browser with WebGL2)';
    return;
  }
  Meta.load();
  initInput();
  layout(); window.addEventListener('resize', layout);
  $('btnDeploy').onclick = startGame;
  $('btnAgain').onclick = startGame;
  $('btnEndMenu').onclick = showMenu;
  $('tabDeploy').onclick = () => { $('paneDeploy').style.display = ''; $('paneShop').style.display = 'none'; $('tabDeploy').classList.add('on'); $('tabShop').classList.remove('on'); };
  $('tabShop').onclick = () => { $('paneDeploy').style.display = 'none'; $('paneShop').style.display = ''; $('tabShop').classList.add('on'); $('tabDeploy').classList.remove('on'); };
  showMenu();
  if (location.hash === '#play') startGame();
  requestAnimationFrame(frame);
}
boot();
