"use strict";
/* ============================================================================
   COMPOUND — replay a shared game log through the engine.
   Lets us test parameter changes against a REAL playthrough.
   Run: node replay.js              (current engine params)
   ========================================================================== */
var E=require("./engine.js").COMPOUND,get=E.get;

/* jsnell's MAJOR-by-T12 game (pasted from the ⧉ Copy log) */
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
  ["+habitat@4,0"],
  ["+lab@0,2","+lab@1,2"],
  []
];

function tileId(S,q,r){return S.map.idOf[q+","+r];}
function apply(S,mv){
  var m=mv.match(/^([+-])(\w+)@(\d+),(\d+)$/);if(!m)throw new Error("bad move "+mv);
  var sign=m[1],type=m[2],q=+m[3],r=+m[4],id=tileId(S,q,r);
  if(id==null)throw new Error("no tile "+q+","+r);
  if(sign==="+"){E.placeAt(S,type,id);}
  else{var bi=S.occ[id];if(bi!=null&&bi>=0){S.occ[id]=-1;S.buildings[bi]=null;S.tilesUsed--;}}
}
function run(verbose){
  var S=E.newState();
  for(var t=0;t<MOVES.length&&!S.over;t++){
    MOVES[t].forEach(function(mv){apply(S,mv);});
    var R=E.solveFlows(S);
    var res=E.processEndTurn(S);
    if(verbose){
      var dirs=S.sc.directives.map(function(d){return d.id+(S.done[d.id]?"✓":S.failed[d.id]?"✗":""+get(S.progress,d.id));}).join(" ");
      var sg=["power","workers","food","water"].map(function(g){return g.slice(0,3)+(Math.round(get(R.surplus,g)*10)/10);}).join(" ");
      console.log("T"+(t+1)+" pop="+Math.round(S.pop)+"/"+Math.round(R.cap)+" life"+(R.lifeMet?"OK":"SHORT")+" ["+sg+"] "+dirs+(res.msgs.length?"  | "+res.msgs.join(", "):""));
    }
  }
  return S;
}
var S=run(true);
console.log("\nRESULT: "+(S.result||"(did not finish in logged turns; turn "+S.turn+")"));
console.log("LIFE="+JSON.stringify(E.LIFE)+" IMMIG_BASE="+E.IMMIG_BASE);
