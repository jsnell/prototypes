/*
 * COMPOUND — v0.3 FLOW prototype (ES5, node).
 *
 * Tests the v0.3 pivot (see DESIGN.md): a pure per-turn FLOW economy with
 * NO stockpiles (not even power), buildings that are FREE but delivered at a
 * limited rate PER TIER, workers as a flow, and DIRECTIVES as a dynamic tech
 * tree whose rewards are capability (unlock buildings, +build-rate, prestige).
 *
 * Space is still ABSTRACT here (tile budget + deposit slots). The adjacency
 * layer — the actual core of v0.3 — needs the real hex grid and is the NEXT
 * prototype. This one is to reason about the economic + progression skeleton:
 *   - does "no stockpile" kill the free-resource problem?
 *   - does per-tier build-rate stay binding, with the bottleneck migrating up?
 *   - does the directive tree produce a compounding curve and real choices?
 *
 * Flows are solved to a fixed point each turn (handles circular deps like
 * reactor<->water, and the housing->workers->everything loop).
 *
 * Run:  node flow.js          (turn log + summary)
 *       node flow.js quiet
 */

'use strict';

function clone(o){ var r={}; for(var k in o) r[k]=o[k]; return r; }
function get(o,k){ return o[k]||0; }

/* ----------------------------------------------------------------------- */
/* Buildings as flow nodes. in/out are per-unit per-turn RATES.            */
/*   bt = build-tier (which Earth delivery rate it draws from)             */
/*   pseudo-goods: power, workers, cool (cooling capacity)                 */
/* ----------------------------------------------------------------------- */

var TYPES = {
  /* power / infra / housing (bt1) */
  solar:        { bt:1, out:{power:10} },
  reactor:      { bt:2, in:{water:2, workers:1, cool:3}, out:{power:44} },
  radiator:     { bt:1, out:{cool:8} },
  habitat:      { bt:1, in:{food:1.2, water:1.2, oxygen:0.6, power:1.2}, out:{workers:6} },

  /* extraction (bt1, deposit-bound) */
  oreMine:      { bt:1, in:{power:3, workers:1}, out:{ore:12},      deposit:'ore' },
  iceExtractor: { bt:1, in:{power:3, workers:1}, out:{ice:12},      deposit:'ice' },
  silicaQuarry: { bt:1, in:{power:3, workers:1}, out:{silica:12},   deposit:'silica' },
  volatilesWell:{ bt:2, in:{power:4, workers:1}, out:{volatiles:10},deposit:'volatiles' },
  rareMine:     { bt:2, in:{power:6, workers:2}, out:{rare:5},      deposit:'rare' },

  /* tier-1 refining (bt1) */
  smelter:      { bt:1, in:{ore:8, power:6, workers:1, cool:2}, out:{metal:9} },
  waterPlant:   { bt:1, in:{ice:8, power:4, workers:1},        out:{water:10} },
  electrolysis: { bt:1, in:{water:6, power:6, workers:1},      out:{oxygen:4, hydrogen:2} },
  glassKiln:    { bt:1, in:{silica:6, power:5, workers:1, cool:2}, out:{glass:5} },
  siliconRefinery:{bt:1,in:{silica:6, power:6, workers:1, cool:2}, out:{silicon:4} },

  /* tier-2 intermediates (bt2) */
  greenhouse:   { bt:1, in:{water:4, volatiles:2, power:3, workers:1}, out:{food:8} },
  foundry:      { bt:2, in:{metal:5, rare:2, oxygen:2, power:6, workers:1, cool:3}, out:{alloy:4} },
  polymerPlant: { bt:2, in:{volatiles:5, hydrogen:2, power:4, workers:1}, out:{polymer:4} },
  electronicsFab:{bt:2, in:{silicon:3, rare:1, glass:2, power:5, workers:2}, out:{electronics:4} },

  /* tier-3 advanced (bt3, locked until a directive unlocks them) */
  assembler:    { bt:3, in:{alloy:2, polymer:2, electronics:2, power:5, workers:2, cool:2}, out:{components:3}, locked:true },
  circuitFab:   { bt:3, in:{electronics:2, glass:2, rare:1, power:6, workers:2}, out:{circuits:4}, locked:true },
  lab:          { bt:3, in:{components:2, power:6, workers:2}, out:{research:3}, locked:true }
};

