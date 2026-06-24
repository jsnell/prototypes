"use strict";
/* ============================================================================
   COMPOUND — headless balance harness.
   Plays a greedy strategy that builds toward the active directives' supply
   chains, then reports whether the required directives are won and the margin.
   Used to tune the economy without a browser.   Run: node balance.js
   ========================================================================== */
var E=require("./engine.js").COMPOUND;
var TYPES=E.TYPES,ORDER=E.ORDER,get=E.get;

/* recipe closure: relative units of each good needed to make 1 unit of `good` */
function recipeWeights(good,depth,acc,scale){
  acc=acc||{}; depth=depth==null?6:depth; scale=scale==null?1:scale;
  acc[good]=(acc[good]||0)+scale;
  if(depth<=0)return acc;
  var prod=E.PRODUCER[good]; if(!prod)return acc;
  var T=TYPES[prod]; if(!T||!T.out||!T.out[good]||!T.in)return acc;
  var per=scale/T.out[good];
  for(var g in T.in) recipeWeights(g,depth-1,acc,T.in[g]*per);
  return acc;
}
function slotsLeft(S){var o={};for(var bt=1;bt<=3;bt++)o[bt]=get(S.buildRate,bt)-get(S.placed,bt);return o;}
function hasSlot(S,type){return slotsLeft(S)[TYPES[type].bt]>0;}

/* producers per good, including alternate/branched routes the harness can use */
var ALT={power:["solar","reactor"],food:["greenhouse","algaeVat"],metal:["smelter","scrapper"],rare:["rareMine","scrapper"]};
function producersFor(good){return ALT[good]||(E.PRODUCER[good]?[E.PRODUCER[good]]:[]);}

/* ---- placement: pick the tile that maximises the building's effective multiplier,
   so the AI actually exploits clustering / sunline / lava / radiators ---- */
function bestTileByMult(S,type){
  var T=TYPES[type],best=-1,bm=-1e9;
  for(var id=0;id<S.map.tiles.length;id++){
    if(!E.eligible(S,type,id))continue;
    var t=S.map.tiles[id],m=E.adjMult(S,type,id)*E.heatRatio(S,type,id);
    if(T.cap)m=t.lava?1.4:(E.radiated(S,id)?0.4:1);     /* housing: value lava, avoid irradiation */
    if(!T.deposit&&!T.requiresWreck&&t.dep)m-=0.25;     /* don't squat a deposit needlessly */
    if(!T.lavaBonus&&t.lava)m-=0.4;                     /* don't waste a lava tube on non-housing */
    if(m>bm){bm=m;best=id;}
  }
  return best;
}
/* constructive planner: drill to the deepest starved input; returns a type to build */
function chooseBuild(S,good,R,depth){
  if(depth>10)return null;
  var ps=producersFor(good);
  for(var pi=0;pi<ps.length;pi++){var type=ps[pi],T=TYPES[type];
    if(!E.unlocked(S,type))continue;
    if(bestTileByMult(S,type)<0)continue;              /* no eligible tile for this producer */
    if(T.in)for(var g in T.in){                        /* build a starved input first */
      if(get(R.surplus,g)<T.in[g]*0.6){var sub=chooseBuild(S,g,R,depth+1);if(sub)return sub;}
    }
    return type;
  }
  return null;
}
var ALLMODE=process.env.ALL==="1", ONLY_OPT=process.env.OPT||null;
var CHASE=ALLMODE||!!ONLY_OPT;                          /* pursuing optionals (Major) -> sort by deadline */
function include(d){return d.must||ALLMODE||(ONLY_OPT&&d.id===ONLY_OPT);}
function focusList(S){
  return S.sc.directives.filter(function(d){return !S.done[d.id]&&!S.failed[d.id]&&include(d);})
    .sort(function(a,b){if(!CHASE&&a.must!==b.must)return a.must?-1:1;return a.deadline-b.deadline;});
}
function lifeGoals(S,R){return [{good:"power",rate:1},{good:"food",rate:0.5},{good:"water",rate:0.5}]
  .filter(function(x){return get(R.surplus,x.good)<x.rate;});}

