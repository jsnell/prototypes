"use strict";
/* Dump engine.js's economy (the iteration knobs) to search-rs/params.txt so the Rust search reads
   the SAME scenario as the JS engine/game — engine.js stays the single source of truth.
   Map + recipes (TYPES) are structural and stay hardcoded in both; this exports only the economy:
   base build rates, population growth, and the full directive specs (incl. rewards). */
var E=require("./engine.js").COMPOUND, fs=require("fs");
var sc=E.newState().sc, GO=E.GOODORDER, out=[];
out.push("buildRate "+(sc.buildRate[1]||0)+" "+(sc.buildRate[2]||0)+" "+(sc.buildRate[3]||0));
out.push("immig "+E.IMMIG_BASE);
out.push("startPop "+sc.startPop);
var idx={}; sc.directives.forEach(function(d,i){idx[d.id]=i;});
sc.directives.forEach(function(d){
  var rb=(d.reward&&d.reward.buildRate)||{};
  var req=(d.req||[]).map(function(id){return idx[id];});
  out.push(["dir",GO.indexOf(d.good),d.rate,d.dur,d.deadline,d.must?1:0,
    rb[1]||0,rb[2]||0,rb[3]||0,(d.reward&&d.reward.immig)||0,(d.reward&&d.reward.unlock)?1:0,d.rp]
    .concat(req).join(" "));
});
fs.writeFileSync(__dirname+"/search-rs/params.txt", out.join("\n")+"\n");
console.log("wrote search-rs/params.txt ("+sc.directives.length+" directives)");
