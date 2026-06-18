/*
 * COMPOUND — mechanics prototype (ES5, runs on node).
 *
 * Goal of this file: get DATA. It implements the economy/production graph,
 * power-as-flow, population, tech eras, directives, and a heuristic AI that
 * actually plays a scenario so we can see whether the curve + gate pacing
 * create tension.
 *
 * SIMPLIFICATIONS vs DESIGN.md (deliberate, for a first data pass):
 *  - Spatial layer is AGGREGATE, not a hex grid: a global tile budget, a count
 *    of deposit slots per raw, and a global heat budget (radiators) / power flow.
 *    This keeps the costs of space (tiles, deposits, radiators, sunline) without
 *    needing a placement AI. Per-tile adjacency clusters are not modelled yet.
 *  - Gases (N2/CO2) collapsed into one "volatiles" stream.
 *  - Construction applies the same turn it's built (new buildings produce that
 *    turn). Slightly generous but fine for pacing data.
 *  - Storage caps generous (not the binding constraint yet).
 *
 * Run:  node sim.js          (plays one game, prints the log)
 *       node sim.js quiet    (just the final summary)
 */

'use strict';

/* ----------------------------------------------------------------------- */
/* Tunable constants                                                       */
/* ----------------------------------------------------------------------- */

var FOOD_PP = 0.20, WATER_PP = 0.20, O2_PP = 0.10, POWER_PP = 0.30; // per pop/turn
var RAD_CAP = 6;        // heat dissipated per radiator
var HAB_CAP = 6;        // pop per habitat
var ARC_CAP = 30;       // pop per arcology
var GROWTH = 0.12;      // fractional pop growth per turn when surplus
var ERA3_RESEARCH = 12, ERA4_RESEARCH = 40;
var POP_CAP = 84;       // AI soft housing cap: stop sprawling, leave tiles for late industry

/* ----------------------------------------------------------------------- */
/* Building definitions                                                    */
/*   in/out are per-instance per-turn. power>0 = draw. gen>0 = produces.    */
/*   staff = pop needed to operate. heat = heat emitted. deposit = needs a  */
/*   slot of that raw. era = tech tier required. tile defaults to 1.        */
/* ----------------------------------------------------------------------- */

var TYPES = {
  /* --- power generation (solar is passive: no labour, but sunline-limited) --- */
  solar:        { era:1, cost:{metal:6},  staff:0, gen:10, deposit:'sun' },
  geo:          { era:2, cost:{metal:12}, staff:1, gen:24, deposit:'vent' },
  reactor:      { era:2, cost:{metal:25}, staff:2, gen:44, in:{water:2}, heat:3, radiation:true },
  fusion:       { era:3, cost:{metal:40, components:10}, staff:3, gen:90, in:{water:4}, heat:5 },

  /* --- housing --- */
  habitat:      { era:1, cost:{metal:8},  staff:0, housing:HAB_CAP },
  arcology:     { era:3, cost:{metal:20, modules:6}, staff:0, housing:ARC_CAP },

  /* --- raw extraction (deposit-bound) --- */
  oreMine:        { era:1, cost:{metal:6}, staff:1, power:3, out:{ore:12},      deposit:'ore' },
  iceExtractor:   { era:1, cost:{metal:6}, staff:1, power:3, out:{ice:10},      deposit:'ice' },
  silicaQuarry:   { era:1, cost:{metal:6}, staff:1, power:3, out:{silica:10},   deposit:'silica' },
  regolithScraper:{ era:1, cost:{metal:5}, staff:1, power:2, out:{regolith:20} },
  rareMine:       { era:2, cost:{metal:12},staff:2, power:6, out:{rare:4},      deposit:'rare' },
  volatilesWell:  { era:2, cost:{metal:10},staff:1, power:4, out:{volatiles:10},deposit:'volatiles' },

  /* --- tier 1 refining --- */
  waterPlant:   { era:1, cost:{metal:8},  staff:1, power:4, in:{ice:8},                 out:{water:10} },
  electrolysis: { era:1, cost:{metal:8},  staff:1, power:6, in:{water:6},               out:{oxygen:4, hydrogen:2} },
  concretePlant:{ era:1, cost:{metal:8},  staff:1, power:3, in:{regolith:12, water:3},  out:{concrete:8} },
  smelter:      { era:2, cost:{metal:10}, staff:1, power:6, in:{ore:8},                 out:{metal:11}, heat:2 },
  glassKiln:    { era:2, cost:{metal:10}, staff:1, power:5, in:{silica:6},              out:{glass:5}, heat:2 },
  siliconRefinery:{era:2, cost:{metal:10},staff:1, power:6, in:{silica:6},              out:{silicon:4}, heat:2 },

  /* --- tier 2 intermediates --- */
  foundry:      { era:2, cost:{metal:12}, staff:1, power:6, in:{metal:5, rare:2, oxygen:2}, out:{alloy:4}, heat:3 },
  polymerPlant: { era:2, cost:{metal:12}, staff:1, power:4, in:{volatiles:5, hydrogen:2},   out:{polymer:4} },
  chemPlant:    { era:2, cost:{metal:10}, staff:1, power:3, in:{volatiles:3, water:3},       out:{fertilizer:4} },
  greenhouse:   { era:1, cost:{metal:8},  staff:1, power:3, in:{water:4, volatiles:2}, out:{food:6} },

  /* --- tier 3 advanced --- */
  electronicsFab:{era:2, cost:{metal:14}, staff:2, power:5, in:{silicon:3, rare:1, glass:2}, out:{electronics:4} },
  assembler:    { era:2, cost:{metal:14}, staff:2, power:5, in:{alloy:2, polymer:2, electronics:2}, out:{components:3}, heat:2 },
  circuitFab:   { era:3, cost:{metal:16, components:4}, staff:2, power:6, in:{electronics:2, glass:2, rare:1}, out:{circuits:4} },
  compositePlant:{era:3, cost:{metal:16, components:4}, staff:2, power:5, in:{alloy:2, polymer:2, glass:2}, out:{composites:2}, heat:2 },
  moduleAssembly:{era:3, cost:{metal:16, components:4}, staff:2, power:4, in:{components:2, concrete:4, glass:2}, out:{modules:2} },

  /* --- tier 4 --- */
  lab:          { era:2, cost:{metal:14, components:2}, staff:2, power:6, in:{components:2}, out:{research:5} },
  roboticsPlant:{ era:3, cost:{metal:18, components:6}, staff:2, power:6, in:{components:2, circuits:1}, out:{robotics:1} },

  /* --- support / passive (no recipe; effects handled specially) --- */
  radiator:     { era:2, cost:{metal:6} },
  depot:        { era:1, cost:{metal:6} },
  battery:      { era:2, cost:{metal:8} },
  automationHub:{ era:3, cost:{metal:20, components:8} },                 // cuts staffing
  aiCore:       { era:4, cost:{metal:30, components:20, circuits:10}, unique:true }, // +prod
  fabricator:   { era:4, cost:{metal:25, components:15} }                 // cuts build cost, can self-copy
};

