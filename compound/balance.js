"use strict";
/* ============================================================================
   COMPOUND — headless balance harness: a deliberately NAIVE heuristic player
   that always plays for 800 (all 7 directives). Each turn it just:
     0. keeps the colony alive (no life-support good in deficit)
     1. satisfies the currently-open directives
     2. keeps housing ahead of the next immigration batch
     3. builds toward the next upcoming directive
     4. tops up power/food/water headroom for the next batch
   Steps 2-4 keep a build only if it doesn't drop a directive already being
   satisfied. No demolition, no magic constants. To raise a good it lists every
   action that could (another producer, a radiator to un-throttle an overheated
   producer, a reclaimer to cut water demand, or an upstream drill to un-starve
   a producer's material input) and picks the one with the largest marginal
   output — so cooling and input-drilling are ordinary candidates, not special
   cases, and running overheated stays fine until a radiator simply pays off.
   Run: node balance.js     (DBG=1 logs wasted build slots)
   ========================================================================== */
var E=require("./engine.js").COMPOUND;
var TYPES=E.TYPES,get=E.get;

function slotsLeft(S){var o={};for(var bt=1;bt<=3;bt++)o[bt]=get(S.buildRate,bt)-get(S.placed,bt);return o;}
function hasSlot(S,type){return slotsLeft(S)[TYPES[type].bt]>0;}

/* producers per good, including branched alternates (scrapper for metal/rare, algae for food) */
var ALT={power:["solar","reactor"],food:["greenhouse","algaeVat"],metal:["smelter","scrapper"],rare:["rareMine","scrapper"]};
function producersFor(good){return ALT[good]||(E.PRODUCER[good]?[E.PRODUCER[good]]:[]);}

/* placement: tile with the best effective multiplier (clustering/sun/lava), keeping reactors off
   housing and housing off radiation, and not needlessly squatting a deposit or lava tube. */
function bestTileByMult(S,type){
  var T=TYPES[type],best=-1,bm=-1e9,bsec=-1;
  for(var id=0;id<S.map.tiles.length;id++){
    if(!E.eligible(S,type,id))continue;
    var t=S.map.tiles[id],m=E.adjMult(S,type,id)*E.heatRatio(S,type,id);
    if(T.cap)m=t.lava?1.4:(E.radiated(S,id)?0.4:1);
    if(T.radiation)m-=0.6*E.countAdj(S,id,function(x){return TYPES[x].cat==="hab";});
    if(T.cap)m-=0.6*E.countAdj(S,id,function(x){return TYPES[x].radiation;});
    if(!T.deposit&&!T.requiresWreck&&t.dep)m-=0.25;
    if(!T.lavaBonus&&t.lava)m-=0.4;
    /* tiebreaker only: a habitat born next to a reclaimer is serviced (recycles ~0.6 water/turn).
       Break ties of (near-)equal capacity toward that — never trade capacity for it. */
    var sec=T.cap&&E.countAdj(S,id,function(x){return !!TYPES[x].recycles;})>0?1:0;
    if(m>bm+1e-9||(Math.abs(m-bm)<=1e-9&&sec>bsec)){bm=m;best=id;bsec=sec;}
  }
  return best;
}
/* marginal extra `good` from placing `type` at `id` (tentative place, re-solve, roll back) */
function gain(S,type,id,good,base){var snap=snapshot(S);E.placeAt(S,type,id);var d=get(E.solveFlows(S).surplus,good)-base;restore(S,snap);return d;}
/* empty tiles next to a heat-throttled building that makes `good` — a radiator there raises `good` */
function coolTilesFor(S,good){var set={};for(var i=0;i<S.buildings.length;i++){var b=S.buildings[i];if(!b)continue;var T=TYPES[b.type];
  if(!T.heat||!(T.out&&good in T.out))continue;if(E.heatRatio(S,b.type,b.tile)>=0.999)continue;
  var t=S.map.tiles[b.tile];for(var k=0;k<t.nb.length;k++)if(E.eligible(S,"radiator",t.nb[k]))set[t.nb[k]]=1;}
  return Object.keys(set).map(Number);}
/* empty tiles next to a habitat — a reclaimer there raises water surplus by cutting demand */
function reclaimTilesFor(S){var set={};for(var i=0;i<S.buildings.length;i++){var b=S.buildings[i];if(!b||TYPES[b.type].cat!=="hab")continue;
  var t=S.map.tiles[b.tile];for(var k=0;k<t.nb.length;k++)if(E.eligible(S,"reclaimer",t.nb[k]))set[t.nb[k]]=1;}
  return Object.keys(set).map(Number);}
