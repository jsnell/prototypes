"use strict";
/* Turn-by-turn diff: human replay vs AI, on whatever params engine.js currently has.
   Run: node compare.js   (pin engine to the log's params first for an apples-to-apples diff) */
var E=require("./engine.js").COMPOUND, AI=require("./balance.js"), get=E.get;

/* the shared log (first MAJOR-by-T12 game) */
var MOVES=[
  ["+greenhouse@6,1","+habitat@5,1","+reactor@3,6"],
  ["+waterPlant@7,1","+radiator@3,5","+reactor@4,6"],
  ["+scrapper@4,2","+oreMine@4,3","+smelter@4,4","+smelter@5,4"],
  ["+habitat@6,2","+iceExtractor@8,2","+waterPlant@8,3","+reclaimer@5,2"],
  ["+habitat@5,3","+silicaQuarry@2,2","+glassKiln@2,3","+electronicsFab@2,4","+electronicsFab@1,3"],
  ["+radiator@3,3","+scrapper@1,6","+reactor@3,2","+iceExtractor@8,4","+waterPlant@7,4"],
  ["+habitat@4,1","+waterPlant@8,5","+radiator@5,6","+reactor@6,6","-smelter@4,4","+rareMine@4,5"],
  ["+foundry@4,4","+assembler@0,3","+assembler@1,4","+radiator@0,4","+habitat@0,6","-smelter@5,4","+radiator@2,6"],
  ["+greenhouse@8,1","+greenhouse@7,2","+greenhouse@6,3"],
  ["+habitat@4,0"],["+lab@0,2","+lab@1,2"],[]
];
function tid(S,q,r){return S.map.idOf[q+","+r];}
function applyMove(S,mv){var m=mv.match(/^([+-])(\w+)@(\d+),(\d+)$/),id=tid(S,+m[3],+m[4]);
  if(m[1]==="+")E.placeAt(S,m[2],id);else{var bi=S.occ[id];if(bi!=null&&bi>=0){S.occ[id]=-1;S.buildings[bi]=null;S.tilesUsed--;}}}
function tallyMoves(mvs){var o={};mvs.forEach(function(mv){var m=mv.match(/^([+-])(\w+)/);var k=(m[1]==="-"?"-":"")+E.ABBR[m[2]];o[k]=(o[k]||0)+1;});
  return Object.keys(o).map(function(k){return (o[k]>1?o[k]:"")+k;}).join(" ");}
function dirsDone(S){return S.sc.directives.filter(function(d){return S.done[d.id];}).map(function(d){return d.id;}).join("")||"-";}
function sur(R){return ["power","workers","food","water","metal","electronics","components","research"]
  .map(function(g){return g.slice(0,2)+(Math.round(get(R.surplus,g)*10)/10);}).join(" ");}

/* run human */
var H=E.newState(),hum=[];
for(var t=0;t<MOVES.length&&!H.over;t++){MOVES[t].forEach(function(mv){applyMove(H,mv);});var R=E.solveFlows(H);
  hum.push({t:t+1,build:tallyMoves(MOVES[t])||"-",pop:Math.round(H.pop)+"/"+Math.round(R.cap),done:dirsDone(H),sur:sur(R)});
  E.processEndTurn(H);}

/* run AI */
var A=E.newState(),ai=[],pj=0;
while(!A.over&&A.turn<=24){var t=A.turn,before=A.buildings.filter(Boolean).length;var R=E.solveFlows(A);
  AI.greedyTurn(A);
  var built={};A.buildings.forEach(function(b){if(b&&b.turn===t)built[E.ABBR[b.type]]=(built[E.ABBR[b.type]]||0)+1;});
  var bs=Object.keys(built).map(function(k){return (built[k]>1?built[k]:"")+k;}).join(" ")||"-";
  ai.push({t:t,build:bs,pop:Math.round(A.pop)+"/"+Math.round(R.cap),done:"",sur:sur(R)});}
/* fill AI done states (recompute by replaying done flags per turn is hard; show final + completion turns) */
var aiDone={};A.sc.directives.forEach(function(d){if(A.done[d.id])aiDone[d.id]=true;});

console.log("PARAMS: immig="+E.IMMIG_BASE+" LIFE="+JSON.stringify(E.LIFE)+"  board="+E.W+"x"+E.H);
console.log("\n=== HUMAN (replay) ===  finished: "+H.result);
hum.forEach(function(r){console.log("T"+r.t+"  "+r.build.padEnd(34)+" pop"+r.pop.padEnd(7)+" done="+r.done.padEnd(14)+" ["+r.sur+"]");});
console.log("\n=== AI (greedy) ===  finished: "+A.result+"  ("+A.turn+" turns)");
ai.forEach(function(r){console.log("T"+r.t+"  "+r.build.padEnd(34)+" pop"+r.pop.padEnd(7)+" ["+r.sur+"]");});
