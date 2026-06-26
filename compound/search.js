"use strict";
/* ============================================================================
   COMPOUND — search-based AI. Goal: beat the greedy heuristic by completing all
   7 directives (800 pts) in FEWER turns. Since 800 is the prestige ceiling,
   "better" = earlier all-done turn.

   Method: beam search over per-turn build COMPOSITIONS. Each turn, from a beam
   of states, enumerate plausible multisets of buildings to add (respecting the
   per-tier build-rate slots; tiles chosen by the same bestTileByMult heuristic
   the greedy uses), apply processEndTurn, score, and keep the top-B states.
   solveFlows is the engine's real solver — no separate model, so any build order
   the search finds is replayable in the actual game (we verify at the end).

   Run: node search.js   [BEAM=400] [HORIZON=16]
   ========================================================================== */
var E=require("./engine.js").COMPOUND, AI=require("./balance.js"), get=E.get;
var TYPES=E.TYPES;
var BEAM=+(process.env.BEAM||400), HORIZON=+(process.env.HORIZON||16), PLANCAP=+(process.env.PLANCAP||60);

/* ---- state clone (share immutable sc & map) ---------------------------- */
function clone(S){return {
  sc:S.sc, map:S.map, turn:S.turn,
  buildings:S.buildings.slice(), occ:Object.assign({},S.occ),
  buildRate:Object.assign({},S.buildRate), unlocked:Object.assign({},S.unlocked),
  placed:Object.assign({},S.placed), done:Object.assign({},S.done),
  failed:Object.assign({},S.failed), progress:Object.assign({},S.progress),
  metNow:{}, prestige:S.prestige, tilesUsed:S.tilesUsed, pop:S.pop, immig:S.immig,
  lifeShort:S.lifeShort, grew:0, sel:null, selTile:-1, over:S.over, result:S.result, lastMsgs:[]
};}

/* ---- which goods are currently "short" (worth building toward) ---------- */
function shortGoods(S,R){
  var need={};
  /* directive goods not yet done, whose live surplus is below the required rate */
  S.sc.directives.forEach(function(d){ if(S.done[d.id]||S.failed[d.id])return;
    if(get(R.surplus,d.good) < d.rate-0.05) need[d.good]=1; });
  /* any input starving a running producer (ratio<1) */
  for(var i=0;i<R.eff.length;i++){var lim=E.limitingInput(S,R,i); if(lim)need[lim]=1;}
  /* power if tight, food/water if life support thin */
  if(get(R.surplus,"power")<2) need.power=1;
  return need;
}
var ALT={power:["solar","reactor"],food:["greenhouse","algaeVat"],metal:["smelter","scrapper"],rare:["rareMine","scrapper"]};
function producersFor(good){return ALT[good]||(E.PRODUCER[good]?[E.PRODUCER[good]]:[]);}

/* candidate building TYPES this turn: producers of short goods + their short inputs,
   plus housing, plus cooling for throttled producers of short goods. */
function candidateTypes(S,R){
  var need=shortGoods(S,R), set={};
  function add(t){ if(E.unlocked(S,t) && AI.bestTileByMult(S,t)>=0) set[t]=1; }
  Object.keys(need).forEach(function(g){
    producersFor(g).forEach(function(t){ add(t);
      var T=TYPES[t]; if(T.in)for(var ig in T.in){ if(ig!=="workers"&&ig!=="power") producersFor(ig).forEach(add); }
    });
    if(g==="water") add("reclaimer");
  });
  add("habitat");
  /* radiator if some heat producer of a needed good is throttled */
  for(var i=0;i<S.buildings.length;i++){var b=S.buildings[i]; if(!b)continue; var T=TYPES[b.type];
    if(T.heat && T.out && Object.keys(T.out).some(function(g){return need[g];}) && E.heatRatio(S,b.type,b.tile)<0.999){ add("radiator"); break; }}
  return Object.keys(set);
}

/* ---- enumerate multisets (size 0..k) of `items` ------------------------ */
function multisets(items,k){
  var out=[[]];
  function rec(start,cur){ if(cur.length>0)out.push(cur.slice());
    if(cur.length===k)return;
    for(var i=start;i<items.length;i++){cur.push(items[i]); rec(i,cur); cur.pop();} }
  rec(0,[]);
  return out;
}

/* cheap plan pre-score (no solve): reward addressing distinct short goods, lightly prefer fewer builds */
function planScore(S,R,need,plan){
  var hit={},s=0;
  for(var i=0;i<plan.length;i++){var T=TYPES[plan[i]];
    if(T.out)for(var g in T.out){if(need[g]&&!hit[g]){hit[g]=1;s+=10;}}
    if(plan[i]==="habitat")s+=( (R.cap-S.pop) < S.immig ? 6 : 1);
    if(plan[i]==="radiator")s+=4;
  }
  return s-0.3*plan.length;
}
/* ---- per-turn expansion: capped set of build compositions -------------- */
function expand(S){
  var R=E.solveFlows(S), need=shortGoods(S,R), cands=candidateTypes(S,R);
  var byTier={1:[],2:[],3:[]};
  cands.forEach(function(t){byTier[TYPES[t].bt].push(t);});
  var slots={1:get(S.buildRate,1),2:get(S.buildRate,2),3:get(S.buildRate,3)};
  var m1=multisets(byTier[1],slots[1]), m2=multisets(byTier[2],slots[2]), m3=multisets(byTier[3],slots[3]);
  var plans=[];
  for(var a=0;a<m1.length;a++)for(var b=0;b<m2.length;b++)for(var c=0;c<m3.length;c++){
    var p=m1[a].concat(m2[b]).concat(m3[c]);
    plans.push({p:p, s:planScore(S,R,need,p)});
  }
  plans.sort(function(x,y){return y.s-x.s;});
  return plans.slice(0,PLANCAP).map(function(x){return x.p;});
}