var PRODUCER = {
  power:'solar', workers:'habitat', cool:'radiator',
  ore:'oreMine', ice:'iceExtractor', silica:'silicaQuarry', volatiles:'volatilesWell', rare:'rareMine',
  metal:'smelter', water:'waterPlant', oxygen:'electrolysis', hydrogen:'electrolysis',
  glass:'glassKiln', silicon:'siliconRefinery',
  alloy:'foundry', polymer:'polymerPlant', electronics:'electronicsFab', food:'greenhouse',
  components:'assembler', circuits:'circuitFab', research:'lab'
};

/* every good that appears anywhere (for the solver) */
var GOODS = (function(){
  var s={}; for(var t in TYPES){ var T=TYPES[t];
    for(var g in (T.in||{})) s[g]=1; for(var g2 in (T.out||{})) s[g2]=1; }
  var a=[]; for(var k in s) a.push(k); return a;
})();

/* ----------------------------------------------------------------------- */
/* Flow solver: fixed point. Pure function of building counts.             */
/*   returns prod/cons/surplus per good, and per-type run fraction.        */
/* ----------------------------------------------------------------------- */

function solveFlows(B){
  var frac={}; for(var t in B){ if(B[t]>0) frac[t]=1; }
  var prod, cons, g, it, T;
  for(it=0; it<60; it++){
    prod={}; cons={};
    for(t in B){ var c=B[t]*get(frac,t); if(c<=0) continue; T=TYPES[t];
      for(g in (T.out||{})) prod[g]=get(prod,g)+T.out[g]*c;
      for(g in (T.in||{}))  cons[g]=get(cons,g)+T.in[g]*c;
    }
    var ratio={};
    for(var gi=0; gi<GOODS.length; gi++){ g=GOODS[gi];
      var p=get(prod,g), d=get(cons,g); ratio[g] = (d<=1e-9) ? 1 : Math.min(1, p/d);
    }
    var maxd=0;
    for(t in B){ if(B[t]<=0) continue; T=TYPES[t]; var r=1;
      for(g in (T.in||{})) r=Math.min(r, ratio[g]==null?0:ratio[g]);
      var nf=0.5*get(frac,t)+0.5*r; maxd=Math.max(maxd, Math.abs(nf-get(frac,t))); frac[t]=nf;
    }
    if(maxd<0.0005) break;
  }
  /* final pass */
  prod={}; cons={};
  for(t in B){ var c2=B[t]*get(frac,t); if(c2<=0) continue; T=TYPES[t];
    for(g in (T.out||{})) prod[g]=get(prod,g)+T.out[g]*c2;
    for(g in (T.in||{}))  cons[g]=get(cons,g)+T.in[g]*c2;
  }
  var surplus={}; for(var gj=0; gj<GOODS.length; gj++){ g=GOODS[gj]; surplus[g]=get(prod,g)-get(cons,g); }
  return { prod:prod, cons:cons, surplus:surplus, frac:frac };
}

/* ----------------------------------------------------------------------- */
/* Scenario: directive tree (the progression). Rewards = capability.       */
/*   draw: good consumed from SURPLUS at `rate`/turn; need = rate*dur total */
/*   reward: { unlock:[], buildRate:{bt:+n}, deposit:{}, prestige:n,        */
/*            reveal:[ids] }                                                */
/* ----------------------------------------------------------------------- */

function scenario(){
  return {
    turns: 24,
    tilesMax: 64,
    deposits: { ore:5, ice:6, silica:5, volatiles:3, rare:2 },
    buildRate: { 1:3, 2:1, 3:0 },            // per-tier deliveries from Earth (raised by directives)
    start: { solar:4, habitat:3, iceExtractor:2, waterPlant:2, electrolysis:1,
             oreMine:1, smelter:1, greenhouse:2, volatilesWell:1 },
    majorThreshold: 600,
    directives: [
      { id:'D1', name:'Provision',  good:'food',       rate:14, dur:2, deadline:6,  req:[], must:true,
        reward:{ buildRate:{2:1}, prestige:40 }, reveal:['D2'] },
      { id:'D2', name:'Refinery',   good:'metal',      rate:18, dur:3, deadline:10, req:['D1'], must:true,
        reward:{ unlock:['assembler'], buildRate:{3:1}, prestige:60 }, reveal:['D3','D4'] },
      { id:'D3', name:'Electronics',good:'components',  rate:8,  dur:3, deadline:15, req:['D2'], must:true,
        reward:{ unlock:['circuitFab','lab'], buildRate:{3:1}, prestige:90 }, reveal:['D5','D6'] },
      { id:'D4', name:'Waterworks', good:'water',       rate:24, dur:3, deadline:15, req:['D2'], must:false,
        reward:{ buildRate:{1:2}, deposit:{rare:1}, prestige:50 }, reveal:[] },
      { id:'D5', name:'Hi-tech',    good:'circuits',    rate:9,  dur:4, deadline:21, req:['D3'], must:true,
        reward:{ buildRate:{3:1}, prestige:140 }, reveal:['D7'] },
      { id:'D6', name:'Foodbelt',   good:'food',        rate:30, dur:3, deadline:20, req:['D3'], must:false,
        reward:{ buildRate:{2:2}, prestige:70 }, reveal:[] },
      { id:'D7', name:'Datacore',   good:'research',    rate:9,  dur:3, deadline:24, req:['D5'], must:true,
        reward:{ prestige:220 }, reveal:[] }
    ]
  };
}