/* resolution order: generators first, then consumers raw->refined */
var GEN_ORDER = ['solar','geo','reactor','fusion'];
var CONSUMER_ORDER = [
  'oreMine','iceExtractor','silicaQuarry','regolithScraper','rareMine','volatilesWell',
  'waterPlant','electrolysis','concretePlant','smelter','glassKiln','siliconRefinery',
  'foundry','polymerPlant','chemPlant','greenhouse',
  'electronicsFab','assembler','circuitFab','compositePlant','moduleAssembly',
  'lab','roboticsPlant'
];

/* which building produces a given good (for the AI's chain reasoning) */
var PRODUCER = {
  ore:'oreMine', ice:'iceExtractor', silica:'silicaQuarry', regolith:'regolithScraper',
  rare:'rareMine', volatiles:'volatilesWell',
  water:'waterPlant', oxygen:'electrolysis', hydrogen:'electrolysis', concrete:'concretePlant',
  metal:'smelter', glass:'glassKiln', silicon:'siliconRefinery',
  alloy:'foundry', polymer:'polymerPlant', fertilizer:'chemPlant', food:'greenhouse',
  electronics:'electronicsFab', components:'assembler', circuits:'circuitFab',
  composites:'compositePlant', modules:'moduleAssembly', research:'lab', robotics:'roboticsPlant'
};

/* ----------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ----------------------------------------------------------------------- */

function clone(o){ var r={}; for(var k in o) r[k]=o[k]; return r; }
function get(o,k){ return o[k]||0; }

function mods(B){
  var nAuto = get(B,'automationHub');
  var af = Math.pow(0.82, nAuto); if(af<0.55) af=0.55;        // staffing multiplier
  var pf = 1 + 0.25*get(B,'aiCore');                          // production multiplier (AI core)
  var cf = Math.pow(0.95, get(B,'fabricator')); if(cf<0.6) cf=0.6; // construction cost multiplier
  return { af:af, pf:pf, cf:cf };
}

function housingOf(B){ return get(B,'habitat')*HAB_CAP + get(B,'arcology')*ARC_CAP; }

/* ----------------------------------------------------------------------- */
/* Turn resolution (pure): produce, consume, grow pop. Returns a report.   */
/* ----------------------------------------------------------------------- */

