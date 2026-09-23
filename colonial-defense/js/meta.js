'use strict';
// ---------- meta progression: scrip, unlocks, scenario setup ----------
const META_KEY = 'colonial-defense-v1';
const Meta = {
  data: { scrip: 0, unlocked: {}, best: {}, runs: 0, sel: { faction: 'hive', biome: 'barren', difficulty: 0 } },
  load() {
    try { const d = JSON.parse(localStorage.getItem(META_KEY)); if (d) Object.assign(this.data, d); } catch (e) { }
    for (const [id, c] of Object.entries(LEGACY_REFUND)) if (this.data.unlocked[id]) { delete this.data.unlocked[id]; this.data.scrip += c; this.save(); }
    if (location.hash === '#unlockall') for (const u of UNLOCKS) this.data.unlocked[u.id] = true;
  },
  save() { try { localStorage.setItem(META_KEY, JSON.stringify(this.data)); } catch (e) { } },
  has(id) { return !!this.data.unlocked[id]; },
  factionOpen(f) { return f === 'hive' || this.has('fac_' + f); },
  biomeOpen(b) { return b === 'barren' || this.has('bio_' + b); },
  diffOpen(i) { return i === 0 || this.has('dif_' + i); },
  buy(u) {
    if (this.has(u.id) || this.data.scrip < u.cost || (u.req && !this.has(u.req))) return false;
    this.data.scrip -= u.cost; this.data.unlocked[u.id] = true; this.save(); return true;
  },
  boosts() {
    const u = this.data.unlocked;
    return { cache: (u.x_cache1 ? 100 : 0) + (u.x_cache2 ? 100 : 0) + (u.x_cache3 ? 150 : 0), survey: !!u.x_survey, prefab: !!u.x_prefab, relay: !!u.x_relay };
  },
  gameOpts() {
    const s = this.data.sel;
    return { faction: s.faction, biome: s.biome, difficulty: s.difficulty, boost: this.boosts(), unlocked: { ...this.data.unlocked } };
  },
  // scrip = how long you lasted x how hard it was
  award(G) {
    const cleared = G.result.won ? WAVES : Math.max(0, G.wave - 1);
    const minutes = G.t / 60;
    const mult = G.diff.mult * G.fac.mult;
    const parts = [
      ['Time survived (' + fmtTime(G.t) + ')', Math.round(minutes * 6)],
      ['Nights held (' + cleared + ')', cleared * 8],
    ];
    if (G.result.won) parts.push(['Evacuation bonus', 80]);
    const base = parts.reduce((s, p) => s + p[1], 0);
    const total = Math.round(base * mult);
    this.data.scrip += total; this.data.runs++;
    const key = G.opts.faction + '/' + G.opts.difficulty;
    const prev = this.data.best[key] || 0;
    const score = G.result.won ? WAVES + 1 : cleared;
    if (score > prev) this.data.best[key] = score;
    this.save();
    return { parts, base, mult, total };
  },
};

function buildMenu() {
  const D = Meta.data, s = D.sel;
  document.getElementById('scrip').textContent = D.scrip;
  const mk = (host, items) => {
    host.innerHTML = '';
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'card' + (it.sel ? ' sel' : '') + (it.open ? '' : ' locked');
      el.innerHTML = it.title + '<small>' + (it.open ? it.desc : '🔒 requisition for ' + it.cost + ' scrip') + '</small>';
      if (it.open) el.onclick = () => { it.pick(); SFX.play('click'); buildMenu(); };
      host.appendChild(el);
    }
  };
  mk(document.getElementById('selFaction'), Object.entries(FACTIONS).map(([k, f]) => ({
    title: f.name + (f.mult > 1 ? ' <span style="color:var(--warn)">×' + f.mult + '</span>' : ''), desc: f.desc, open: Meta.factionOpen(k), sel: s.faction === k,
    cost: (UNLOCKS.find(u => u.id === 'fac_' + k) || {}).cost, pick: () => s.faction = k,
  })));
  mk(document.getElementById('selBiome'), Object.entries(BIOMES).map(([k, b]) => ({
    title: b.name, desc: b.desc, open: Meta.biomeOpen(k), sel: s.biome === k,
    cost: (UNLOCKS.find(u => u.id === 'bio_' + k) || {}).cost, pick: () => { s.biome = k; restartDemo(); },
  })));
  mk(document.getElementById('selDiff'), DIFFICULTIES.map((d, i) => ({
    title: d.name + ' <span style="color:var(--warn)">×' + d.mult + '</span>', desc: 'x' + d.count + ' hostiles', open: Meta.diffOpen(i), sel: s.difficulty === i,
    cost: (UNLOCKS.find(u => u.id === 'dif_' + i) || {}).cost, pick: () => s.difficulty = i,
  })));
  const b = Meta.boosts(), bl = [];
  if (b.cache) bl.push('+' + b.cache + ' materiel'); if (b.survey) bl.push('forward survey'); if (b.prefab) bl.push('prefab defenses'); if (b.relay) bl.push('orbital relay');
  document.getElementById('boosters').textContent = bl.length ? bl.join(' · ') : 'none — requisition some';
  const best = D.best[s.faction + '/' + s.difficulty];
  document.getElementById('best').textContent = best ? (best > WAVES ? 'best: EVACUATED' : 'best: held ' + best + ' nights') : '';
  // shop
  const shop = document.getElementById('paneShop'); shop.innerHTML = '';
  let cat = '';
  for (const u of UNLOCKS) {
    if (u.cat !== cat) { cat = u.cat; const h = document.createElement('div'); h.className = 'shopcat'; h.textContent = cat.toUpperCase(); shop.appendChild(h); }
    const own = Meta.has(u.id), reqOk = !u.req || Meta.has(u.req);
    const el = document.createElement('div'); el.className = 'shopitem' + (own ? ' owned' : '');
    el.innerHTML = '<div class="d">' + u.name + '<small>' + u.desc + (!reqOk ? ' (requires ' + UNLOCKS.find(x => x.id === u.req).name + ')' : '') + '</small></div>';
    const btn = document.createElement('button'); btn.className = 'btn';
    btn.textContent = own ? 'OWNED' : u.cost + ' scrip';
    btn.disabled = own || !reqOk || D.scrip < u.cost;
    btn.onclick = () => { if (Meta.buy(u)) { SFX.play('claim'); buildMenu(); } };
    el.appendChild(btn); shop.appendChild(el);
  }
  Meta.save();
}