/* ----------------------------------------------------------------------- */
/* The heuristic AI                                                        */
/* ----------------------------------------------------------------------- */

function unlocked(S, t){ return !TYPES[t].locked || S.unlocked[t]; }

/* soft = everything except the tile cap (a full map can be freed via makeRoom) */
function canPlaceSoft(S, t){
  var T=TYPES[t];
  if(!unlocked(S,t)) return false;
  if(get(S.placed, T.bt) >= get(S.buildRate, T.bt)) return false;   // per-tier delivery cap
  if(T.deposit && get(S.depUsed,T.deposit) >= get(S.sc.deposits,T.deposit)) return false;
  return true;
}
function canPlace(S, t){
  if(!canPlaceSoft(S,t)) return false;
  if(S.tilesUsed >= S.sc.tilesMax) return false;
  return true;
}
function place(S, t){ var T=TYPES[t]; S.B[t]=get(S.B,t)+1; S.tilesUsed++;
  S.placed[T.bt]=get(S.placed,T.bt)+1; if(T.deposit) S.depUsed[T.deposit]=get(S.depUsed,T.deposit)+1; }

/* find a building to place to raise surplus of `good` by ~one unit of capacity */
function ensureFlow(S, sol, good, want, seen){
  seen=seen||{}; if(seen[good]) return null; seen[good]=1;
  var t=PRODUCER[good]; if(!t) return null; var T=TYPES[t];
  /* if locked, we can't build it now (a directive must unlock it) */
  if(!unlocked(S,t)) return null;
  /* check each input has enough surplus headroom for one more producer; if an input
     is short, try to expand it. Try ALL short inputs before giving up. */
  var blocked=false;
  for(var g in (T.in||{})){
    var need=T.in[g];
    if(get(sol.surplus,g) < need*1.0){
      var sub=ensureFlow(S, sol, g, need, seen); if(sub) return sub;
      blocked=true; /* this input is short and can't be expanded right now */
    }
  }
  if(blocked) return null;
  if(canPlaceSoft(S,t)) return t;
  return null;
}

/* free a tile by razing the most over-provisioned building (its output has the most
   slack), so a full map can be reworked for late-tier industry. Returns true if it did. */
function makeRoom(S, sol){
  var best=null, bestScore=-1;
  for(var t in S.B){ if(S.B[t]<=0) continue; var T=TYPES[t];
    var g=null; for(var k in (T.out||{})){ g=k; break; } if(!g) continue;
    var out=T.out[g];
    if(get(sol.surplus,g) - out >= -0.001){          /* can lose one unit and stay non-negative */
      var score=get(sol.surplus,g);
      if(score>bestScore){ bestScore=score; best=t; }
    }
  }
  if(!best) return false;
  var T2=TYPES[best]; S.B[best]--; S.tilesUsed--;
  if(T2.deposit) S.depUsed[T2.deposit]=get(S.depUsed,T2.deposit)-1;
  return true;
}

/* like ensureFlow but for a specific building type (e.g. prefer a dense reactor) */
function ensureType(S, sol, t, seen){
  seen=seen||{}; var T=TYPES[t]; if(!unlocked(S,t)) return null;
  var blocked=false;
  for(var g in (T.in||{})){ var need=T.in[g];
    if(get(sol.surplus,g) < need){ var sub=ensureFlow(S,sol,g,need,seen); if(sub) return sub; blocked=true; } }
  if(blocked) return null;
  if(canPlaceSoft(S,t)) return t;
  return null;
}

/* directives the AI is actively feeding / pursuing right now */
function activeDirectives(S){
  var out=[];
  for(var i=0;i<S.sc.directives.length;i++){ var d=S.sc.directives[i];
    if(S.done[d.id]||S.failed[d.id]) continue;
    if(!S.revealed[d.id]) continue;
    if(S.turn>d.deadline) continue;
    out.push(d);
  }
  return out;
}