/* reclaim a tile by demolishing a building whose removal keeps life support met
   and doesn't drop any directive that's currently being satisfied (no thrash) */
function safeDemolish(S){
  var R0=E.solveFlows(S);
  var must=S.sc.directives.filter(function(d){return E.deliverable(S).indexOf(d)>=0&&get(R0.surplus,d.good)>=d.rate-1e-6;});
  /* candidates ranked by how redundant their output is (highest min-output-surplus first) */
  var cand=[];
  for(var i=0;i<S.buildings.length;i++){var b=S.buildings[i];if(!b)continue;var T=TYPES[b.type];
    var outs=Object.keys(T.out||{});var mn=outs.length?Math.min.apply(null,outs.map(function(g){return get(R0.surplus,g);})):0;
    cand.push({i:i,score:mn});}
  cand.sort(function(a,b){return b.score-a.score;});
  for(var c=0;c<cand.length;c++){var i=cand[c].i,b=S.buildings[i],tile=b.tile;
    S.buildings[i]=null;S.occ[tile]=-1;S.tilesUsed--;
    var R=E.solveFlows(S),ok=R.lifeMet;
    if(ok)for(var m=0;m<must.length;m++){if(get(R.surplus,must[m].good)<must[m].rate-1e-6){ok=false;break;}}
    if(ok)return true;                                 /* keep it demolished */
    S.buildings[i]=b;S.occ[tile]=i;S.tilesUsed++;      /* restore */
  }
  return false;
}
function tryBuild(S,type){                             /* place on best tile, reclaiming one if full */
  var id=bestTileByMult(S,type);
  if(id<0){if(!safeDemolish(S))return false;id=bestTileByMult(S,type);if(id<0)return false;}
  E.placeAt(S,type,id);return true;
}
function greedyTurn(S){
  for(var guard=0;guard<160;guard++){
    var R=E.solveFlows(S),placed=false;
    /* 1) house up when colonists run low and there's room to grow */
    if(get(R.surplus,"workers")<2 && R.cap-S.pop<S.immig && hasSlot(S,"habitat")){ if(tryBuild(S,"habitat")){continue;} }
    /* 2) industry is worker-gated: only add worker-consuming buildings if colonists are free */
    if(get(R.surplus,"workers")>=1){
      var goals=lifeGoals(S,R).concat(focusList(S).filter(function(d){return get(R.surplus,d.good)<d.rate*1.05+0.25;}));
      for(var i=0;i<goals.length;i++){var ty=chooseBuild(S,goals[i].good,R,0);
        if(!ty||!hasSlot(S,ty))continue;
        if(tryBuild(S,ty)){placed=true;break;}}
    }
    if(!placed)break;
  }
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
      log.push("T"+t+" b="+S.tilesUsed+" pop="+Math.round(S.pop)+"/"+Math.round(R.cap)+"(+"+S.immig+") pr="+Math.round(S.prestige)+" ["+sg+"]\n   "+prog+(res.msgs.length?"  | "+res.msgs.join(", "):""));
    }
  }
  return {S:S,log:log};
}

var v=run(true);
console.log(v.log.join("\n"));
console.log("\nRESULT: "+v.S.result);
console.log("buildRate end:",JSON.stringify(v.S.buildRate),"tiles used:",v.S.tilesUsed);
var req=v.S.sc.directives.filter(function(d){return d.must;});
var won=req.filter(function(d){return v.S.done[d.id];}).length;
var opt=v.S.sc.directives.filter(function(d){return !d.must;});
var optWon=opt.filter(function(d){return v.S.done[d.id];}).length;
console.log("required: "+won+"/"+req.length+"   optional: "+optWon+"/"+opt.length);
