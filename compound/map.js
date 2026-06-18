/*
 * COMPOUND — v0.3 MAP prototype (ES5, node).
 *
 * The real spatial layer. Buildings are placed on specific hex tiles and their
 * effective output depends on LOCAL ADJACENCY:
 *   - Heat: a heat-emitter only runs to the extent adjacent Radiators cool it
 *     (no adjacent cooling -> it produces nothing). Cooling is shared among the
 *     emitters touching a radiator.
 *   - Radiation: Reactors irradiate their 6 neighbours; adjacent Habitats /
 *     Greenhouses are crippled unless the tile is a shielded lava tube.
 *   - Sunline: Solar output scales with how sunward (low-q) the tile is.
 *   - Co-location: a building gets an efficiency bonus per distinct input whose
 *     producer sits on an adjacent tile (short pipes) — so supply chains want to
 *     physically cluster... but clustering fights heat/radiation/space.
 *   - Lab clusters: Labs boost adjacent Labs and Habitats.
 *
 * Everything else is the v0.3 flow model from flow.js: pure per-turn flows (no
 * stockpiles), workers-as-flow, free buildings delivered at a per-tier rate,
 * directives-as-tech-tree, demolition to rework a full map. Flows solve to a
 * fixed point (handles reactor<->water and housing->workers loops).
 *
 * Run:  node map.js          (turn log + final ASCII map)
 *       node map.js quiet
 */

'use strict';

function clone(o){ var r={}; for(var k in o) r[k]=o[k]; return r; }
function get(o,k){ return o[k]||0; }

/* ----------------------------------------------------------------------- */
/* Grid (axial parallelogram, hex adjacency)                               */
/* ----------------------------------------------------------------------- */