function chooseBuild(S, sol){
  /* 1. workers / life support: keep a labour BUFFER (not just break-even) so we can
     staff the next plant we place. This is the master growth driver. */
  if(get(sol.surplus,'workers') < 4){ var w=ensureFlow(S,sol,'workers',1); if(w) return w; }
  /* 2. power: keep a surplus buffer. Prefer the DENSE reactor (44 power/tile) over
     solar (10/tile) so power generation doesn't eat the whole map; fall back to solar. */
  if(get(sol.surplus,'power') < 6){
    var pr=ensureType(S,sol,'reactor'); if(pr) return pr;
    var p=ensureFlow(S,sol,'power',1); if(p) return p;
  }
  /* 3. cooling */
  if(get(sol.surplus,'cool') < 1){ if(canPlace(S,'radiator')) return 'radiator'; }
  /* 4. directive goods: build surplus to feed each pursued directive (nearest deadline first) */
  var act=activeDirectives(S).slice().sort(function(a,b){ if(a.must!==b.must) return a.must?-1:1; return a.deadline-b.deadline; });
  for(var i=0;i<act.length;i++){ var d=act[i];
    if(get(sol.surplus,d.good) < d.rate*1.1){ var c=ensureFlow(S,sol,d.good,d.rate); if(c) return c; }
  }
  /* 5. fallback growth: keep building labour/power so capacity keeps rising */
  if(get(sol.surplus,'workers') < 8){ var h=ensureFlow(S,sol,'workers',1); if(h) return h; }
  return null;
}

/* ----------------------------------------------------------------------- */
/* Game loop                                                               */
/* ----------------------------------------------------------------------- */

function playGame(verbose){
  var sc=scenario();
  var S={ sc:sc, turn:0, B:clone(sc.start), buildRate:clone(sc.buildRate),
          unlocked:{}, tilesUsed:0, depUsed:{}, placed:{},
          done:{}, failed:{}, revealed:{}, progress:{}, prestige:0, log:[] };
  /* account start */
  for(var bt in S.B){ var T=TYPES[bt]; S.tilesUsed+=S.B[bt];
    if(T.deposit) S.depUsed[T.deposit]=get(S.depUsed,T.deposit)+S.B[bt]; }
  /* reveal directives with no prereqs */
  for(var i=0;i<sc.directives.length;i++){ if(sc.directives[i].req.length===0) S.revealed[sc.directives[i].id]=1; }

  for(S.turn=1; S.turn<=sc.turns; S.turn++){
    S.placed={};
    /* PLACEMENT: build until nothing useful or all per-tier rates spent */
    var built=[];
    var budget=0; for(var k in S.buildRate) budget+=S.buildRate[k];
    for(var iter=0; iter<budget+2; iter++){
      var sol=solveFlows(S.B);
      var pick=chooseBuild(S, sol);
      if(!pick) break;
      if(!canPlace(S,pick)){
        /* if the only problem is a full map, raze an over-provisioned tile and retry */
        var T=TYPES[pick];
        if(S.tilesUsed>=S.sc.tilesMax && get(S.placed,T.bt)<get(S.buildRate,T.bt) && makeRoom(S,sol)){
          if(!canPlace(S,pick)) break;
        } else break;
      }
      place(S,pick); built.push(pick);
    }
    /* RESOLVE flows for the turn */
    var R=solveFlows(S.B);
    var avail=clone(R.surplus);   /* surplus available to directives this turn */

    /* DIRECTIVES: feed active ones from surplus (nearest deadline first) */
    var msg=[];
    var act=activeDirectives(S).slice().sort(function(a,b){ if(a.must!==b.must) return a.must?-1:1; return a.deadline-b.deadline; });
    for(i=0;i<act.length;i++){ var d=act[i];
      var give=Math.min(d.rate, Math.max(0, get(avail,d.good)));
      avail[d.good]=get(avail,d.good)-give;
      S.progress[d.id]=get(S.progress,d.id)+give;
      if(S.progress[d.id] >= d.rate*d.dur - 1e-6){
        S.done[d.id]='MET@'+S.turn; msg.push(d.id+'('+d.name+') DONE');
        applyReward(S, d);
      }
    }
    /* deadlines */
    for(i=0;i<sc.directives.length;i++){ var dd=sc.directives[i];
      if(S.done[dd.id]||S.failed[dd.id]) continue;
      if(S.turn>=dd.deadline && (get(S.progress,dd.id) < dd.rate*dd.dur - 1e-6)){
        if(S.revealed[dd.id] || dd.req.length===0){
          S.failed[dd.id]='FAIL@'+S.turn;
          if(dd.must){ msg.push(dd.id+' FAILED (required)'); }
        }
      }
    }

    if(verbose) S.log.push(fmtTurn(S, R, built, msg));
    /* defeat if a required directive failed */
    var dead=false; for(i=0;i<sc.directives.length;i++){ var d3=sc.directives[i]; if(d3.must && S.failed[d3.id]) dead=true; }
    if(dead){ S.defeat=true; break; }
  }
  return finish(S);
}

