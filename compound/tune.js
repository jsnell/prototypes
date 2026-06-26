"use strict";
/* ============================================================================
   >>> GOAL (do not drift): tune the economy so the CURRENT greedy AI — the one
   >>> that gets 800 points (ALL 7 directives) by turn 11 — instead lands 800 at
   >>> AROUND TURN 15 (need not be exact). Only the 800/all-7 result matters;
   >>> "required only / Minor" is noise — never report it. The point is to create
   >>> a scenario the greedy AI no longer plays optimally, so a future search AI
   >>> has room to beat it. (Do NOT write that search AI yet.)
   ============================================================================
   COMPOUND — bottom-up economy tuner. Start from a deliberately TOO-TIGHT base
   economy with NO directive bonuses, run the AI, and see which directive fails
   first (and why). Then add the smallest bonus that gets past that wall, and
   re-run. Iterate until all 7 complete around the target turn.

   A "bonus" is a directive reward that improves the two economy levers:
   build rate (per tier) or population growth (immig). D3 always keeps its tech
   unlock (assembler+lab) — that's a prerequisite, not an economy lever.

   Edit CFG below and run: ALL=1 node tune.js
   ========================================================================== */
var E=require("./engine.js").COMPOUND, AI=require("./balance.js"), get=E.get;

/* ---- the knobs under test ---------------------------------------------- */
var CFG={
  buildRate:{1:1,2:1,3:0},   // base builds/turn per tier (T2 kept open for path choice)
  immig:2,                    // base population growth / turn
  startPop:5,
  /* LANDED CONFIG (now baked into engine.js scenario): greedy AI reaches 800 @T14.
     bonuses: directiveId -> {buildRate:{tier:+n}} or {immig:+n} */
  bonus:{
    D1:{buildRate:{1:1}},   // metal/food early ramp
    D2:{buildRate:{2:1}},   // tier-2 throughput for electronics chain
    D3:{buildRate:{3:1}},   // tier-3 so assembler/lab (D5/D7) are buildable
  }
};

/* ---- run one config, report trajectory + first wall -------------------- */
function run(cfg){
  var S=E.newState();
  S.buildRate=Object.assign({},cfg.buildRate);
  S.immig=cfg.immig; if(cfg.startPop!=null)S.pop=cfg.startPop;
  /* strip ALL reward economy bonuses; keep only unlocks + prestige, then layer cfg.bonus back on */
  S.sc.directives.forEach(function(d){
    var keep={}; if(d.reward&&d.reward.unlock)keep.unlock=d.reward.unlock;
    var b=cfg.bonus[d.id];
    if(b){if(b.buildRate)keep.buildRate=b.buildRate; if(b.immig)keep.immig=b.immig;}
    d.reward=keep;
  });
  var doneTurn={},rows=[];
  while(!S.over){var t=S.turn, br=Object.assign({},S.buildRate);
    AI.greedyTurn(S);
    var R=E.solveFlows(S);
    S.sc.directives.forEach(function(d){if(S.done[d.id]&&!doneTurn[d.id])doneTurn[d.id]=t;});
    var open=E.deliverable(S);
    rows.push("T"+String(t).padEnd(2)+" br="+get(br,1)+"/"+get(br,2)+"/"+get(br,3)+
      " pop="+Math.round(S.pop)+"/"+Math.round(R.cap)+
      "  "+S.sc.directives.map(function(d){
        var p=get(S.progress,d.id);
        return d.id+(S.done[d.id]?"✓":S.failed[d.id]?"✗":(open.indexOf(d)>=0?"("+Math.round(get(R.surplus,d.good)*10)/10+"/"+d.rate+")":""+p));
      }).join(" "));
  }
  var all7=S.sc.directives.every(function(d){return !!S.done[d.id];});
  var allDoneTurn=all7?Math.max.apply(null,S.sc.directives.map(function(d){return doneTurn[d.id];})):-1;
  console.log("CFG base br="+JSON.stringify(cfg.buildRate)+" immig="+cfg.immig+" startPop="+(cfg.startPop||5));
  console.log("bonuses: "+(Object.keys(cfg.bonus).length?Object.keys(cfg.bonus).map(function(k){return k+":"+JSON.stringify(cfg.bonus[k]);}).join("  "):"(none)"));
  console.log(rows.join("\n"));
  console.log("VERDICT: "+S.result+(all7?"   ALL-7 @T"+allDoneTurn:""));
  var firstFail=S.sc.directives.filter(function(d){return S.failed[d.id];}).map(function(d){return d.id+"("+d.good+" "+d.rate+"/dur"+d.dur+" by T"+d.deadline+")";});
  if(firstFail.length)console.log("FAILED: "+firstFail.join(", "));
  console.log("");
}
run(CFG);
