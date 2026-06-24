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

/* constructive planner: drill to the deepest starved input, trying alternate
   producers when the primary has no placeable tile (no free deposit/wreck) */
function chooseBuild(S,good,R,depth){
  if(depth>10)return null;
  var ps=producersFor(good);
  for(var pi=0;pi<ps.length;pi++){var type=ps[pi],T=TYPES[type];
    if(!E.unlocked(S,type))continue;
    if(E.bestTile(S,type)<0)continue;                 /* no eligible tile for this producer */
    if(T.in)for(var g in T.in){                        /* prefer building a starved input first */
      if(get(R.surplus,g)<T.in[g]*0.6){var sub=chooseBuild(S,g,R,depth+1);if(sub)return sub;}
    }
    return {type:type,id:E.bestTile(S,type)};          /* else build this producer (throttles resolve later) */
  }
  return null;
}
/* directives we still want to push, highest priority first.
   mustOnly=true tests pure required-winnability (optionals checked separately). */
var MUST_ONLY=process.env.ALL!=="1";
function focusList(S){
  return S.sc.directives.filter(function(d){return !S.done[d.id]&&!S.failed[d.id]&&(!MUST_ONLY||d.must);})
    .sort(function(a,b){if(a.must!==b.must)return a.must?-1:1;return a.deadline-b.deadline;});
}
function greedyTurn(S){
  for(var guard=0;guard<80;guard++){
    var R=E.solveFlows(S),placed=false,foc=focusList(S);
    for(var i=0;i<foc.length;i++){var d=foc[i];
      if(get(R.surplus,d.good)>=d.rate*1.1+0.4)continue;       /* already comfortably met */
      var c=chooseBuild(S,d.good,R,0);
      if(!c||!hasSlot(S,c.type)||c.id<0)continue;
      E.placeAt(S,c.type,c.id);placed=true;break;
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
      log.push("T"+t+" b="+S.tilesUsed+" pr="+Math.round(S.prestige)+" ["+sg+"]\n   "+prog+(res.msgs.length?"  | "+res.msgs.join(", "):""));
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