/* What to build to raise `good`, as {type,id}. Builds one candidate list of EVERY action that
   could raise it, then picks the one with the largest marginal Δgood (ties -> least-contested tier):
     - each direct producer of `good`, on its best tile;
     - a radiator next to a heat-throttled producer of `good` (un-throttles it);
     - a reclaimer next to a habitat (cuts water demand), when good==="water";
     - upstream: whatever would raise a binding MATERIAL input of a producer of `good` (e.g. an ice
       extractor when the water plants are ice-starved) — found by recursing on that input.
   Drilling an input is therefore not a special fallback: it competes by marginal output like the
   rest, so the AI un-starves the chain only when that actually yields more `good` than building
   another (starved) producer or a saturated reclaimer. */
function chooseForGood(S,good,R,depth){
  if(depth>10)return null;
  var base=get(R.surplus,good),sl=slotsLeft(S),cands=[];
  producersFor(good).forEach(function(t){if(E.unlocked(S,t)&&hasSlot(S,t)){var id=bestTileByMult(S,t);if(id>=0)cands.push({type:t,id:id});}});
  if(hasSlot(S,"radiator"))coolTilesFor(S,good).forEach(function(id){cands.push({type:"radiator",id:id});});
  if(good==="water"&&hasSlot(S,"reclaimer"))reclaimTilesFor(S).forEach(function(id){cands.push({type:"reclaimer",id:id});});
  producersFor(good).filter(function(t){return E.unlocked(S,t);}).forEach(function(t){var T=TYPES[t];
    if(T.in)for(var g in T.in){if(g!=="workers"&&get(R.surplus,g)<T.in[g]-1e-6){var sub=chooseForGood(S,g,R,depth+1);if(sub)cands.push(sub);}}});
  var best=null,bestD=1e-6;
  for(var i=0;i<cands.length;i++){var c=cands[i],d=gain(S,c.type,c.id,good,base);
    if(d>bestD+1e-9||(best&&d>bestD-1e-9&&sl[TYPES[c.type].bt]>sl[TYPES[best.type].bt])){bestD=d;best=c;}}
  if(best)return best;
  /* cold start: no build yields positive marginal yet (e.g. a fab with no glass AND no glass with no
     fab) — bootstrap by drilling the first binding material input regardless of (zero) marginal. */
  var ps=producersFor(good).filter(function(t){return E.unlocked(S,t);});
  for(var p=0;p<ps.length;p++){var T=TYPES[ps[p]];if(T.in)for(var g in T.in){if(g!=="workers"&&get(R.surplus,g)<T.in[g]-1e-6){var sub=chooseForGood(S,g,R,depth+1);if(sub)return sub;}}}
  return null;
}

/* the AI always pursues EVERY directive — required and optional — i.e. it always plays for 800.
   (There used to be a required-only / single-optional mode here; removed so results are unambiguous.) */
function include(d){return true;}
/* urgency = latest turn you can still start sustaining and finish by the deadline */
function startBy(S,d){return d.deadline-(d.dur-get(S.progress,d.id))+1;}
function byUrg(S){return function(a,b){return startBy(S,a)-startBy(S,b);};}

function snapshot(S){return {b:S.buildings.slice(),o:Object.assign({},S.occ),p:Object.assign({},S.placed),u:S.tilesUsed};}
function restore(S,s){S.buildings=s.b;S.occ=s.o;S.placed=s.p;S.tilesUsed=s.u;}
function satisfiedSet(S,R){var ids={};E.deliverable(S).filter(include).forEach(function(d){if(get(R.surplus,d.good)>=d.rate-0.05)ids[d.id]=d;});return {ids:ids,life:R.lifeMet};}
function violates(before,R2){
  if(before.life&&!R2.lifeMet)return true;
  for(var id in before.ids){if(get(R2.surplus,before.ids[id].good)<before.ids[id].rate-0.05)return true;}
  return false;
}
var BLOG=[];
function logBuild(S,phase,goal,type){BLOG.push({t:S.turn,phase:phase,goal:goal,type:type});}
/* place {type,id} now (for satisfying a current goal — no verify, it IS the goal) */
function place(S,c,phase,goal){if(!c||!hasSlot(S,c.type)||c.id<0)return false;E.placeAt(S,c.type,c.id);logBuild(S,phase,goal,c.type);return true;}
/* speculative place: keep it only if it doesn't drop a directive we're already satisfying */
function placeAhead(S,c,why){if(!c||!hasSlot(S,c.type)||c.id<0)return false;
  var before=satisfiedSet(S,E.solveFlows(S)),snap=snapshot(S);E.placeAt(S,c.type,c.id);
  if(violates(before,E.solveFlows(S))){restore(S,snap);return false;}
  logBuild(S,"ahead",why,c.type);return true;}

