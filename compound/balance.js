"use strict";
/* ============================================================================
   COMPOUND — headless balance harness: a deliberately NAIVE heuristic player,
   used to gauge winnability and set Minor thresholds. Each turn it just:
     0. keeps the colony alive (no life-support good in deficit)
     1. satisfies the currently-open directives
     2. keeps housing ahead of the next immigration batch
     3. builds toward the next upcoming directive
     4. tops up power/food/water headroom for the next batch
   Steps 2-4 keep a build only if it doesn't drop a directive already being
   satisfied. No auto-radiators, no demolition, no magic constants. Heat
   buildings simply run overheated (reduced output); the AI overbuilds to
   compensate, exactly as running-overheated-is-fine implies.
   Run: node balance.js     (ALL=1 also pursues optionals; OPT=Dx chases one)
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
  var T=TYPES[type],best=-1,bm=-1e9;
  for(var id=0;id<S.map.tiles.length;id++){
    if(!E.eligible(S,type,id))continue;
    var t=S.map.tiles[id],m=E.adjMult(S,type,id)*E.heatRatio(S,type,id);
    if(T.cap)m=t.lava?1.4:(E.radiated(S,id)?0.4:1);
    if(T.radiation)m-=0.6*E.countAdj(S,id,function(x){return TYPES[x].cat==="hab";});
    if(T.cap)m-=0.6*E.countAdj(S,id,function(x){return TYPES[x].radiation;});
    if(!T.deposit&&!T.requiresWreck&&t.dep)m-=0.25;
    if(!T.lavaBonus&&t.lava)m-=0.4;
    if(m>bm){bm=m;best=id;}
  }
  return best;
}
/* what to build to raise `good`: among the producers that have a free slot, use the one on the
   LEAST-contested tier (lowest opportunity cost — e.g. a reactor/scrapper on an idle T2 slot when
   T1 is full); ties go to the cheaper lower tier. Then drill into any MATERIAL input that's
   actually in deficit. A shortage of workers (or cooling) doesn't block — the building just runs
   reduced; housing+immigration supply labour over time. */
function chooseForGood(S,good,R,depth){
  if(depth>10)return null;
  var sl=slotsLeft(S);
  var ps=producersFor(good).filter(function(t){return E.unlocked(S,t)&&hasSlot(S,t)&&bestTileByMult(S,t)>=0;})
    .sort(function(a,b){return (sl[TYPES[b].bt]-sl[TYPES[a].bt])||(TYPES[a].bt-TYPES[b].bt);});
  for(var i=0;i<ps.length;i++){var type=ps[i],T=TYPES[type];
    if(T.in)for(var g in T.in){if(g!=="workers"&&get(R.surplus,g)<T.in[g]-1e-6){var sub=chooseForGood(S,g,R,depth+1);if(sub)return sub;}}  /* not enough of this input to run the producer -> build it first */
    return type;
  }
  return null;
}
function tryBuild(S,type){var id=bestTileByMult(S,type);if(id<0)return false;E.placeAt(S,type,id);return true;}

var ALLMODE=process.env.ALL==="1", ONLY_OPT=process.env.OPT||null;
function include(d){return d.must||ALLMODE||(ONLY_OPT&&d.id===ONLY_OPT);}
/* urgency = latest turn you can still start sustaining and finish by the deadline */
function startBy(S,d){return d.deadline-(d.dur-get(S.progress,d.id))+1;}
function byUrg(S){return function(a,b){var u=startBy(S,a)-startBy(S,b);return u||(a.must===b.must?0:(a.must?-1:1));};}

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
/* speculative build: keep it only if it doesn't drop a directive we're already satisfying */
function buildAhead(S,type,why){
  var before=satisfiedSet(S,E.solveFlows(S)),snap=snapshot(S);
  if(!tryBuild(S,type)){restore(S,snap);return false;}
  if(violates(before,E.solveFlows(S))){restore(S,snap);return false;}
  logBuild(S,"ahead",why,type);return true;
}

var LS=["food","water","power"];
function buildStep(S){
  var R=E.solveFlows(S);
  /* 0. survival: any life-support good in deficit, most negative first */
  var neg=LS.filter(function(g){return get(R.surplus,g)<-1e-6;}).sort(function(a,b){return get(R.surplus,a)-get(R.surplus,b);});
  for(var i=0;i<neg.length;i++){var t=chooseForGood(S,neg[i],R,0);if(t&&hasSlot(S,t)&&tryBuild(S,t)){logBuild(S,"survival",neg[i],t);return true;}}
  /* 1. satisfy the currently-open directives, most urgent first */
  var open=E.deliverable(S).filter(include).filter(function(d){return get(R.surplus,d.good)<d.rate-0.05;}).sort(byUrg(S));
  for(var j=0;j<open.length;j++){var t2=chooseForGood(S,open[j].good,R,0);if(t2&&hasSlot(S,t2)&&tryBuild(S,t2)){logBuild(S,"current",open[j].id,t2);return true;}}
  /* 2. keep housing ahead of the next immigration batch */
  if(R.cap-S.pop<S.immig&&hasSlot(S,"habitat")&&buildAhead(S,"habitat","housing"))return true;
  /* 3. build toward the next upcoming directive (not open yet) */
  var opn=E.deliverable(S);
  var up=S.sc.directives.filter(function(d){return !S.done[d.id]&&!S.failed[d.id]&&include(d)&&opn.indexOf(d)<0;}).sort(byUrg(S));
  for(var k=0;k<up.length;k++){var t3=chooseForGood(S,up[k].good,R,0);if(t3&&hasSlot(S,t3)&&buildAhead(S,t3,up[k].id))return true;}
  /* 4. top up power/food/water headroom for the next batch (lowest surplus first) */
  var low=LS.slice().sort(function(a,b){return get(R.surplus,a)-get(R.surplus,b);});
  for(var m=0;m<low.length;m++){if(get(R.surplus,low[m])<S.immig*E.LIFE[low[m]]){var t4=chooseForGood(S,low[m],R,0);if(t4&&hasSlot(S,t4)&&buildAhead(S,t4,"balance:"+low[m]))return true;}}
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
      log.push("T"+t+" b="+S.tilesUsed+" pop="+Math.round(S.pop)+"/"+Math.round(R.cap)+"(+"+S.immig+") pr="+Math.round(S.prestige)+" ["+sg+"]\n   builds: "+(decs||"-")+"\n   "+prog+(res.msgs.length?"  | "+res.msgs.join(", "):""));
    }
  }
  return {S:S,log:log};
}

var EXPORT={greedyTurn:greedyTurn,run:run,chooseForGood:chooseForGood,buildStep:buildStep,bestTileByMult:bestTileByMult,tryBuild:tryBuild};
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