var W=9, H=6;
var DIRS=[[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

function buildMap(){
  var tiles=[], idOf={};
  for(var r=0;r<H;r++) for(var q=0;q<W;q++){ var id=tiles.length;
    tiles.push({id:id,q:q,r:r,dep:null,lava:false,wreck:false}); idOf[q+','+r]=id; }
  function set(q,r,f){ var id=idOf[q+','+r]; if(id!=null) f(tiles[id]); }
  function dep(list, kind){ for(var i=0;i<list.length;i++) set(list[i][0],list[i][1],function(t){t.dep=kind;}); }
  dep([[3,1],[4,3],[3,4],[5,2],[4,0]], 'ore');
  dep([[8,0],[8,2],[8,4],[7,5],[7,1],[8,5],[7,3]], 'ice');     /* far / sun-poor side */
  dep([[2,2],[2,4],[6,1],[6,4],[1,5]], 'silica');
  dep([[6,0],[1,3]], 'rare');                            /* scarce, far apart */
  dep([[5,5],[2,0],[6,5]], 'volatiles');
  set(1,1,function(t){t.lava=true;}); set(1,4,function(t){t.lava=true;});
  set(4,2,function(t){t.wreck=true;}); set(3,3,function(t){t.wreck=true;});
  /* precompute neighbours */
  for(var i=0;i<tiles.length;i++){ var t=tiles[i]; t.nb=[];
    for(var d=0;d<DIRS.length;d++){ var nid=idOf[(t.q+DIRS[d][0])+','+(t.r+DIRS[d][1])]; if(nid!=null) t.nb.push(nid); } }
  return {tiles:tiles, idOf:idOf};
}
function sunFactor(q){ return 1 - 0.6*q/(W-1); }     /* q0 = 1.0 (sunward) .. q8 = 0.4 */

/* ----------------------------------------------------------------------- */
/* Buildings (flow nodes + adjacency tags). cool is LOCAL now, not a flow.  */
/* ----------------------------------------------------------------------- */

var TYPES = {
  solar:        { bt:1, out:{power:10}, solarScaled:true },
  reactor:      { bt:2, in:{water:2, workers:1}, out:{power:44}, heat:3, radiation:true },
  radiator:     { bt:1, coolOut:12 },
  habitat:      { bt:1, in:{food:1.2, water:1.2, oxygen:0.6, power:1.2}, out:{workers:6}, radSensitive:true, lavaBonus:true },

  oreMine:      { bt:1, in:{power:3, workers:1}, out:{ore:12},      deposit:'ore' },
  iceExtractor: { bt:1, in:{power:3, workers:1}, out:{ice:12},      deposit:'ice' },
  silicaQuarry: { bt:1, in:{power:3, workers:1}, out:{silica:12},   deposit:'silica' },
  volatilesWell:{ bt:2, in:{power:4, workers:1}, out:{volatiles:10},deposit:'volatiles' },
  rareMine:     { bt:2, in:{power:6, workers:2}, out:{rare:5},      deposit:'rare' },

  smelter:      { bt:1, in:{ore:8, power:6, workers:1}, out:{metal:9}, heat:2 },
  waterPlant:   { bt:1, in:{ice:8, power:4, workers:1}, out:{water:10} },
  electrolysis: { bt:1, in:{water:6, power:6, workers:1}, out:{oxygen:4, hydrogen:2} },
  glassKiln:    { bt:1, in:{silica:6, power:5, workers:1}, out:{glass:5}, heat:2 },
  siliconRefinery:{bt:1,in:{silica:6, power:6, workers:1}, out:{silicon:4}, heat:2 },

  greenhouse:   { bt:1, in:{water:4, volatiles:2, power:3, workers:1}, out:{food:8}, radSensitive:true },
  foundry:      { bt:2, in:{metal:5, rare:1, oxygen:2, power:6, workers:1}, out:{alloy:4}, heat:3 },
  polymerPlant: { bt:2, in:{volatiles:5, hydrogen:2, power:4, workers:1}, out:{polymer:4} },
  electronicsFab:{bt:2, in:{silicon:3, rare:1, glass:2, power:5, workers:2}, out:{electronics:4} },

  assembler:    { bt:3, in:{alloy:2, polymer:2, electronics:2, power:5, workers:2}, out:{components:3}, heat:2, locked:true },
  circuitFab:   { bt:3, in:{electronics:2, glass:2, rare:1, power:6, workers:2}, out:{circuits:4}, locked:true },
  lab:          { bt:3, in:{components:2, power:6, workers:2}, out:{research:3}, locked:true, labSyn:true }
};

var PRODUCER = {
  power:'solar', workers:'habitat',
  ore:'oreMine', ice:'iceExtractor', silica:'silicaQuarry', volatiles:'volatilesWell', rare:'rareMine',
  metal:'smelter', water:'waterPlant', oxygen:'electrolysis', hydrogen:'electrolysis',
  glass:'glassKiln', silicon:'siliconRefinery',
  alloy:'foundry', polymer:'polymerPlant', electronics:'electronicsFab', food:'greenhouse',
  components:'assembler', circuits:'circuitFab', research:'lab'
};
var ABBR = { solar:'So',reactor:'Rx',radiator:'Ra',habitat:'Hb',oreMine:'Or',iceExtractor:'Ic',
  silicaQuarry:'Si',volatilesWell:'Vo',rareMine:'Re',smelter:'Sm',waterPlant:'Wa',electrolysis:'El',
  glassKiln:'Gl',siliconRefinery:'Sl',greenhouse:'Gh',foundry:'Fo',polymerPlant:'Po',
  electronicsFab:'En',assembler:'As',circuitFab:'Ci',lab:'Lb' };

var GOODS=(function(){ var s={}; for(var t in TYPES){ var T=TYPES[t];
  for(var g in (T.in||{})) s[g]=1; for(var g2 in (T.out||{})) s[g2]=1; }
  var a=[]; for(var k in s) a.push(k); return a; })();
var COLO=0.12;

/* ----------------------------------------------------------------------- */
/* Adjacency -> effective per-building in/out (before flow throttling)      */
/* ----------------------------------------------------------------------- */

function neighborsProduce(S, tileId){
  var t=S.map.tiles[tileId], set={};
  for(var i=0;i<t.nb.length;i++){ var bi=S.occ[t.nb[i]]; if(bi==null||bi<0) continue;
    var T=TYPES[S.buildings[bi].type]; for(var g in (T.out||{})) set[g]=1; }
  return set;
}
function neighborHasRadiation(S, tileId){
  var t=S.map.tiles[tileId];
  for(var i=0;i<t.nb.length;i++){ var bi=S.occ[t.nb[i]]; if(bi==null||bi<0) continue;
    if(TYPES[S.buildings[bi].type].radiation) return true; }
  return false;
}
function countAdj(S, tileId, pred){
  var t=S.map.tiles[tileId], n=0;
  for(var i=0;i<t.nb.length;i++){ var bi=S.occ[t.nb[i]]; if(bi==null||bi<0) continue;
    if(pred(S.buildings[bi].type, S.map.tiles[t.nb[i]])) n++; }
  return n;
}

/* multiplier on OUTPUT from adjacency (co-location, solar, radiation, lava, lab) */
function adjMult(S, type, tileId){
  var T=TYPES[type], tile=S.map.tiles[tileId], m=1;
  /* co-location: distinct real inputs whose producer is adjacent */
  if(T.in){ var np=neighborsProduce(S,tileId), matched=0;
    for(var g in T.in){ if(g==='power'||g==='workers') continue; if(np[g]) matched++; }
    if(matched>3) matched=3; m*= (1+COLO*matched);
  }
  if(T.labSyn){ m*= 1 + 0.25*countAdj(S,tileId,function(ty){return ty==='lab';})
                       + 0.10*countAdj(S,tileId,function(ty){return ty==='habitat';}); }
  if(T.solarScaled) m*= sunFactor(tile.q);
  if(T.lavaBonus && tile.lava) m*= 1.4;
  if(T.radSensitive && !tile.lava && neighborHasRadiation(S,tileId)) m*= 0.4;
  return m;
}

/* heat: emitter runs only to the extent adjacent radiators cool it (shared) */
function heatRatio(S, type, tileId){
  var T=TYPES[type]; if(!T.heat) return 1;
  var tile=S.map.tiles[tileId], avail=0;
  for(var i=0;i<tile.nb.length;i++){ var bi=S.occ[tile.nb[i]]; if(bi==null||bi<0) continue;
    var rt=TYPES[S.buildings[bi].type]; if(!rt.coolOut) continue;
    /* how many emitters does that radiator serve? share its capacity */
    var em=countAdj(S, tile.nb[i], function(ty){return TYPES[ty].heat>0;}); if(em<1) em=1;
    avail += rt.coolOut/em;
  }
  /* +1 base passive cooling (space radiates a little): a lone emitter still runs
     partially, but an adjacent radiator is a big efficiency boost. */
  return Math.min(1, (1+avail)/T.heat);
}

/* per-building effective base rates (adjacency applied; flow throttle comes later) */
function effRates(S){
  var arr=[];
  for(var i=0;i<S.buildings.length;i++){ var b=S.buildings[i]; if(!b) continue;
    var T=TYPES[b.type]; var m=adjMult(S,b.type,b.tile)*heatRatio(S,b.type,b.tile);
    var oin={}, oout={};
    for(var g in (T.in||{})) oin[g]=T.in[g]*heatRatio(S,b.type,b.tile);   /* inputs scale w/ run, not co-loc */
    for(var g2 in (T.out||{})) oout[g2]=T.out[g2]*m;
    arr.push({in:oin, out:oout});
  }
  return arr;
}

/* ----------------------------------------------------------------------- */
/* Flow solver: fixed point over building instances                        */
/* ----------------------------------------------------------------------- */

function solveFlows(S){
  var eff=effRates(S), n=eff.length, frac=[], i, g;
  for(i=0;i<n;i++) frac[i]=1;
  var prod, cons;
  for(var it=0; it<60; it++){
    prod={}; cons={};
    for(i=0;i<n;i++){ var f=frac[i]; if(f<=0) continue;
      for(g in eff[i].out) prod[g]=get(prod,g)+eff[i].out[g]*f;
      for(g in eff[i].in)  cons[g]=get(cons,g)+eff[i].in[g]*f; }
    var ratio={}; for(var gi=0;gi<GOODS.length;gi++){ g=GOODS[gi];
      var p=get(prod,g), d=get(cons,g); ratio[g]=(d<=1e-9)?1:Math.min(1,p/d); }
    var maxd=0;
    for(i=0;i<n;i++){ var r=1; for(g in eff[i].in) r=Math.min(r, ratio[g]==null?0:ratio[g]);
      var nf=0.5*frac[i]+0.5*r; maxd=Math.max(maxd,Math.abs(nf-frac[i])); frac[i]=nf; }
    if(maxd<0.0005) break;
  }
  prod={}; cons={};
  for(i=0;i<n;i++){ var f2=frac[i]; if(f2<=0) continue;
    for(g in eff[i].out) prod[g]=get(prod,g)+eff[i].out[g]*f2;
    for(g in eff[i].in)  cons[g]=get(cons,g)+eff[i].in[g]*f2; }
  var surplus={}; for(var gj=0;gj<GOODS.length;gj++){ g=GOODS[gj]; surplus[g]=get(prod,g)-get(cons,g); }
  return {prod:prod, cons:cons, surplus:surplus};
}

/* ----------------------------------------------------------------------- */
/* Scenario + directive tree (same shape as flow.js)                       */
/* ----------------------------------------------------------------------- */

function scenario(){
  return {
    turns:24,
    buildRate:{1:4,2:1,3:0},
    start:[ ['solar',0],['solar',1],['habitat',null],['iceExtractor','ice'],['waterPlant',null],
            ['electrolysis',null],['oreMine','ore'],['smelter',null],['greenhouse',null],['volatilesWell','volatiles'] ],
    majorThreshold:600,
    directives:[
      { id:'D1',name:'Provision',  good:'food',      rate:14,dur:2,deadline:6, req:[],must:true,
        reward:{buildRate:{2:1},prestige:40},reveal:['D2'] },
      { id:'D2',name:'Refinery',   good:'metal',     rate:18,dur:3,deadline:10,req:['D1'],must:true,
        reward:{unlock:['assembler'],buildRate:{3:1},prestige:60},reveal:['D3','D4'] },
      { id:'D3',name:'Electronics',good:'components', rate:8, dur:3,deadline:15,req:['D2'],must:true,
        reward:{unlock:['circuitFab','lab'],buildRate:{3:1},prestige:90},reveal:['D5','D6'] },
      { id:'D4',name:'Waterworks', good:'water',      rate:24,dur:3,deadline:15,req:['D2'],must:false,
        reward:{buildRate:{1:2},prestige:50},reveal:[] },
      { id:'D5',name:'Hi-tech',    good:'circuits',   rate:9, dur:4,deadline:21,req:['D3'],must:true,
        reward:{buildRate:{3:1},prestige:140},reveal:['D7'] },
      { id:'D6',name:'Foodbelt',   good:'food',       rate:30,dur:3,deadline:20,req:['D3'],must:false,
        reward:{buildRate:{2:2},prestige:70},reveal:[] },
      { id:'D7',name:'Datacore',   good:'research',   rate:9, dur:3,deadline:24,req:['D5'],must:true,
        reward:{prestige:220},reveal:[] }
    ]
  };
}

/* ----------------------------------------------------------------------- */
/* Placement: find the best tile for a type (and the demolition fallback)  */
/* ----------------------------------------------------------------------- */

function unlocked(S,t){ return !TYPES[t].locked || S.unlocked[t]; }
function tileFree(S,id){ var t=S.map.tiles[id]; return !t.wreck && (S.occ[id]==null||S.occ[id]<0); }
function eligible(S,type,id){ var T=TYPES[type], t=S.map.tiles[id];
  if(!tileFree(S,id)) return false; if(T.deposit && t.dep!==T.deposit) return false; return true; }

/* score a tile for a type: higher = better adjacency outcome */
function tileScore(S, type, id){
  var T=TYPES[type], t=S.map.tiles[id], s=0;
  if(!T.deposit && t.dep) s -= 6;                  /* don't squander a deposit tile on a non-extractor */
  if(!T.lavaBonus && t.lava) s -= 3;              /* leave lava tubes for shielded housing */
  s += (adjMult(S,type,id)-1)*10;                 /* co-loc / solar / lava / radiation baked in */
  if(T.heat){                                     /* emitters: want adjacent radiators (or room for them) */
    var rad=countAdj(S,id,function(ty){return TYPES[ty].coolOut>0;});
    var room=0,i; for(i=0;i<t.nb.length;i++) if(tileFree(S,t.nb[i])) room++;
    s += rad*3 + room*0.4;
  }
  if(T.radiation){                                /* reactors: keep away from rad-sensitive neighbours */
    s -= countAdj(S,id,function(ty){return TYPES[ty].radSensitive;})*4;
  }
  if(type==='radiator'){                          /* radiators: sit next to UNDER-cooled emitters */
    var served=0,i2; for(i2=0;i2<t.nb.length;i2++){ var bi=S.occ[t.nb[i2]];
      if(bi!=null&&bi>=0){ var bt=S.buildings[bi]; if(TYPES[bt.type].heat>0 && heatRatio(S,bt.type,bt.tile)<0.99) served++; } }
    s += served*5;
  }
  return s;
}
function bestTile(S, type){
  var best=-1, bestS=-1e9;
  for(var id=0; id<S.map.tiles.length; id++){ if(!eligible(S,type,id)) continue;
    var sc=tileScore(S,type,id); if(sc>bestS){ bestS=sc; best=id; } }
  return best;
}
function placeAt(S, type, id){ var idx=S.buildings.length; S.buildings.push({type:type,tile:id});
  S.occ[id]=idx; var T=TYPES[type]; S.placed[T.bt]=get(S.placed,T.bt)+1; S.tilesUsed++; }

/* free a tile safely: first any radiator cooling nothing, else the most
   over-provisioned producer that is NOT the last of its kind and leaves a buffer. */
function makeRoom(S, sol){
  var i, b, T, g;
  /* producer counts per good */
  var nprod={}; for(i=0;i<S.buildings.length;i++){ b=S.buildings[i]; if(!b) continue;
    for(g in (TYPES[b.type].out||{})) nprod[g]=(nprod[g]||0)+1; }
  /* 1. a radiator adjacent to no heat-emitter is pure waste */
  for(i=0;i<S.buildings.length;i++){ b=S.buildings[i]; if(!b||b.type!=='radiator') continue;
    if(countAdj(S,b.tile,function(ty){return TYPES[ty].heat>0;})===0){ raze(S,i); return true; } }
  /* 2. most over-provisioned producer (keep a buffer, never the last of a good) */
  var best=-1, bestScore=0.5;
  for(i=0;i<S.buildings.length;i++){ b=S.buildings[i]; if(!b) continue; T=TYPES[b.type];
    g=null; for(var k in (T.out||{})){ g=k; break; } if(!g) continue;
    if((nprod[g]||0)<=1) continue;                          /* don't remove the last producer */
    var margin=get(sol.surplus,g) - get(T.out,g);
    if(margin < 0.5*get(T.out,g)) continue;                 /* would tighten this good too much */
    if(margin>bestScore){ bestScore=margin; best=i; }
  }
  if(best<0) return false; raze(S,best); return true;
}
function raze(S, i){ var b=S.buildings[i]; S.occ[b.tile]=-1; S.buildings[i]=null; S.tilesUsed--; }

/* ----------------------------------------------------------------------- */
/* AI: which TYPE to build next (placement chosen separately)              */
/* ----------------------------------------------------------------------- */

function counts(S){ var c={}; for(var i=0;i<S.buildings.length;i++){ var b=S.buildings[i]; if(b) c[b.type]=(c[b.type]||0)+1; } return c; }
function canSoft(S,type){ var T=TYPES[type];
  if(!unlocked(S,type)) return false;
  if(get(S.placed,T.bt)>=get(S.buildRate,T.bt)) return false;
  if(T.deposit){ /* any free matching deposit tile? */
    var ok=false; for(var id=0;id<S.map.tiles.length;id++){ if(eligible(S,type,id)){ok=true;break;} } if(!ok) return false; }
  return true;
}
function ensureType(S, sol, good, seen){
  seen=seen||{}; if(seen[good]) return null; seen[good]=1;
  var t=PRODUCER[good]; if(!t||!unlocked(S,t)) return null; var T=TYPES[t];
  var blocked=false;
  for(var g in (T.in||{})){ var need=T.in[g];
    if(get(sol.surplus,g)<need){
      /* worker-limited? a Habitat needs no staff, so it's the way to relieve labour
         (breaks the housing->water->workers->housing bootstrap cycle). */
      if(g==='workers'){ if(canSoft(S,'habitat')) return 'habitat'; blocked=true; continue; }
      var sub=ensureType(S,sol,g,seen); if(sub) return sub; blocked=true; } }
  if(blocked) return null;
  if(canSoft(S,t)) return t;
  return null;
}
/* is there a meaningfully under-cooled emitter (ratio<0.7) with a free adjacent
   tile where a radiator would actually help? (avoids endless useless radiators) */
function radiatorWouldHelp(S){
  for(var i=0;i<S.buildings.length;i++){ var b=S.buildings[i]; if(!b) continue;
    var T=TYPES[b.type]; if(!(T.heat>0) || heatRatio(S,b.type,b.tile)>=0.7) continue;
    var nb=S.map.tiles[b.tile].nb; for(var j=0;j<nb.length;j++) if(tileFree(S,nb[j])) return true; }
  return false;
}
function activeDirectives(S){ var out=[];
  for(var i=0;i<S.sc.directives.length;i++){ var d=S.sc.directives[i];
    if(S.done[d.id]||S.failed[d.id]||!S.revealed[d.id]||S.turn>d.deadline) continue; out.push(d); }
  return out; }

/* ---- smarter planning: unblock a scarce, contended input by reallocation ---- */

/* are all tiles of the deposit feeding `raw` occupied? (can't build another extractor) */
function depositMaxed(S, raw){
  var pt=PRODUCER[raw], dep=pt?TYPES[pt].deposit:null; if(!dep) return false;
  for(var id=0;id<S.map.tiles.length;id++){ var t=S.map.tiles[id]; if(t.dep===dep && tileFree(S,id)) return false; }
  return true;
}
/* the set of goods on the production chain of `good` (so we never raze them) */
function chainGoods(good, set){ set=set||{}; if(set[good]) return set; set[good]=1;
  var t=PRODUCER[good]; if(!t) return set; for(var g in (TYPES[t].in||{})){ if(g==='power'||g==='workers') continue; chainGoods(g,set); } return set; }
/* walk the chain of `good`; return a scarce deposit-raw that is maxed AND contended */
function blockingScarce(S, sol, good, seen){
  seen=seen||{}; if(seen[good]) return null; seen[good]=1;
  var t=PRODUCER[good]; if(!t||!unlocked(S,t)) return null;
  for(var g in (TYPES[t].in||{})){ if(g==='power'||g==='workers') continue;
    if(get(sol.surplus,g) < TYPES[t].in[g]){
      var pg=PRODUCER[g];
      if(pg && TYPES[pg].deposit && depositMaxed(S,g)) return g;
      var deeper=blockingScarce(S,sol,g,seen); if(deeper) return deeper;
    } }
  return null;
}
/* raze a NON-critical consumer of `raw` (most output slack) to free it for `criticalGood` */
function razeCompetitor(S, sol, raw, criticalGood){
  var crit=chainGoods(criticalGood), best=-1, bestSlack=-1e9;
  for(var i=0;i<S.buildings.length;i++){ var b=S.buildings[i]; if(!b) continue; var T=TYPES[b.type];
    if(!T.in || T.in[raw]==null) continue;            /* must consume the scarce raw */
    if(b.type===PRODUCER[raw]) continue;              /* never the extractor itself */
    var g0=null; for(var k in (T.out||{})){ g0=k; break; } if(!g0||crit[g0]) continue; /* not on the critical chain */
    var slack=get(sol.surplus,g0);
    if(slack>bestSlack){ bestSlack=slack; best=i; }
  }
  if(best<0) return false; raze(S,best); return true;
}
/* reached when ensureType(good) is blocked: walk the chain and free a contended input
   (raw OR intermediate) by razing a non-critical consumer of it, then retry. */
function reallocateFor(S, sol, good, seen){
  seen=seen||{}; if(seen[good]) return null; seen[good]=1;
  var t=PRODUCER[good]; if(!t||!unlocked(S,t)) return null;
  for(var g in (TYPES[t].in||{})){ if(g==='power'||g==='workers') continue;
    if(get(sol.surplus,g) < TYPES[t].in[g]){
      if(razeCompetitor(S,sol,g,good)) return ensureType(S,sol,good);  /* freed g -> retry */
      var deeper=reallocateFor(S,sol,g,seen); if(deeper) return deeper;
    } }
  return null;
}

function chooseType(S, sol){
  if(get(sol.surplus,'workers')<4){ var w=ensureType(S,sol,'workers'); if(w) return w; }
  if(get(sol.surplus,'power')<6){ var pr=ensureType(S,sol,'power'); if(pr){ if(canSoft(S,'reactor')&&pr==='solar'){ var rr=ensureReactor(S,sol); if(rr) return rr; } return pr; } }

  var act=activeDirectives(S), reqs=[], opts=[], i;
  for(i=0;i<act.length;i++){ (act[i].must?reqs:opts).push(act[i]); }
  reqs.sort(function(a,b){return a.deadline-b.deadline;});
  opts.sort(function(a,b){return a.deadline-b.deadline;});

  /* REQUIRED first; if a required good is blocked, try to reallocate a scarce input to it */
  var behind=false;
  for(i=0;i<reqs.length;i++){ var d=reqs[i];
    if(get(sol.surplus,d.good) < d.rate*1.1){
      var c=ensureType(S,sol,d.good); if(c) return c;
      var ra=reallocateFor(S,sol,d.good); if(ra) return ra;
      behind=true;                                    /* blocked & can't unblock yet */
    } }

  /* cooling maintenance */
  if(radiatorWouldHelp(S) && canSoft(S,'radiator')) return 'radiator';

  /* only chase OPTIONAL directives when the required spine is on track */
  if(!behind){ for(i=0;i<opts.length;i++){ var o=opts[i];
    if(get(sol.surplus,o.good) < o.rate*1.1){ var oc=ensureType(S,sol,o.good); if(oc) return oc; } } }

  if(get(sol.surplus,'workers')<8){ var h=ensureType(S,sol,'workers'); if(h) return h; }
  return null;
}
/* prefer a dense reactor for power if its inputs can be supplied */
function ensureReactor(S, sol){
  var T=TYPES.reactor;
  for(var g in T.in){ if(get(sol.surplus,g)<T.in[g]){ var sub=ensureType(S,sol,g); if(sub) return sub; return null; } }
  if(canSoft(S,'reactor')) return 'reactor';
  return null;
}

/* ----------------------------------------------------------------------- */
/* Game loop                                                               */
/* ----------------------------------------------------------------------- */

function playGame(verbose){
  var sc=scenario();
  var S={ sc:sc, map:buildMap(), turn:0, buildings:[], occ:{}, buildRate:clone(sc.buildRate),
          unlocked:{}, placed:{}, done:{}, failed:{}, revealed:{}, progress:{}, prestige:0, tilesUsed:0, log:[] };
  /* place starting buildings (greedy onto best tiles) */
  for(var i=0;i<sc.start.length;i++){ var spec=sc.start[i], type=spec[0];
    var id=bestTile(S,type); if(id>=0) placeAt(S,type,id); }
  S.placed={};
  for(i=0;i<sc.directives.length;i++) if(sc.directives[i].req.length===0) S.revealed[sc.directives[i].id]=1;
  var totalTiles=0; for(i=0;i<S.map.tiles.length;i++) if(!S.map.tiles[i].wreck) totalTiles++;
  S.tilesMax=totalTiles;

  for(S.turn=1;S.turn<=sc.turns;S.turn++){
    S.placed={};
    var built=[]; var budget=0; for(var k in S.buildRate) budget+=S.buildRate[k];
    for(var iter=0; iter<budget+3; iter++){
      var sol=solveFlows(S);
      var pick=chooseType(S,sol); if(!pick) break;
      var id=bestTile(S,pick);
      if(id<0){ /* full map: raze an over-provisioned tile, retry */
        var T=TYPES[pick];
        if(S.tilesUsed>=S.tilesMax && get(S.placed,T.bt)<get(S.buildRate,T.bt) && makeRoom(S,sol)){ id=bestTile(S,pick); }
      }
      if(id<0) break;
      placeAt(S,pick,id); built.push(pick);
    }
    var R=solveFlows(S);
    var avail=clone(R.surplus), msg=[];
    var act=activeDirectives(S).slice().sort(function(a,b){ if(a.must!==b.must)return a.must?-1:1; return a.deadline-b.deadline; });
    for(i=0;i<act.length;i++){ var d=act[i];
      var give=Math.min(d.rate, Math.max(0,get(avail,d.good))); avail[d.good]=get(avail,d.good)-give;
      S.progress[d.id]=get(S.progress,d.id)+give;
      if(S.progress[d.id]>=d.rate*d.dur-1e-6){ S.done[d.id]='MET@'+S.turn; msg.push(d.id+'('+d.name+') DONE'); applyReward(S,d); } }
    for(i=0;i<sc.directives.length;i++){ var dd=sc.directives[i];
      if(S.done[dd.id]||S.failed[dd.id]||!S.revealed[dd.id]) continue;
      if(S.turn>=dd.deadline && get(S.progress,dd.id)<dd.rate*dd.dur-1e-6){ S.failed[dd.id]='FAIL@'+S.turn; if(dd.must) msg.push(dd.id+' FAILED (required)'); } }
    if(verbose) S.log.push(fmtTurn(S,R,built,msg));
    var dead=false; for(i=0;i<sc.directives.length;i++){ if(sc.directives[i].must && S.failed[sc.directives[i].id]) dead=true; }
    if(dead){ S.defeat=true; break; }
  }
  return finish(S);
}
function applyReward(S,d){ var r=d.reward||{};
  if(r.unlock) for(var i=0;i<r.unlock.length;i++) S.unlocked[r.unlock[i]]=1;
  if(r.buildRate) for(var bt in r.buildRate) S.buildRate[bt]=get(S.buildRate,bt)+r.buildRate[bt];
  if(r.prestige) S.prestige+=r.prestige;
  if(d.reveal) for(var j=0;j<d.reveal.length;j++) S.revealed[d.reveal[j]]=1;
}

/* ----------------------------------------------------------------------- */
/* Reporting                                                               */
/* ----------------------------------------------------------------------- */

function n1(x){ return Math.round(x*10)/10; }
function pad(s,w){ s=''+s; while(s.length<w) s=' '+s; return s; }
function fmtTurn(S,R,built,msg){
  var br='br['+S.buildRate[1]+'/'+S.buildRate[2]+'/'+S.buildRate[3]+']';
  var bag=['power','workers','metal','components','circuits','research','food'];
  var fl=[]; for(var i=0;i<bag.length;i++) fl.push(bag[i]+':'+n1(get(R.surplus,bag[i])));
  var prog=[],act=activeDirectives(S); for(i=0;i<act.length;i++) prog.push(act[i].id+' '+n1(get(S.progress,act[i].id))+'/'+(act[i].rate*act[i].dur));
  var bc={}; for(i=0;i<built.length;i++) bc[built[i]]=(bc[built[i]]||0)+1; var bl=[]; for(var t in bc) bl.push((bc[t]>1?bc[t]+'x ':'')+t);
  return 'T'+pad(S.turn,2)+' '+br+' tiles'+pad(S.tilesUsed,2)+'/'+S.tilesMax+' P'+pad(S.prestige,3)
    +' | '+fl.join(' ')+(prog.length?'  ['+prog.join(' ')+']':'')+(bl.length?'  +'+bl.join(','):'')+(msg.length?'  <<'+msg.join('; '):'');
}
function renderMap(S){
  var out=[]; for(var r=0;r<H;r++){ var row=new Array(r).join(' ');  /* offset for hex look */
    for(var q=0;q<W;q++){ var id=S.map.idOf[q+','+r], t=S.map.tiles[id], bi=S.occ[id], cell;
      if(bi!=null&&bi>=0) cell=ABBR[S.buildings[bi].type];
      else if(t.wreck) cell='##'; else if(t.lava) cell='~~'; else if(t.dep) cell=t.dep.substr(0,1).toUpperCase()+'.';
      else cell='..';
      row+=cell+' '; }
    out.push(row); }
  return out.join('\n');
}
function finish(S){
  var allMust=true; for(var i=0;i<S.sc.directives.length;i++){ var d=S.sc.directives[i];
    if(d.must && (''+S.done[d.id]).indexOf('MET')!==0) allMust=false; }
  var result=(S.defeat||!allMust)?'DEFEAT':(S.prestige>=S.sc.majorThreshold?'MAJOR VICTORY':'MINOR VICTORY');
  return {result:result, prestige:S.prestige, turn:S.turn, tilesUsed:S.tilesUsed, tilesMax:S.tilesMax,
          buildRate:S.buildRate, done:S.done, failed:S.failed, log:S.log, S:S, threshold:S.sc.majorThreshold};
}
function main(){
  var quiet=process.argv.indexOf('quiet')>=0;
  var res=playGame(!quiet);
  if(!quiet){ console.log('=== COMPOUND v0.3 — MAP prototype ===\n');
    for(var i=0;i<res.log.length;i++) console.log(res.log[i]); console.log(''); }
  console.log('--- RESULT ---');
  console.log('Outcome   : '+res.result+'   prestige '+res.prestige+' (major >= '+res.threshold+')');
  console.log('Reached   : turn '+res.turn+', tiles '+res.tilesUsed+'/'+res.tilesMax+', build-rate 1/2/3 = '+res.buildRate[1]+'/'+res.buildRate[2]+'/'+res.buildRate[3]);
  var dl=[]; for(var d in res.done) dl.push(d+'='+res.done[d]); for(var f in res.failed) dl.push(f+'='+res.failed[f]);
  console.log('Directives: '+dl.join('  '));
  if(!quiet){ console.log('\nFinal map ('+ 'So=solar Rx=reactor Ra=radiator Hb=habitat Or/Ic/Si/Vo/Re=mines  Sm/Wa/El/Gl/Sl/Gh/Fo/Po/En=refiners As/Ci/Lb=hi-tech; ~~=lava ##=wreck X.=deposit):\n');
    console.log(renderMap(res.S)); }
}
main();