function resolveTurn(stock, B, pop, m, bonusPf){
  var pool = clone(stock);
  var produced = {}, consumed = {}, idled = {};
  var staff = pop;
  var pf = m.pf * (bonusPf||1);
  var i, t, T, g;

  /* generators */
  var power = 0;
  for(i=0;i<GEN_ORDER.length;i++){
    t = GEN_ORDER[i]; var c = get(B,t); if(!c) continue;
    T = TYPES[t]; var inst = c;
    var st = T.staff*m.af;
    if(st>0) inst = Math.min(inst, Math.floor(staff/st));
    var inp = T.in||{};
    for(g in inp) inst = Math.min(inst, Math.floor(get(pool,g)/inp[g]));
    if(inst<0) inst=0;
    for(g in inp){ pool[g]=get(pool,g)-inp[g]*inst; consumed[g]=get(consumed,g)+inp[g]*inst; }
    staff -= st*inst;
    power += T.gen*inst;       // power gen not scaled by AI core (it's infra)
    idled[t]=c-inst;
  }

  /* heat budget from radiators */
  var heat = get(B,'radiator')*RAD_CAP;

  /* consumers, raw -> refined */
  for(i=0;i<CONSUMER_ORDER.length;i++){
    t = CONSUMER_ORDER[i]; var cc = get(B,t); if(!cc) continue;
    T = TYPES[t]; var k = cc;
    var st2 = T.staff*m.af;
    if(st2>0) k = Math.min(k, Math.floor(staff/st2));
    if(T.power>0) k = Math.min(k, Math.floor(power/T.power));
    var in2 = T.in||{};
    for(g in in2) k = Math.min(k, Math.floor(get(pool,g)/in2[g]));
    if(T.heat>0) k = Math.min(k, Math.floor(heat/T.heat));
    if(k<0) k=0;
    for(g in in2){ pool[g]=get(pool,g)-in2[g]*k; consumed[g]=get(consumed,g)+in2[g]*k; }
    if(T.power>0) power -= T.power*k;
    staff -= st2*k;
    if(T.heat>0) heat -= T.heat*k;
    var out = T.out||{};
    for(g in out){ var add = out[g]*k*pf; pool[g]=get(pool,g)+add; produced[g]=get(produced,g)+add; }
    idled[t]=cc-k;
  }

  /* life support */
  var lsOK = true, why = '';
  var needP = pop*POWER_PP, needF = pop*FOOD_PP, needW = pop*WATER_PP, needO = pop*O2_PP;
  if(power < needP){ lsOK=false; why='power'; } else power -= needP;
  if(get(pool,'food') < needF){ lsOK=false; why=why||'food'; pool.food=0; } else pool.food=get(pool,'food')-needF;
  if(get(pool,'water')< needW){ lsOK=false; why=why||'water'; pool.water=0; } else pool.water=get(pool,'water')-needW;
  if(get(pool,'oxygen')<needO){ lsOK=false; why=why||'oxygen'; pool.oxygen=0; } else pool.oxygen=get(pool,'oxygen')-needO;

  /* population growth (monotonic) */
  var housing = housingOf(B);
  var newPop = pop;
  if(lsOK && pop < housing){
    if(get(pool,'food') >= needF*0.5 && get(pool,'water') >= needW*0.5){
      var grow = Math.min(housing-pop, Math.max(1, Math.floor(pop*GROWTH)+1));
      newPop = pop + grow;
    }
  }

  return { stock:pool, pop:newPop, powerLeft:power, staffLeft:staff, produced:produced, consumed:consumed,
           idled:idled, lsOK:lsOK, why:why, housing:housing };
}

/* ----------------------------------------------------------------------- */
/* Scenario: "Mare Frigoris" (24 turns)                                    */
/* ----------------------------------------------------------------------- */

function scenario(){
  return {
    turns: 24,
    tilesMax: 100,
    deposits: { ore:5, ice:7, silica:4, rare:2, volatiles:3, vent:1, sun:8 },
    start: {
      pop: 12,
      stock: { metal:140, food:24, water:24, oxygen:16 },
      buildings: { solar:3, habitat:2, iceExtractor:1, waterPlant:1, volatilesWell:1, greenhouse:1 }
    },
    /* Directives, all visible from t1. Now FLEXIBLE-FULFILLMENT (v0.2 design):
       gates offer alternative ways to satisfy them, so the player CHOOSES which
       part of the economy to lean on. Clause kinds: {pop:N} | {ship:{good,amt}} |
       {have:{good,amt}} | {anyOf:[...]}. Modes: all / any / kofn(k). */
    required: [
      { turn:5,  id:'R1', mode:'all', desc:'pop>=18',
        clauses:[ {pop:18} ] },
      { turn:9,  id:'R2', mode:'any', desc:'ship 40 Metal OR 24 Components',
        clauses:[ {ship:{good:'metal',amt:40}}, {ship:{good:'components',amt:24}} ] },
      { turn:14, id:'R3', mode:'kofn', k:2, desc:'meet 2 of: pop>=40 / 28 Components / 70 Food',
        clauses:[ {pop:40}, {ship:{good:'components',amt:28}}, {ship:{good:'food',amt:70}} ] },
      { turn:20, id:'R4', mode:'any', desc:'ship 14 Circuits OR 12 Composites',
        clauses:[ {ship:{good:'circuits',amt:14}}, {ship:{good:'composites',amt:12}} ] },
      { turn:24, id:'R5', mode:'all', desc:'FINAL: pop>=60 AND (8 Modules OR 24 Circuits in stock)',
        clauses:[ {pop:60}, {anyOf:[ {have:{good:'modules',amt:8}}, {have:{good:'circuits',amt:24}} ]} ] }
    ],
    optional: [
      { id:'O1', early:6, expire:9, desc:'ship 30 Food -> +60 Metal, +5% production',
        ship:function(s){ if(get(s.stock,'food')>=30){ s.stock.food-=30; s.stock.metal=get(s.stock,'metal')+60; s.bonusPf+=0.05; return true; } return false; } },
      { id:'O2', early:16, expire:18, desc:'cumulative Research>=30 -> +10% production, unlock Era4',
        check:function(s){ if(get(s.stock,'research')>=30){ s.bonusPf+=0.10; s.era4early=true; return true; } return false; } }
    ],
    majorThreshold: 1400
  };
}