function applyReward(S, d){
  var r=d.reward||{};
  if(r.unlock){ for(var i=0;i<r.unlock.length;i++) S.unlocked[r.unlock[i]]=1; }
  if(r.buildRate){ for(var bt in r.buildRate) S.buildRate[bt]=get(S.buildRate,bt)+r.buildRate[bt]; }
  if(r.deposit){ for(var dp in r.deposit) S.sc.deposits[dp]=get(S.sc.deposits,dp)+r.deposit[dp]; }
  if(r.prestige) S.prestige+=r.prestige;
  if(d.reveal){ for(var j=0;j<d.reveal.length;j++) S.revealed[d.reveal[j]]=1; }
}

/* ----------------------------------------------------------------------- */
/* Reporting                                                               */
/* ----------------------------------------------------------------------- */

function n1(x){ return Math.round(x*10)/10; }
function pad(s,w){ s=''+s; while(s.length<w) s=' '+s; return s; }

function fmtTurn(S, R, built, msg){
  var br='br['+S.buildRate[1]+'/'+S.buildRate[2]+'/'+S.buildRate[3]+']';
  var bag=['power','workers','metal','components','circuits','research','food'];
  var fl=[]; for(var i=0;i<bag.length;i++) fl.push(bag[i]+':'+n1(get(R.surplus,bag[i])));
  var prog=[]; var act=activeDirectives(S);
  for(i=0;i<act.length;i++){ var d=act[i]; prog.push(d.id+' '+n1(get(S.progress,d.id))+'/'+(d.rate*d.dur)); }
  var bc={}; for(i=0;i<built.length;i++) bc[built[i]]=(bc[built[i]]||0)+1;
  var bl=[]; for(var t in bc) bl.push((bc[t]>1?bc[t]+'x ':'')+t);
  return 'T'+pad(S.turn,2)+' '+br+' tiles'+pad(S.tilesUsed,2)+'/'+S.sc.tilesMax
    +' P'+pad(S.prestige,3)+' | surplus '+fl.join(' ')
    +(prog.length?'  ['+prog.join(' ')+']':'')
    +(bl.length?'  +'+bl.join(','):'')
    +(msg.length?'  <<'+msg.join('; '):'');
}

function finish(S){
  var allMust=true;
  for(var i=0;i<S.sc.directives.length;i++){ var d=S.sc.directives[i];
    if(d.must && (''+S.done[d.id]).indexOf('MET')!==0) allMust=false; }
  var result = (S.defeat||!allMust) ? 'DEFEAT' : (S.prestige>=S.sc.majorThreshold?'MAJOR VICTORY':'MINOR VICTORY');
  return { result:result, prestige:S.prestige, turn:S.turn, tiles:S.tilesUsed,
           buildRate:S.buildRate, B:S.B, done:S.done, failed:S.failed, log:S.log,
           threshold:S.sc.majorThreshold };
}

function main(){
  var quiet = process.argv.indexOf('quiet')>=0;
  var res = playGame(!quiet);
  if(!quiet){ console.log('=== COMPOUND v0.3 — flow prototype ===\n');
    for(var i=0;i<res.log.length;i++) console.log(res.log[i]); console.log(''); }
  console.log('--- RESULT ---');
  console.log('Outcome   : '+res.result+'   prestige '+res.prestige+' (major >= '+res.threshold+')');
  console.log('Reached   : turn '+res.turn+', tiles '+res.tiles+', build-rate 1/2/3 = '+res.buildRate[1]+'/'+res.buildRate[2]+'/'+res.buildRate[3]);
  var dl=[]; for(var d in res.done) dl.push(d+'='+res.done[d]); for(var f in res.failed) dl.push(f+'='+res.failed[f]);
  console.log('Directives: '+dl.join('  '));
  var bl=[]; for(var b in res.B) bl.push(res.B[b]+'x '+b);
  console.log('Buildings : '+bl.join(', '));
}

main();