/* apply a plan (list of types) to a cloned state, then end the turn */
function applyPlan(S,plan){
  var C=clone(S);
  for(var i=0;i<plan.length;i++){var t=plan[i],id=AI.bestTileByMult(C,t);
    if(id>=0 && get(C.placed,TYPES[t].bt)<get(C.buildRate,TYPES[t].bt)) E.placeAt(C,t,id);}
  E.processEndTurn(C);
  return C;
}

/* ---- evaluate a state for beam ranking (higher = closer to all-7 sooner) */
function score(S){
  var R=E.solveFlows(S), s=0;
  var doneN=0;
  S.sc.directives.forEach(function(d){
    if(S.done[d.id]){doneN++; s+=1000; return;}
    if(S.failed[d.id]){s-=5000; return;}              /* a failed directive kills the 800 */
    var prog=get(S.progress,d.id)/d.dur;              /* sustain progress */
    var sup=Math.min(1,get(R.surplus,d.good)/d.rate); /* how close the rate is */
    var slack=d.deadline-S.turn;                      /* urgency: nearer deadline weighs more */
    var w=slack<=0?0:(1/(slack+1));
    s+= 600*prog + 300*Math.max(0,sup) + 200*w*Math.max(0,sup);
  });
  if(!R.lifeMet)s-=2000;
  s += 2*get(R.surplus,"power") + S.pop*0.5;          /* mild economic tie-breakers */
  s -= S.turn*0.01;
  return s;
}

/* ---- beam search ------------------------------------------------------- */
function search(){
  var S0=E.newState();
  var beam=[{S:S0, hist:[]}];
  var best=null;  /* {turn, hist} */
  for(var turn=1;turn<=HORIZON;turn++){
    var children=[];
    for(var bi=0;bi<beam.length;bi++){
      var node=beam[bi]; if(node.S.over)continue;
      var plans=expand(node.S);
      for(var pi=0;pi<plans.length;pi++){
        var child=applyPlan(node.S,plans[pi]);
        var built=child.buildings.filter(function(b){return b&&b.turn===turn;}).map(function(b){return E.ABBR[b.type];});
        var hist=node.hist.concat([{t:turn, build:plans[pi].map(function(x){return E.ABBR[x];})}]);
        var all7=child.sc.directives.every(function(d){return !!child.done[d.id];});
        if(all7){ if(!best||turn<best.turn){best={turn:turn, hist:hist, S:child};} continue; }
        if(child.over)continue;  /* defeat: drop */
        children.push({S:child, hist:hist, sc:score(child)});
      }
    }
    if(best){break;}  /* earliest all-7 turn found at this depth = answer (beam-optimal) */
    /* dedup by building-multiset signature, keep best-scoring per signature */
    children.sort(function(x,y){return y.sc-x.sc;});
    var seen={}, kept=[];
    for(var k=0;k<children.length && kept.length<BEAM;k++){
      var c=children[k];
      var sig=c.S.turn+"|"+c.S.buildings.filter(Boolean).map(function(b){return b.type+"@"+b.tile;}).sort().join(",");
      if(seen[sig])continue; seen[sig]=1; kept.push(c);
    }
    beam=kept;
    if(!beam.length)break;
  }
  return best;
}

/* ---- verify a found build order by replaying it in a fresh engine ------ */
function verify(hist){
  var S=E.newState();
  for(var t=0;t<hist.length && !S.over;t++){
    /* re-derive tiles with the same heuristic, in the same order */
    hist[t].buildAbbr=hist[t].build;
    var types=hist[t].build.map(function(ab){for(var k in E.ABBR)if(E.ABBR[k]===ab)return k;});
    for(var i=0;i<types.length;i++){var ty=types[i],id=AI.bestTileByMult(S,ty);
      if(id>=0 && get(S.placed,TYPES[ty].bt)<get(S.buildRate,TYPES[ty].bt)) E.placeAt(S,ty,id);}
    E.processEndTurn(S);
  }
  var all7=S.sc.directives.every(function(d){return !!S.done[d.id];});
  return {result:S.result, all7:all7, turn:S.turn, prestige:Math.round(S.prestige)};
}

var t0=Date.now();
var best=search();
var dt=((Date.now()-t0)/1000).toFixed(1);
if(!best){console.log("no all-7 solution found within HORIZON="+HORIZON+" (beam="+BEAM+", "+dt+"s)");process.exit(0);}
console.log("BEST all-7 @T"+best.turn+"   (beam="+BEAM+", horizon="+HORIZON+", "+dt+"s)");
console.log("build order:");
best.hist.forEach(function(h){console.log("  T"+h.t+": "+(h.build.join(" ")||"-"));});
var v=verify(best.hist);
console.log("VERIFY (replayed in fresh engine): "+v.result+"  all7="+v.all7+" turn="+v.turn+" prestige="+v.prestige);