/* ----------------------------------------------------------------------- */
/* The heuristic AI player                                                 */
/* ----------------------------------------------------------------------- */

/* ----------------------------------------------------------------------- */
/* Flexible directives: clause evaluation + deadline resolution            */
/*   clause kinds: {pop:N} | {ship:{good,amt}} | {have:{good,amt}} | {anyOf:[]} */
/* ----------------------------------------------------------------------- */

var TIERW = { metal:1, food:1, water:1, oxygen:1, components:4, circuits:7, composites:6, modules:9, research:2, robotics:6 };
var POPW = 1.5;

function clauseSat(S, c){
  if(c.pop!=null) return S.pop >= c.pop;
  if(c.ship) return get(S.stock,c.ship.good) >= c.ship.amt;
  if(c.have) return get(S.stock,c.have.good) >= c.have.amt;
  if(c.anyOf){ for(var i=0;i<c.anyOf.length;i++) if(clauseSat(S,c.anyOf[i])) return true; return false; }
  return false;
}
/* real cost of satisfying NOW (only ship clauses consume goods) */
function clauseSpend(S, c){
  if(c.pop!=null || c.have) return 0;
  if(c.ship) return c.ship.amt * (TIERW[c.ship.good]||1);
  if(c.anyOf){ var best=1e9; for(var i=0;i<c.anyOf.length;i++) if(clauseSat(S,c.anyOf[i])){ var x=clauseSpend(S,c.anyOf[i]); if(x<best)best=x; } return best; }
  return 1e9;
}
function clauseLabel(S, c){
  if(c.pop!=null) return 'pop'+(S&&S.pop!=null?'('+Math.round(S.pop)+')':'')+'>='+c.pop;
  if(c.ship) return c.ship.amt+' '+c.ship.good;
  if(c.have) return c.have.amt+' '+c.have.good;
  if(c.anyOf){ for(var i=0;i<c.anyOf.length;i++) if(S&&clauseSat(S,c.anyOf[i])) return clauseLabel(S,c.anyOf[i]); return 'anyOf'; }
  return '?';
}
function clauseApply(S, c){
  if(c.pop!=null || c.have) return;
  if(c.ship){ S.stock[c.ship.good]=get(S.stock,c.ship.good)-c.ship.amt; return; }
  if(c.anyOf){ var best=null,bc=1e9; for(var i=0;i<c.anyOf.length;i++) if(clauseSat(S,c.anyOf[i])){ var x=clauseSpend(S,c.anyOf[i]); if(x<bc){bc=x;best=c.anyOf[i];} } if(best) clauseApply(S,best); }
}
/* resolve a required directive at its deadline; satisfies the cheapest option(s).
   records which alternative was used in S.choice for diversity reporting. */
function satisfyRequired(S, d){
  var cs=d.clauses, i; S.choice = S.choice||{};
  if(d.mode==='all'){
    for(i=0;i<cs.length;i++) if(!clauseSat(S,cs[i])) return false;
    var ls=[]; for(i=0;i<cs.length;i++){ ls.push(clauseLabel(S,cs[i])); clauseApply(S,cs[i]); }
    S.choice[d.id]=ls.join('+'); return true;
  }
  if(d.mode==='any'){
    var best=null,bc=1e9; for(i=0;i<cs.length;i++) if(clauseSat(S,cs[i])){ var x=clauseSpend(S,cs[i]); if(x<bc){bc=x;best=cs[i];} }
    if(!best) return false; S.choice[d.id]=clauseLabel(S,best); clauseApply(S,best); return true;
  }
  if(d.mode==='kofn'){
    var sat=[]; for(i=0;i<cs.length;i++) if(clauseSat(S,cs[i])) sat.push(cs[i]);
    if(sat.length < d.k) return false;
    sat.sort(function(a,b){ return clauseSpend(S,a)-clauseSpend(S,b); });
    var lk=[]; for(i=0;i<d.k;i++){ lk.push(clauseLabel(S,sat[i])); clauseApply(S,sat[i]); }
    S.choice[d.id]=lk.join('+'); return true;
  }
  return false;
}

/* ----------------------------------------------------------------------- */
/* AI gate planning: choose WHICH alternative to aim for, ahead of time    */
/* ----------------------------------------------------------------------- */

function stratW(S, key){ return (S.strat && S.strat[key]!=null) ? S.strat[key] : 1; }
function projGood(S, rep, good, tl){ return get(S.stock,good) + Math.max(0, get(rep.produced,good)-get(rep.consumed,good))*tl; }

/* estimated effort (lower = more attractive) to make a clause true by deadline,
   biased by the player's strategy weights -> different strategies pick differently */
