"use strict";
/* ============================================================================
   COMPOUND — replay a shared game log through the engine.
   Lets us test parameter changes against a REAL playthrough.
   Run: node replay.js              (current engine params)
   ========================================================================== */
var E=require("./engine.js").COMPOUND,get=E.get;

/* jsnell's latest MAJOR-by-T11 game on current settings (pasted from the ⧉ Copy log) */
var MOVES=[
  ["+greenhouse@6,1","+habitat@6,2","+scrapper@4,2"],
  ["+waterPlant@7,1","+reactor@3,6","+radiator@3,5"],
  ["+oreMine@3,4","+smelter@4,4","+scrapper@7,3","+habitat@5,2"],
  ["+reactor@6,6","+radiator@6,5","+iceExtractor@8,2","+silicaQuarry@2,2"],
  ["+glassKiln@2,3","+radiator@3,3","+habitat@4,3","+electronicsFab@2,4","+electronicsFab@1,3"],
  ["+reclaimer@5,3","+waterPlant@7,2","+habitat@6,3","+iceExtractor@8,4","+reactor@7,6"],
  ["+waterPlant@7,4","+waterPlant@7,5","+foundry@3,2","+radiator@3,1","+assembler@2,1","+foundry@4,5","+assembler@5,5"],
  ["+habitat@5,4","+habitat@6,4","+solar@0,2","+algaeVat@5,0","+algaeVat@4,0"],
  ["+solar@0,3","+solar@0,4","+solar@0,5","+algaeVat@3,0","+algaeVat@5,1","+algaeVat@4,1","+greenhouse@8,5"],
  ["+lab@2,0","+lab@1,0","+solar@0,6","-assembler@5,5","-foundry@4,5","+greenhouse@8,1"],
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
