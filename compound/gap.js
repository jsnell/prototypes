"use strict";
/* One command to see the greedy-vs-optimal gap for the CURRENT engine.js economy.
   Runs the greedy AI (JS), exports params, runs the Rust search, and re-verifies the
   search's build order in the JS engine (ground truth). Run: node gap.js  [BEAM=.. PLANCAP=.. HORIZON=..] */
var E=require("./engine.js").COMPOUND, AI=require("./balance.js"), get=E.get, cp=require("child_process");
// 1) greedy
var S=E.newState(), gdt={};
while(!S.over){var t=S.turn; AI.greedyTurn(S); S.sc.directives.forEach(function(d){if(S.done[d.id]&&!gdt[d.id])gdt[d.id]=t;});}
var gAll7=S.sc.directives.every(function(d){return S.done[d.id];});
var gTurn=gAll7?Math.max.apply(null,S.sc.directives.map(function(d){return gdt[d.id];})):-1;
// 2) export params, 3) rust search
cp.execSync("node "+__dirname+"/export-params.js",{stdio:"inherit"});
var env=Object.assign({},process.env,{BEAM:process.env.BEAM||"400",PLANCAP:process.env.PLANCAP||"200",HORIZON:process.env.HORIZON||"15"});
var out=cp.execSync("./target/release/search search",{cwd:__dirname+"/search-rs",env:env}).toString();
var m=out.match(/BEST all-7 @T(\d+)/), sTurn=m?+m[1]:-1;
var order=out.split("\n").filter(function(l){return /^\s*T\d+:/.test(l);});
// 4) verify order in JS
var rev={}; for(var k in E.ABBR)rev[E.ABBR[k]]=k;
var V=E.newState();
order.forEach(function(l){if(V.over)return; var ab=l.replace(/^\s*T\d+:\s*/,"").trim();
  (ab==="-"?[]:ab.split(/\s+/)).map(function(a){return rev[a];}).forEach(function(ty){
    var id=AI.bestTileByMult(V,ty); if(id>=0&&get(V.placed,E.TYPES[ty].bt)<get(V.buildRate,E.TYPES[ty].bt))E.placeAt(V,ty,id);});
  E.processEndTurn(V);});
var vAll7=V.sc.directives.every(function(d){return V.done[d.id];}), vTurn=vAll7?V.turn:-1;
var verdict = sTurn<0?"":(vAll7&&vTurn===sTurn?"  [JS-verified]":"  [VERIFY MISMATCH: js="+(vAll7?("T"+vTurn):"fail")+"]");
console.log("\n==== GAP (current engine.js economy) ====");
console.log("greedy:  "+(gAll7?"800 @T"+gTurn:"NOT 800 (prestige "+Math.round(S.prestige)+")"));
console.log("search:  "+(sTurn>0?"800 @T"+sTurn+verdict:"no 800 found"));
console.log("gap:     "+((gAll7&&sTurn>0)?(gTurn-sTurn)+" turns":"n/a"));