function clauseEffort(S, rep, c, tl){
  if(c.pop!=null){ return Math.max(0, c.pop - S.pop)*POPW*stratW(S,'pop'); }
  if(c.ship||c.have){ var sp=c.ship||c.have;
    var def=Math.max(0, sp.amt - projGood(S,rep,sp.good,tl));
    var base=def*(TIERW[sp.good]||1);
    if(def>0 && get(S.B, PRODUCER[sp.good]||'_')===0) base += 25; /* cold-start a deep chain */
    return base*stratW(S,sp.good);
  }
  if(c.anyOf){ var best=1e9; for(var i=0;i<c.anyOf.length;i++){ var x=clauseEffort(S,rep,c.anyOf[i],tl); if(x<best)best=x; } return best; }
  return 1e9;
}
/* expand a (chosen) clause into concrete build/bank targets; anyOf -> min-effort sub */
function clauseTargets(S, rep, c, tl, out){
  if(c.pop!=null){ out.push({kind:'pop', amt:c.pop, turn:S.turn+tl}); return; }
  if(c.ship||c.have){ var sp=c.ship||c.have; out.push({kind:'good', good:sp.good, amt:sp.amt, turn:S.turn+tl}); return; }
  if(c.anyOf){ var best=null,bc=1e9; for(var i=0;i<c.anyOf.length;i++){ var x=clauseEffort(S,rep,c.anyOf[i],tl); if(x<bc){bc=x;best=c.anyOf[i];} } if(best) clauseTargets(S,rep,best,tl,out); }
}
function planGate(S, rep, d, out){
  var tl=d.turn-S.turn, cs=d.clauses, i;
  if(d.mode==='all'){ for(i=0;i<cs.length;i++) clauseTargets(S,rep,cs[i],tl,out); return; }
  if(d.mode==='any'){ var best=null,bc=1e9; for(i=0;i<cs.length;i++){ var x=clauseEffort(S,rep,cs[i],tl); if(x<bc){bc=x;best=cs[i];} } if(best) clauseTargets(S,rep,best,tl,out); return; }
  if(d.mode==='kofn'){ var arr=[]; for(i=0;i<cs.length;i++) arr.push({c:cs[i],e:clauseEffort(S,rep,cs[i],tl)});
    arr.sort(function(a,b){return a.e-b.e;}); for(i=0;i<d.k && i<arr.length;i++) clauseTargets(S,rep,arr[i].c,tl,out); return; }
}
/* the goods/pop the AI is currently committed to banking for, across near gates */
function computeTargets(S, rep){
  var out=[]; var HOR=8;
  for(var i=0;i<S.sc.required.length;i++){ var d=S.sc.required[i]; if(S.done[d.id]) continue;
    var tl=d.turn-S.turn; if(tl<0||tl>HOR) continue; planGate(S,rep,d,out); }
  return out;
}

/* goods that must stay banked for an imminent gate the AI has chosen to satisfy */
function getReserve(S, g){
  if(S.ignoreReserve) return 0;
  if(g!=='metal' && g!=='components') return 0;
  var r=0, ts=S._targets||[];
  for(var i=0;i<ts.length;i++){ var t=ts[i];
    if(t.kind==='good' && t.good===g && (t.turn-S.turn)<=4) r+=t.amt; }
  return r;
}

function canBuild(S, t){
  var T = TYPES[t]; if(!T) return false;
  /* era */
  if(T.era > S.era) return false;
  if(T.unique && get(S.B,t)>0) return false;
  /* tiles */
  if(S.tilesUsed >= S.sc.tilesMax) return false;
  /* deposit */
  if(T.deposit){ if(get(S.depUsed,T.deposit) >= get(S.sc.deposits,T.deposit)) return false; }
  /* cost (protecting any reserve banked for a near gate) */
  var cost = T.cost||{}; var cf = mods(S.B).cf;
  for(var g in cost){ var need = (g==='metal'||g==='components') ? Math.ceil(cost[g]*cf) : cost[g];
    if(get(S.stock,g) - getReserve(S,g) < need) return false; }
  return true;
}

function doBuild(S, t){
  var T = TYPES[t]; var cost=T.cost||{}; var cf=mods(S.B).cf;
  for(var g in cost){ var need=(g==='metal'||g==='components')?Math.ceil(cost[g]*cf):cost[g]; S.stock[g]=get(S.stock,g)-need; }
  S.B[t]=get(S.B,t)+1; S.tilesUsed++;
  if(T.deposit) S.depUsed[T.deposit]=get(S.depUsed,T.deposit)+1;
}

/* recursively find the building to add to grow output of `good` */
function ensureChain(S, rep, good, seen){
  seen = seen || {};
  if(seen[good]) return null; seen[good]=1;
  var t = PRODUCER[good]; if(!t) return null;
  var T = TYPES[t], inp = T.in||{};
  for(var g in inp){
    var prod=get(rep.produced,g), cons=get(rep.consumed,g), stk=get(S.stock,g);
    /* input limiting if little headroom in flow AND little stockpile */
    if((prod - cons) < inp[g] && stk < inp[g]*3){
      var sub = ensureChain(S, rep, g, seen);
      if(sub) return sub;
      return null; /* a limiting input can't be expanded -> building this producer is futile */
    }
  }
  if(canBuild(S,t)) return t;
  return null;
}

function chooseGenerator(S){
  /* prefer geo if a vent free, then solar, then reactor when scaling */
  if(canBuild(S,'geo')) return 'geo';
  if(S.pop>28 && canBuild(S,'reactor')) return 'reactor';
  if(canBuild(S,'fusion') && S.pop>40) return 'fusion';
  if(canBuild(S,'solar')) return 'solar';
  if(canBuild(S,'reactor')) return 'reactor';
  return null;
}

