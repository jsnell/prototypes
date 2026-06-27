/* Replay AI solutions exported by `search export` through the JS engine and verify the
   JS outcome (stars) matches what the Rust lab computed. Proves engine parity.
   Usage: node search-rs/target/release/... > sol.json ; node replay-check.js sol.json */
var C = require("./engine.js").COMPOUND;
var fs = require("fs");
var sol = JSON.parse(fs.readFileSync(process.argv[2] || "/tmp/sol.json", "utf8"));

function demolishAt(S, tile) {                 // mirror index.html doDemolish (removal only)
  var bi = S.occ[tile];
  if (bi == null || bi < 0) throw new Error("demolish empty tile " + tile);
  S.occ[tile] = -1; S.buildings[bi] = null; S.tilesUsed--;
}

function replay(name, plan) {
  var S = C.newState();
  // sanity: JS seed colony must match Rust's seed
  var jsSeed = S.buildings.map(function (b) { return [b.type, b.tile]; }).sort(function (a, b) { return a[1] - b[1]; });
  var rsSeed = sol.seed.slice().sort(function (a, b) { return a[1] - b[1]; });
  if (JSON.stringify(jsSeed) !== JSON.stringify(rsSeed))
    console.log("  ! seed mismatch\n    js=" + JSON.stringify(jsSeed) + "\n    rs=" + JSON.stringify(rsSeed));
  var warns = 0;
  for (var t = 0; t < plan.turns.length; t++) {
    if (S.over) break;
    var mv = plan.turns[t];
    for (var i = 0; i < mv.demolish.length; i++) demolishAt(S, mv.demolish[i]);
    for (var j = 0; j < mv.place.length; j++) {
      var type = mv.place[j][0], tile = mv.place[j][1];
      if (!C.eligible(S, type, tile)) { warns++; console.log("  ! T" + (t + 1) + " ineligible " + type + "@" + tile); }
      if (!C.unlocked(S, type)) { warns++; console.log("  ! T" + (t + 1) + " locked " + type); }
      C.placeAt(S, type, tile);
    }
    C.processEndTurn(S);
  }
  while (!S.over) C.processEndTurn(S);          // drain any trailing resolution turns
  var optTot = 0, optDone = 0;
  for (var k = 0; k < S.sc.directives.length; k++) { var d = S.sc.directives[k]; if (!d.must) { optTot++; if (S.done[d.id] === "done") optDone++; } }
  var reqAll = S.sc.directives.every(function (d) { return !d.must || S.done[d.id] === "done"; });
  var jsStars = reqAll ? optDone : -1;
  var ok = (jsStars === plan.stars) && warns === 0;
  console.log("  " + name + ": JS=" + jsStars + "/" + optTot + " stars, Rust expected=" + plan.stars +
    "  result=\"" + S.result + "\"  " + (ok ? "✓ MATCH" : "✗ MISMATCH"));
  return ok;
}

console.log("Replaying AI solutions through JS engine:");
var a = replay("search", sol.search);
var b = replay("greedy", sol.greedy);
process.exit(a && b ? 0 : 1);