var LS=["food","water","power"];
function below(S,R,d){return get(R.surplus,d.good)<d.rate-0.05;}
function buildStep(S){
  var R=E.solveFlows(S),opn=E.deliverable(S);
  /* 0. survival: any life-support good in deficit, most negative first (build it now) */
  var neg=LS.filter(function(g){return get(R.surplus,g)<-1e-6;}).sort(function(a,b){return get(R.surplus,a)-get(R.surplus,b);});
  for(var i=0;i<neg.length;i++){if(place(S,chooseForGood(S,neg[i],R,0),"survival",neg[i]))return true;}
  /* 1. REQUIRED directives that are open and below rate — top priority, built unconditionally */
  var reqOpen=opn.filter(function(d){return d.must&&below(S,R,d);}).sort(byUrg(S));
  for(var j=0;j<reqOpen.length;j++){if(place(S,chooseForGood(S,reqOpen[j].good,R,0),"req",reqOpen[j].id))return true;}
  /* 2. housing ahead of the next immigration batch */
  if(R.cap-S.pop<S.immig&&hasSlot(S,"habitat")&&placeAhead(S,{type:"habitat",id:bestTileByMult(S,"habitat")},"housing"))return true;
  /* 3. pre-build the next REQUIRED directive (not open yet) */
  var reqUp=S.sc.directives.filter(function(d){return d.must&&!S.done[d.id]&&!S.failed[d.id]&&opn.indexOf(d)<0;}).sort(byUrg(S));
  for(var k=0;k<reqUp.length;k++){if(placeAhead(S,chooseForGood(S,reqUp[k].good,R,0),reqUp[k].id))return true;}
  /* 4. OPTIONALS (open or upcoming), only via the no-compromise verify so they never delay required */
  var opt=S.sc.directives.filter(function(d){return !d.must&&include(d)&&!S.done[d.id]&&!S.failed[d.id]&&below(S,R,d);}).sort(byUrg(S));
  for(var o=0;o<opt.length;o++){if(placeAhead(S,chooseForGood(S,opt[o].good,R,0),opt[o].id))return true;}
  /* 5. top up power/food/water headroom for the next batch (lowest surplus first) */
  var low=LS.slice().sort(function(a,b){return get(R.surplus,a)-get(R.surplus,b);});
  for(var m=0;m<low.length;m++){if(get(R.surplus,low[m])<S.immig*E.LIFE[low[m]]&&placeAhead(S,chooseForGood(S,low[m],R,0),"balance:"+low[m]))return true;}
  return false;
}
function greedyTurn(S){
  for(var guard=0;guard<120;guard++){if(!buildStep(S))break;}
  if(process.env.DBG){var sl=slotsLeft(S);if(sl[1]+sl[2]+sl[3]>0)console.error("  >>> T"+S.turn+" WASTED "+JSON.stringify(sl));}
  return E.processEndTurn(S);
}

function run(verbose){
  var S=E.newState();var log=[];
  while(!S.over){
    var t=S.turn;
    var res=greedyTurn(S);
    if(verbose){
      var R=E.solveFlows(S);
      var sg=["power","workers","food","water","metal","alloy","electronics","components","research"]
        .map(function(g){return g.slice(0,4)+(Math.round(get(R.surplus,g)*10)/10);}).join(" ");
      var prog=S.sc.directives.map(function(d){return d.id+":"+get(S.progress,d.id)+"/"+d.dur+(S.done[d.id]?"✓":(S.failed[d.id]?"✗":""));}).join(" ");
      var decs=BLOG.filter(function(x){return x.t===t;}).map(function(x){return x.type+"["+x.goal+"]";}).join(" ");
      var ndone=S.sc.directives.filter(function(d){return S.done[d.id];}).length;
      log.push("T"+t+" b="+S.tilesUsed+" pop="+Math.round(S.pop)+"/"+Math.round(R.cap)+"(+"+S.immig+") done="+ndone+"/"+S.sc.directives.length+" ["+sg+"]\n   builds: "+(decs||"-")+"\n   "+prog+(res.msgs.length?"  | "+res.msgs.join(", "):""));
    }
  }
  return {S:S,log:log};
}

var EXPORT={greedyTurn:greedyTurn,run:run,chooseForGood:chooseForGood,buildStep:buildStep,bestTileByMult:bestTileByMult};
if(typeof module!=="undefined"&&module.exports)module.exports=EXPORT;
if(typeof require!=="undefined"&&require.main===module){
  var v=run(true);
  console.log(v.log.join("\n"));
  console.log("\nRESULT: "+v.S.result);
  console.log("buildRate end:",JSON.stringify(v.S.buildRate),"tiles used:",v.S.tilesUsed);
  var req=v.S.sc.directives.filter(function(d){return d.must;});
  var won=req.filter(function(d){return v.S.done[d.id];}).length;
  var opt=v.S.sc.directives.filter(function(d){return !d.must;});
  var optWon=opt.filter(function(d){return v.S.done[d.id];}).length;
  console.log("required: "+won+"/"+req.length+"   optional: "+optWon+"/"+opt.length);
}