function chooseBuild(S, rep){
  var idledTotal=0; for(var k in rep.idled) idledTotal+=rep.idled[k];

  /* what the AI is committed to banking/building for the near gates (its chosen
     alternatives), plus the population level any near gate demands */
  S._targets = computeTargets(S, rep);
  var popNeed=0, ti;
  for(ti=0;ti<S._targets.length;ti++){ var tt=S._targets[ti]; if(tt.kind==='pop' && tt.amt>popNeed) popNeed=tt.amt; }
  var housingCap = Math.max(POP_CAP, popNeed+6);

  /* Only a genuine life-support FAILURE may raid the gate reserve; preemptive
     buffer-building must still respect goods banked for an imminent directive. */
  S.ignoreReserve = (rep.lsOK === false);

  /* 1. power: keep a comfortable buffer so tech-building isn't constantly
     interrupted by brownouts (a player keeps generation ahead of demand). */
  if(rep.powerLeft < 8 || (!rep.lsOK && rep.why==='power')){
    var gt = chooseGenerator(S); if(gt) return gt;
  }
  /* heat: build a radiator only if actual heat demand exceeds dissipation capacity */
  var heatDemand=0, he=['smelter','glassKiln','siliconRefinery','foundry','assembler','reactor','fusion','compositePlant'];
  for(var h=0;h<he.length;h++){ heatDemand += get(S.B,he[h])*(TYPES[he[h]].heat||0); }
  if(heatDemand > get(S.B,'radiator')*RAD_CAP && canBuild(S,'radiator')) return 'radiator';
  /* STAFFING GATE: population is the labour supply. If there's no spare labour,
     building more staffed plants just idles them; the only productive move is to
     grow the population -> extend housing so pop keeps climbing. */
  var staffTight = rep.staffLeft < 1.0;
  if(staffTight){
    if(rep.lsOK && S.pop >= 0.8*rep.housing && rep.housing < housingCap){
      if(S.pop>=30 && canBuild(S,'arcology')) return 'arcology';
      if(canBuild(S,'habitat')) return 'habitat';
    }
    return null; /* wait for population to catch up to the buildings we have */
  }

  /* 2. life support: keep food / water / oxygen ahead of demand (these gate growth),
     but don't over-build when the stockpile is already deep (avoids LS-plant spam). */
  if(get(rep.produced,'food')  < S.pop*FOOD_PP*1.3 + 4                            && get(S.stock,'food')  < S.pop*FOOD_PP*5){ var f=ensureChain(S,rep,'food');   if(f) return f; }
  if(get(rep.produced,'water') < S.pop*WATER_PP*1.3 + get(rep.consumed,'water')+2 && get(S.stock,'water') < S.pop*WATER_PP*5){ var w=ensureChain(S,rep,'water'); if(w) return w; }
  if(get(rep.produced,'oxygen')< S.pop*O2_PP*1.3 + get(rep.consumed,'oxygen')      && get(S.stock,'oxygen')< S.pop*O2_PP*5){ var o=ensureChain(S,rep,'oxygen'); if(o) return o; }

  /* 4. directive capacity: for the goods the AI has chosen to bank (nearest gate
     first), if banking current output won't reach the target, build more of that
     chain. Reserve is protected in canBuild, so surplus still funds growth. */
  var goodTs=[]; for(ti=0;ti<S._targets.length;ti++){ if(S._targets[ti].kind==='good') goodTs.push(S._targets[ti]); }
  goodTs.sort(function(a,b){ return a.turn-b.turn; });
  for(ti=0; ti<goodTs.length; ti++){
    var g=goodTs[ti]; var tl=g.turn-S.turn; if(tl>7) continue;
    if(projGood(S,rep,g.good,tl) < g.amt){
      S.ignoreReserve=true; var c=ensureChain(S,rep,g.good); S.ignoreReserve=false;
      if(c) return c;
    }
  }

  /* 5. METAL ECONOMY: metal is both the build currency and a directive good, so
     keep a healthy net metal output rather than draining the stockpile. */
  var METAL_TARGET = 24 + S.pop*0.4;
  if(get(rep.produced,'metal') < METAL_TARGET){ var mt=ensureChain(S,rep,'metal'); if(mt) return mt; }

  /* ---- discretionary growth from here: respect the gate reserve ---- */
  S.ignoreReserve = false;

  /* 6. TECH RUSH: invest surplus into the research chain to climb eras and unlock
     the compounding multipliers. A player racing the curve does this constantly. */
  if(S.era<4 && get(rep.produced,"research") < 8 + S.pop*0.2){
    var rr=ensureChain(S,rep,'research'); if(rr) return rr;
  }

  /* 7. housing ahead of pop (capped at the larger of POP_CAP and any near gate's
     population demand, so we leave tiles for late-tier industry but still hit pop gates) */
  if(S.pop >= 0.85*rep.housing && rep.lsOK && rep.housing < housingCap){
    if(S.pop>=30 && canBuild(S,'arcology')) return 'arcology';
    if(canBuild(S,'habitat')) return 'habitat';
  }
  /* 5. research toward next era + multipliers */
  if(S.era<3 && get(S.stock,'research') < ERA3_RESEARCH){ var r=ensureChain(S,rep,'research'); if(r) return r; }
  if(S.era>=3){
    if(canBuild(S,'automationHub') && get(S.B,'automationHub')<3) return 'automationHub';
  }
  if(S.era>=4){
    if(canBuild(S,'aiCore')) return 'aiCore';
    if(canBuild(S,'fabricator') && get(S.B,'fabricator')<3) return 'fabricator';
  }
  /* keep research flowing for era4 */
  if(S.era>=3 && get(S.stock,'research')<ERA4_RESEARCH){ var r2=ensureChain(S,rep,'research'); if(r2) return r2; }
  /* 6. default growth: expand components throughput */
  var grow = ensureChain(S,rep,'components'); if(grow) return grow;
  /* fallback: more housing only if under the cap */
  if(rep.housing < housingCap && canBuild(S,'habitat')) return 'habitat';
  return null;
}

/* ----------------------------------------------------------------------- */
/* Game loop                                                               */
/* ----------------------------------------------------------------------- */

function playGame(verbose, strat){
  var sc = scenario();
  var S = {
    sc: sc, turn:0, era:2,
    B:clone(sc.start.buildings||{}), stock:clone(sc.start.stock), pop:sc.start.pop,
    tilesUsed:0, depUsed:{},
    done:{}, choice:{}, bonusPf:1, era4early:false,
    strat: strat||{}, _targets:[],
    defeat:false, log:[]
  };
  S.bonusPf = 1;
  /* account starting buildings against tiles + deposits */
  for(var bt in S.B){ var T=TYPES[bt]; S.tilesUsed+=S.B[bt];
    if(T.deposit) S.depUsed[T.deposit]=get(S.depUsed,T.deposit)+S.B[bt]; }

  for(S.turn=1; S.turn<=sc.turns; S.turn++){
    /* era unlocks */
    if(get(S.stock,'research')>=ERA3_RESEARCH && S.era<3) S.era=3;
    if((get(S.stock,'research')>=ERA4_RESEARCH || S.era4early) && S.era<4) S.era=4;

    var m = mods(S.B);

    /* CONSTRUCTION: build until nothing useful/affordable */
    var built=[];
    for(var iter=0; iter<16; iter++){
      var rep = resolveTurn(S.stock, S.B, S.pop, mods(S.B), S.bonusPf);
      var pick = chooseBuild(S, rep);
      if(!pick) break;
      if(!canBuild(S,pick)) break;
      doBuild(S, pick); built.push(pick);
    }

    /* PRODUCTION + POP (commit) */
    var R = resolveTurn(S.stock, S.B, S.pop, mods(S.B), S.bonusPf);
    S.stock = R.stock; S.pop = R.pop;

    /* DIRECTIVES — optionals (early bonus) */
    var optMsg=[];
    for(var oi=0; oi<sc.optional.length; oi++){
      var od=sc.optional[oi]; if(S.done[od.id]) continue;
      if(S.turn>od.expire){ S.done[od.id]='EXPIRED'; optMsg.push(od.id+' expired'); continue; }
      if(S.turn<=od.early){
        var ok=false;
        if(od.ship){ /* only ship if we keep a buffer for near required */
          if(od.id==='O1' && get(S.stock,'food') >= 30 + S.pop*FOOD_PP*2) ok=od.ship(S);
        }
        if(od.check){ ok=od.check(S); }
        if(ok){ S.done[od.id]='DONE@'+S.turn; optMsg.push(od.id+' DONE'); }
      }
    }

    /* DIRECTIVES — required (deadline), flexible-fulfillment */
    var reqMsg=[];
    for(var ri=0; ri<sc.required.length; ri++){
      var rd=sc.required[ri]; if(S.done[rd.id]) continue;
      if(S.turn>=rd.turn){
        if(satisfyRequired(S, rd)){ S.done[rd.id]='MET@'+S.turn; reqMsg.push(rd.id+' MET'); }
        else { S.done[rd.id]='FAILED'; S.defeat=true; reqMsg.push(rd.id+' FAILED ('+rd.desc+')'); }
      }
    }

    if(verbose){
      S.log.push(fmtTurn(S, R, built, reqMsg.concat(optMsg)));
    }
    if(S.defeat) break;
  }

  return finish(S);
}

/* ----------------------------------------------------------------------- */
/* Reporting                                                               */
/* ----------------------------------------------------------------------- */

function fmtNum(n){ return (Math.round(n*10)/10); }

function fmtTurn(S, R, built, msgs){
  var s=S.stock;
  var bag=['metal','components','circuits','food','water','research'];
  var inv=[]; for(var i=0;i<bag.length;i++) inv.push(bag[i]+':'+fmtNum(get(s,bag[i])));
  var bc={}; for(var b=0;b<built.length;b++) bc[built[b]]=(bc[built[b]]||0)+1;
  var bl=[]; for(var k in bc) bl.push((bc[k]>1?bc[k]+'x ':'')+k);
  var line = 'T'+pad(S.turn,2)+' era'+S.era+' pop'+pad(Math.round(S.pop),3)
    +'/'+pad(R.housing,3)+' tiles'+pad(S.tilesUsed,2)+'/'+S.sc.tilesMax
    +' pwr'+pad(Math.round(R.powerLeft),3)
    +(R.lsOK?'   ':' !'+R.why)
    +' | '+inv.join(' ')
    +(bl.length?'  build['+bl.join(',')+']':'')
    +(msgs.length?'  <<'+msgs.join('; '):'');
  return line;
}
function pad(n,w){ n=''+n; while(n.length<w) n=' '+n; return n; }

function colonyValuation(S){
  var v=0, g, t;
  /* buildings ~ their metal cost */
  for(t in S.B){ var c=(TYPES[t].cost||{}); v += get(S.B,t)*((c.metal||0)+(c.components||0)*4); }
  /* stock value (weight refined goods) */
  var w={metal:1,components:4,circuits:6,composites:6,modules:8,food:1,research:2,robotics:6};
  for(g in S.stock){ v += get(S.stock,g)*(w[g]||0.3); }
  /* population */
  v += S.pop*8;
  return Math.round(v);
}

function finish(S){
  var allReqMet = true, finalTurn=S.turn>S.sc.turns?S.sc.turns:S.turn;
  for(var i=0;i<S.sc.required.length;i++){ var d=S.sc.required[i];
    if(S.done[d.id]!=='MET@'+d.turn && (''+S.done[d.id]).indexOf('MET')!==0) allReqMet=false; }
  if(S.defeat) allReqMet=false;

  var valuation = colonyValuation(S);
  var dirPrestige = 0;
  for(var k in S.done){ if((''+S.done[k]).indexOf('MET')===0) dirPrestige+=80;
                        if((''+S.done[k]).indexOf('DONE')===0) dirPrestige+=40; }
  var prestige = valuation + dirPrestige;

  var result;
  if(S.defeat || !allReqMet) result='DEFEAT';
  else if(prestige >= S.sc.majorThreshold) result='MAJOR VICTORY';
  else result='MINOR VICTORY';

  return {
    result: result, prestige: prestige, valuation: valuation, dirPrestige: dirPrestige,
    pop: Math.round(S.pop), era: S.era, turn: S.turn, tiles: S.tilesUsed,
    buildings: S.B, stock: S.stock, done: S.done, choice: S.choice, log: S.log,
    threshold: S.sc.majorThreshold
  };
}

/* strategy presets: weights bias which alternative the AI targets (lower = prefer) */
var STRATS = {
  balanced: {},
  tech:     { components:0.55, circuits:0.5, modules:0.6, research:0.6 },
  brute:    { metal:0.5, food:0.7, pop:0.7, components:1.6, circuits:1.4 },
  pop:      { pop:0.4, food:0.5, components:1.4 }
};

/* ----------------------------------------------------------------------- */
/* main                                                                    */
/* ----------------------------------------------------------------------- */

function choiceLine(res){
  var ids=['R2','R3','R4','R5'], out=[];
  for(var i=0;i<ids.length;i++){ if(res.choice[ids[i]]) out.push(ids[i]+':'+res.choice[ids[i]]); }
  return out.join('  ');
}

function printResult(res, verbose){
  if(verbose){
    console.log('=== COMPOUND — Mare Frigoris playthrough ===\n');
    for(var i=0;i<res.log.length;i++) console.log(res.log[i]);
    console.log('');
  }
  console.log('--- RESULT ---');
  console.log('Outcome   : '+res.result);
  console.log('Prestige  : '+res.prestige+'  (valuation '+res.valuation+' + directives '+res.dirPrestige+')   [major >= '+res.threshold+']');
  console.log('Reached   : turn '+res.turn+', pop '+res.pop+', era '+res.era+', tiles '+res.tiles);
  var bl=[]; for(var b in res.buildings) bl.push(res.buildings[b]+'x '+b);
  console.log('Buildings : '+bl.join(', '));
  var dl=[]; for(var d in res.done) dl.push(d+'='+res.done[d]);
  console.log('Directives: '+dl.join('  '));
  console.log('Gate paths: '+choiceLine(res));
  var sk=['metal','components','circuits','composites','modules','research','food','water','robotics'];
  var sv=[]; for(var s=0;s<sk.length;s++) sv.push(sk[s]+':'+fmtNum(get(res.stock,sk[s])));
  console.log('Stock     : '+sv.join(' '));
}

function main(){
  var args = process.argv.slice(2);
  var quiet = args.indexOf('quiet')>=0;

  /* compare mode: run every strategy and show how the chosen gate-paths diverge */
  if(args.indexOf('compare')>=0){
    console.log('=== COMPOUND — strategy comparison (flexible directives) ===\n');
    var names=['balanced','tech','brute','pop'];
    for(var n=0;n<names.length;n++){
      var r=playGame(false, STRATS[names[n]]);
      var key=['R2','R3','R4','R5'].map(function(id){return r.choice[id]||'-';}).join(' | ');
      console.log(pad(names[n],9)+' '+pad(r.result,13)
        +' prestige '+pad(r.prestige,5)+'  pop '+pad(r.pop,3)+'  era '+r.era
        +'\n          gate-paths: '+key+'\n');
    }
    return;
  }

  var stratName = 'balanced';
  for(var a=0;a<args.length;a++){ if(STRATS[args[a]]) stratName=args[a]; }
  var res = playGame(!quiet, STRATS[stratName]);
  console.log('(strategy: '+stratName+')');
  printResult(res, !quiet);
}

main();
