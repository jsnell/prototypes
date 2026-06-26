"use strict";
/* ============================================================================
   COMPOUND — engine (shared by index.html and balance.js)
   Pure rules + flow solver. No DOM. Works in browser (global COMPOUND) and Node.
   ========================================================================== */
(function(root){

/* ---- grid: rectangular, odd-r offset (pointy-top), so it reads as a rectangle ---- */
var W=9,H=7;
function nbDirs(r){ return (r&1)
  ? [[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]]
  : [[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]]; }
function buildMap(){
  var tiles=[],idOf={},q,r;
  for(r=0;r<H;r++)for(q=0;q<W;q++){var id=tiles.length;tiles.push({id:id,q:q,r:r,dep:null,lava:false,wreck:false});idOf[q+","+r]=id;}
  function set(q,r,f){var id=idOf[q+","+r];if(id!=null)f(tiles[id]);}
  function dep(L,k){for(var i=0;i<L.length;i++)set(L[i][0],L[i][1],(function(kk){return function(t){t.dep=kk;};})(k));}
  dep([[3,1],[4,3],[3,4],[5,5],[7,6]],"ore");
  dep([[8,0],[8,2],[8,4],[7,5]],"ice");
  dep([[2,2],[5,1],[2,5],[6,6]],"silica");
  dep([[6,1],[1,4],[4,5]],"rare");
  set(4,2,function(t){t.wreck=true;});set(1,6,function(t){t.wreck=true;});set(7,3,function(t){t.wreck=true;});
  set(1,1,function(t){t.lava=true;});set(0,5,function(t){t.lava=true;});
  for(var i=0;i<tiles.length;i++){var t=tiles[i];t.nb=[];var D=nbDirs(t.r);for(var d=0;d<D.length;d++){var n=idOf[(t.q+D[d][0])+","+(t.r+D[d][1])];if(n!=null)t.nb.push(n);}}
  return {tiles:tiles,idOf:idOf};
}
function sunFactor(q){return 1-0.6*q/(W-1);}        /* left = sunward = stronger solar */

/* ---- building types (14 goods; 5 of them have two distinct producers) ---- */
var TYPES={
  solar:{bt:1,out:{power:3},solarScaled:true,cat:"pow"},
  reactor:{bt:2,in:{water:1,workers:1},out:{power:9},heat:3,radiation:true,cat:"pow"},
  radiator:{bt:1,coolOut:4,cat:"rad"},
  habitat:{bt:1,cap:5,radSensitive:true,lavaBonus:true,cat:"hab"},   /* housing capacity; pop lives here, not instant workers */
  oreMine:{bt:1,in:{power:1,workers:1},out:{ore:3},deposit:"ore",cat:"ext"},
  iceExtractor:{bt:1,in:{power:1,workers:1},out:{ice:3},deposit:"ice",cat:"ext"},
  silicaQuarry:{bt:1,in:{power:1,workers:1},out:{silica:3},deposit:"silica",cat:"ext"},
  rareMine:{bt:2,in:{power:2,workers:1},out:{rare:1},deposit:"rare",cat:"ext"},
  scrapper:{bt:2,in:{power:2,workers:1},out:{metal:2,rare:1},requiresWreck:true,cat:"ext"}, /* alt metal+rare, on wrecks */
  smelter:{bt:1,in:{ore:2,power:1,workers:1},out:{metal:2},heat:2,cat:"ref"},
  waterPlant:{bt:1,in:{ice:2,power:1,workers:1},out:{water:3},cat:"ref"},
  reclaimer:{bt:2,in:{power:1,workers:1},recycles:{from:"habitat",frac:0.6},cat:"ref"}, /* an adjacent Habitat recycles 60% of its water */
  greenhouse:{bt:1,in:{water:1,power:1,workers:1},out:{food:3},radSensitive:true,cat:"ref"},
  algaeVat:{bt:2,in:{power:2,workers:1},out:{food:2},cat:"ref"},                /* alt food: power-heavy, rad-proof */
  glassKiln:{bt:1,in:{silica:2,power:1,workers:1},out:{glass:2},heat:2,cat:"ref"},
  foundry:{bt:2,in:{metal:2,rare:1,power:1,workers:1},out:{alloy:2},heat:3,cat:"ref"},
  electronicsFab:{bt:2,in:{glass:1,rare:1,power:1,workers:2},out:{electronics:2},cat:"ref"},
  assembler:{bt:3,in:{alloy:1,electronics:1,power:1,workers:2},out:{components:2},heat:2,locked:true,cat:"adv"},
  lab:{bt:3,in:{components:1,power:1,workers:2},out:{research:2},locked:true,labSyn:true,cat:"adv"}
};
/* primary producer per good (alternates exist as extra buildings) */
var PRODUCER={power:"solar",workers:"habitat",food:"greenhouse",water:"waterPlant",ore:"oreMine",
  ice:"iceExtractor",silica:"silicaQuarry",rare:"rareMine",metal:"smelter",glass:"glassKiln",
  alloy:"foundry",electronics:"electronicsFab",components:"assembler",research:"lab"};
var NAME={solar:"Solar",reactor:"Reactor",radiator:"Radiator",habitat:"Habitat",oreMine:"Ore Mine",
  iceExtractor:"Ice Extractor",silicaQuarry:"Silica Quarry",rareMine:"Rare Mine",scrapper:"Scrapper",
  smelter:"Smelter",waterPlant:"Water Plant",reclaimer:"Reclaimer",greenhouse:"Greenhouse",algaeVat:"Algae Vat",
  glassKiln:"Glass Kiln",foundry:"Foundry",electronicsFab:"Electronics",assembler:"Assembler",lab:"Lab"};
var ABBR={solar:"So",reactor:"Rx",radiator:"Ra",habitat:"Hb",oreMine:"Or",iceExtractor:"Ic",silicaQuarry:"Si",
  rareMine:"Re",scrapper:"Sc",smelter:"Sm",waterPlant:"Wa",reclaimer:"Rc",greenhouse:"Gh",algaeVat:"Al",
  glassKiln:"Gl",foundry:"Fo",electronicsFab:"En",assembler:"As",lab:"Lb"};
var CATCOL={pow:"#e8c14a",rad:"#7f8da3",hab:"#5ad17a",ext:"#c08552",ref:"#5aa9ff",adv:"#b07ad6"};
var CATNAME={pow:"Power",rad:"Cooling",hab:"Housing",ext:"Extraction",ref:"Refining",adv:"Advanced"};
var ORDER=["solar","reactor","radiator","habitat","oreMine","iceExtractor","silicaQuarry","rareMine","scrapper",
  "smelter","waterPlant","reclaimer","greenhouse","algaeVat","glassKiln","foundry","electronicsFab","assembler","lab"];
var GOODORDER=["power","workers","food","water","ore","ice","silica","rare","metal","glass","alloy","electronics","components","research"];
var GOODS=(function(){var s={};for(var t in TYPES){var T=TYPES[t];for(var g in (T.in||{}))s[g]=1;for(var g2 in (T.out||{}))s[g2]=1;if(T.recycles)s[T.recycles.good]=1;}var a=[];for(var k in s)a.push(k);return a;})();

var COLO=0.22;                                       /* adjacency cluster bonus */
/* population: colonists are a persistent stock = your workforce. Habitats give
   capacity; immigration fills it over time, gated by life support. */
var LIFE={food:0.2,water:0.2,power:0.2};             /* per-capita life support demand (priority over industry) */
var HAB_CAP=5, IMMIG_BASE=2, RECY_FRAC=0.6;          /* a reclaimer-serviced habitat recycles 60% of its water */
function get(o,k){return o[k]||0;}

/* ---- adjacency / heat / radiation ---- */
function neighborsProduce(S,id){var t=S.map.tiles[id],set={};for(var i=0;i<t.nb.length;i++){var bi=S.occ[t.nb[i]];if(bi==null||bi<0)continue;var T=TYPES[S.buildings[bi].type];for(var g in (T.out||{}))set[g]=1;}return set;}
/* note: a Reclaimer's recycled output is intentionally NOT a cluster supplier —
   it draws from adjacent Habitats, so counting it would be a degenerate feedback loop. */
function neighborHasRadiation(S,id){var t=S.map.tiles[id];for(var i=0;i<t.nb.length;i++){var bi=S.occ[t.nb[i]];if(bi==null||bi<0)continue;if(TYPES[S.buildings[bi].type].radiation)return true;}return false;}
function countAdj(S,id,pred){var t=S.map.tiles[id],n=0;for(var i=0;i<t.nb.length;i++){var bi=S.occ[t.nb[i]];if(bi==null||bi<0)continue;if(pred(S.buildings[bi].type))n++;}return n;}
function clusterCount(S,type,id){var T=TYPES[type];if(!T.in)return 0;var np=neighborsProduce(S,id),mt=0;for(var g in T.in){if(g==="power"||g==="workers")continue;if(np[g])mt++;}return mt>3?3:mt;}
function adjMult(S,type,id){var T=TYPES[type],tile=S.map.tiles[id],m=1;
  m*=(1+COLO*clusterCount(S,type,id));
  if(T.labSyn)m*=1+0.25*countAdj(S,id,function(t){return t==="lab";})+0.10*countAdj(S,id,function(t){return t==="habitat";});
  if(T.solarScaled)m*=sunFactor(tile.q);
  if(T.lavaBonus&&tile.lava)m*=1.4;
  if(T.radSensitive&&!tile.lava&&neighborHasRadiation(S,id))m*=0.4;
  return m;}
function radiated(S,id){var t=S.map.tiles[id];return !t.lava&&neighborHasRadiation(S,id);}
/* a Habitat is "serviced" if it sits next to a Reclaimer — then it recycles part of its own
   water. The saving belongs to the Habitat (capped at its own use), so double-dipping is impossible. */
function habServiced(S,id){return countAdj(S,id,function(t){return !!TYPES[t].recycles;})>0;}
function reclaimServes(S,id){return countAdj(S,id,function(t){return TYPES[t].cat==="hab";});} /* adjacent habitats (for display) */
function habCapAt(S,id){var t=S.map.tiles[id];return HAB_CAP*(t.lava?1.4:(radiated(S,id)?0.4:1));}
function coolingAt(S,id){var tile=S.map.tiles[id],avail=0;
  for(var i=0;i<tile.nb.length;i++){var bi=S.occ[tile.nb[i]];if(bi==null||bi<0)continue;var rt=TYPES[S.buildings[bi].type];if(!rt.coolOut)continue;
    var em=countAdj(S,tile.nb[i],function(t){return TYPES[t].heat>0;});if(em<1)em=1;avail+=rt.coolOut/em;}
  return avail;}
function heatRatio(S,type,id){var T=TYPES[type];if(!T.heat)return 1;return Math.min(1,(1+coolingAt(S,id))/T.heat);}
/* total housing capacity (lava tubes hold more, irradiated tiles fewer) */
function capacityOf(S){var c=0;for(var i=0;i<S.buildings.length;i++){var b=S.buildings[i];if(!b||TYPES[b.type].cat!=="hab")continue;c+=habCapAt(S,b.tile);}return c;}

/* ---- flow solver: optimistic fixed-point throttling (tight convergence) ----
   Colonists (S.pop) supply workers exogenously and demand life support
   (food/water/power) with PRIORITY over industry. */
function effRates(S){var arr=[];for(var i=0;i<S.buildings.length;i++){var b=S.buildings[i];if(!b){arr.push(null);continue;}var T=TYPES[b.type];
  var hr=heatRatio(S,b.type,b.tile),m=adjMult(S,b.type,b.tile)*hr,oin={},oout={};
  for(var g in (T.in||{}))oin[g]=T.in[g]*hr;
  for(var g2 in (T.out||{}))oout[g2]=T.out[g2]*m;
  arr.push({in:oin,out:oout,heat:hr,mult:m});}return arr;}
/* life-support demand. Water is reduced in proportion to the housing capacity that is
   reclaimer-serviced: a serviced Habitat recycles `frac` of its residents' water. */
function lifeDemand(S){var pop=S.pop||0,L={food:pop*LIFE.food,power:pop*LIFE.power,water:pop*LIFE.water};
  var tot=0,serv=0;for(var i=0;i<S.buildings.length;i++){var b=S.buildings[i];if(!b||TYPES[b.type].cat!=="hab")continue;
    var c=habCapAt(S,b.tile);tot+=c;if(habServiced(S,b.tile))serv+=c;}
  if(tot>0)L.water*=(1-(serv/tot)*RECY_FRAC);
  return L;}
function solveFlows(S){var eff=effRates(S),n=eff.length,frac=[],i,g;for(i=0;i<n;i++)frac[i]=eff[i]?1:0;
  var pop=S.pop||0, L=lifeDemand(S);                         /* life-support demand (tier-0), minus reclaimer recycling */
  var prod,cons,ratio={};
  for(var it=0;it<200;it++){prod={workers:pop};cons={};        /* colonists supply labor */
    for(i=0;i<n;i++){if(!eff[i])continue;var f=frac[i];if(f<=0)continue;for(g in eff[i].out)prod[g]=get(prod,g)+eff[i].out[g]*f;for(g in eff[i].in)cons[g]=get(cons,g)+eff[i].in[g]*f;}
    ratio={};for(var gi=0;gi<GOODS.length;gi++){g=GOODS[gi];var avail=Math.max(0,get(prod,g)-get(L,g)),d=get(cons,g);ratio[g]=(d<=1e-12)?1:Math.min(1,avail/d);}
    var md=0;for(i=0;i<n;i++){if(!eff[i])continue;var r=1;for(g in eff[i].in)r=Math.min(r,ratio[g]==null?0:ratio[g]);var nf=0.5*frac[i]+0.5*r;md=Math.max(md,Math.abs(nf-frac[i]));frac[i]=nf;}
    if(md<1e-7)break;}
  prod={workers:pop};cons={};for(i=0;i<n;i++){if(!eff[i])continue;var f2=frac[i];if(f2<=0)continue;for(g in eff[i].out)prod[g]=get(prod,g)+eff[i].out[g]*f2;for(g in eff[i].in)cons[g]=get(cons,g)+eff[i].in[g]*f2;}
  var sur={};for(var gj=0;gj<GOODS.length;gj++){g=GOODS[gj];sur[g]=get(prod,g)-get(cons,g)-get(L,g);}
  var lifeMet=get(prod,"food")>=get(L,"food")-1e-6&&get(prod,"water")>=get(L,"water")-1e-6&&get(prod,"power")>=get(L,"power")-1e-6;
  return {prod:prod,cons:cons,surplus:sur,frac:frac,ratio:ratio,eff:eff,life:L,lifeMet:lifeMet,pop:pop,cap:capacityOf(S)};}
function limitingInput(S,R,i){var eff=R.eff[i];if(!eff||R.frac[i]>0.999)return null;var best=null,bv=2;
  for(var g in eff.in){var r=R.ratio[g]==null?0:R.ratio[g];if(r<bv){bv=r;best=g;}}return bv<0.999?best:null;}

/* ---- scenario ---- */
function scenario(){return {
  turns:18, buildRate:{1:1,2:1,3:0}, demolishRate:0, startPop:5,
  start:[["solar",0],["solar",0],["habitat",0],["iceExtractor",0],["waterPlant",0],["greenhouse",0]],
  /* score = optionals completed (stars). Required deadlines tightened to just-past the greedy's
     actual completion turns (was loose 24-turn slack); Metalworks grants +1 demolish/turn. */
  directives:[
    {id:"D1",name:"Provision",good:"food",rate:5,dur:2,deadline:5,req:[],must:true,reward:{buildRate:{1:1}},rp:40},
    {id:"D2",name:"Metalworks",good:"metal",rate:5,dur:2,deadline:7,req:["D1"],must:true,reward:{buildRate:{2:1},demolish:1},rp:70},
    {id:"D3",name:"Electronics",good:"electronics",rate:4,dur:2,deadline:10,req:["D2"],must:true,reward:{unlock:["assembler","lab"],buildRate:{3:1}},rp:120},
    {id:"D4",name:"Assembly",good:"components",rate:3,dur:3,deadline:15,req:["D3"],must:true,reward:{},rp:160},
    {id:"D5",name:"Datacore",good:"research",rate:3,dur:2,deadline:17,req:["D4"],must:true,reward:{},rp:260},
    {id:"D6",name:"Breakthrough",good:"research",rate:3,dur:2,deadline:10,req:[],must:false,reward:{},rp:50},
    {id:"D7",name:"Glassworks",good:"glass",rate:5,dur:2,deadline:8,req:[],must:false,reward:{},rp:50},
    {id:"D8",name:"Foodbelt",good:"food",rate:12,dur:2,deadline:10,req:[],must:false,reward:{},rp:50},
    {id:"D9",name:"Circuits",good:"electronics",rate:7,dur:2,deadline:17,req:[],must:false,reward:{},rp:50}
  ]};}

/* ---- placement helpers ---- */
function unlocked(S,t){return !TYPES[t].locked||S.unlocked[t];}
function occupied(S,id){return S.occ[id]!=null&&S.occ[id]>=0;}
function eligible(S,type,id){var T=TYPES[type],t=S.map.tiles[id];
  if(occupied(S,id))return false;
  if(T.requiresWreck)return !!t.wreck;
  if(t.wreck)return false;
  if(T.deposit&&t.dep!==T.deposit)return false;
  return true;}
function placeReason(S,type,id){
  if(!unlocked(S,type))return "locked — complete its directive first";
  if(get(S.placed,TYPES[type].bt)>=get(S.buildRate,TYPES[type].bt))return "no T"+TYPES[type].bt+" deliveries left this turn";
  var T=TYPES[type],t=S.map.tiles[id];
  if(occupied(S,id))return "tile occupied";
  if(T.requiresWreck)return t.wreck?null:"Scrapper must be built on a wreck tile";
  if(t.wreck)return "wreck tile — only a Scrapper can use it";
  if(T.deposit&&t.dep!==T.deposit)return "needs a "+T.deposit+" deposit";
  return null;}
function canPlace(S,type,id){var T=TYPES[type];if(!unlocked(S,type))return false;if(get(S.placed,T.bt)>=get(S.buildRate,T.bt))return false;return eligible(S,type,id);}
function placeAt(S,type,id){var idx=S.buildings.length;S.buildings.push({type:type,tile:id,turn:S.turn});S.occ[id]=idx;S.placed[TYPES[type].bt]=get(S.placed,TYPES[type].bt)+1;S.tilesUsed++;return idx;}
function prereqsDone(S,d){for(var i=0;i<d.req.length;i++)if(!S.done[d.req[i]])return false;return true;}

/* greedy start placement (positions the seed colony sensibly) */
function tileScore(S,type,id){var T=TYPES[type],t=S.map.tiles[id],s=0;
  if(!T.deposit&&t.dep)s-=6; if(!T.lavaBonus&&t.lava)s-=3; s+=(adjMult(S,type,id)-1)*10;
  if(T.solarScaled)s+=sunFactor(t.q)*3; return s;}
function bestTile(S,type){var best=-1,bs=-1e9;for(var id=0;id<S.map.tiles.length;id++){if(!eligible(S,type,id))continue;var sc=tileScore(S,type,id);if(sc>bs){bs=sc;best=id;}}return best;}

/* ---- game state ---- */
function newState(){
  var sc=scenario();
  var S={sc:sc,map:buildMap(),turn:1,buildings:[],occ:{},buildRate:Object.assign({},sc.buildRate),
     unlocked:{},placed:{},done:{},failed:{},progress:{},metNow:{},tilesUsed:0,
     demolishMax:sc.demolishRate||0,demolished:0,
     pop:sc.startPop,immig:IMMIG_BASE,lifeShort:false,grew:0,
     sel:null,selTile:-1,over:false,result:"",lastMsgs:[]};
  for(var i=0;i<sc.start.length;i++){var id=bestTile(S,sc.start[i][0]);if(id>=0)placeAt(S,sc.start[i][0],id);}
  S.placed={};
  return S;
}
function deliverable(S){var out=[];for(var i=0;i<S.sc.directives.length;i++){var d=S.sc.directives[i];if(S.done[d.id]||S.failed[d.id]||S.turn>d.deadline||!prereqsDone(S,d))continue;out.push(d);}return out;}
function applyReward(S,d){var r=d.reward||{};if(r.unlock)for(var i=0;i<r.unlock.length;i++)S.unlocked[r.unlock[i]]=1;
  if(r.buildRate)for(var bt in r.buildRate)S.buildRate[bt]=get(S.buildRate,bt)+r.buildRate[bt];if(r.immig)S.immig+=r.immig;if(r.demolish)S.demolishMax+=r.demolish;}
/* may an OLD building be dismantled this turn? (same-turn placements are free corrections) */
function canDemolish(S,id){var bi=S.occ[id];if(bi==null||bi<0)return false;var b=S.buildings[bi];if(b.turn===S.turn)return true;return S.demolished<S.demolishMax;}

/* a directive is met when the surplus, rounded the way the UI shows it (1 dp),
   meets the rate — so "what you see is what you get", no sub-integer gotchas. */
function meetsRate(have,rate){return Math.round(have*10)/10>=rate;}
function processEndTurn(S){
  if(S.over)return {msgs:[],over:true};
  var R=solveFlows(S), avail=Object.assign({},R.surplus), msgs=[];
  S.metNow={};
  var act=deliverable(S).slice().sort(function(a,b){if(a.must!==b.must)return a.must?-1:1;return a.deadline-b.deadline;});
  for(var i=0;i<act.length;i++){var d=act[i];
    if(meetsRate(get(avail,d.good),d.rate)){
      avail[d.good]=get(avail,d.good)-d.rate; S.metNow[d.id]=1;
      S.progress[d.id]=get(S.progress,d.id)+1;
      if(S.progress[d.id]>=d.dur){S.done[d.id]="done";msgs.push("✓ "+d.id+" "+d.name+" complete");applyReward(S,d);}
    }
  }
  for(i=0;i<S.sc.directives.length;i++){var dd=S.sc.directives[i];if(S.done[dd.id]||S.failed[dd.id])continue;
    if(S.turn>=dd.deadline&&get(S.progress,dd.id)<dd.dur){S.failed[dd.id]="fail";if(dd.must)msgs.push("✗ "+dd.id+" "+dd.name+" FAILED");}}
  var lost=false;for(i=0;i<S.sc.directives.length;i++){if(S.sc.directives[i].must&&S.failed[S.sc.directives[i].id])lost=true;}
  var allMust=true;for(i=0;i<S.sc.directives.length;i++){var x=S.sc.directives[i];if(x.must&&S.done[x.id]!=="done")allMust=false;}
  /* the run is OVER only when every directive is resolved (done, or failed past its deadline) — NOT
     the instant the required ones are met. That lets optionals still be completed afterwards, up to
     their own deadlines: finishing required no longer forfeits the optionals you could still earn. */
  var allDone=true;for(i=0;i<S.sc.directives.length;i++){var y=S.sc.directives[i];if(!S.done[y.id]&&!S.failed[y.id])allDone=false;}
  /* population: immigration fills housing if life support held; otherwise paused (pop holds) */
  S.lifeShort=!R.lifeMet; S.grew=0;
  /* score = STAR RATING = number of OPTIONAL directives completed (required ones are the entry bar,
     worth 0; failing any required is a defeat). Completing all required with no optionals is a 0-star win. */
  var optTot=0,optDone=0;
  for(i=0;i<S.sc.directives.length;i++){var od=S.sc.directives[i];if(!od.must){optTot++;if(S.done[od.id]==="done")optDone++;}}
  var stars="★".repeat(optDone)+"☆".repeat(optTot-optDone);
  var verdict="WIN "+(optTot?stars+" — ":"")+optDone+"/"+optTot+" optional"+(optTot===1?"":"s");
  if(lost){S.over=true;S.result="DEFEAT — "+(msgs.filter(function(m){return m.indexOf("FAILED")>=0;})[0]||"required directive failed");}
  else if(allDone){S.over=true;S.result=verdict;}  /* not lost + all resolved => all required done */
  else { S.turn++; S.placed={}; S.demolished=0; S.sel=null; S.selTile=-1;
    if(R.lifeMet){var room=R.cap-S.pop;if(room>0){S.grew=Math.min(S.immig,room);S.pop+=S.grew;}}
    else msgs.push("⚠ life support short — immigration paused");
    if(S.turn>S.sc.turns){S.over=true;S.result=allMust?verdict:"DEFEAT — ran out of turns";} }
  S.lastMsgs=msgs;
  return {msgs:msgs,over:S.over,result:S.result};
}

root.COMPOUND={
  W:W,H:H,TYPES:TYPES,PRODUCER:PRODUCER,NAME:NAME,ABBR:ABBR,CATCOL:CATCOL,CATNAME:CATNAME,
  ORDER:ORDER,GOODORDER:GOODORDER,GOODS:GOODS,COLO:COLO,LIFE:LIFE,HAB_CAP:HAB_CAP,IMMIG_BASE:IMMIG_BASE,RECY_FRAC:RECY_FRAC,
  sunFactor:sunFactor,buildMap:buildMap,get:get,capacityOf:capacityOf,
  neighborsProduce:neighborsProduce,neighborHasRadiation:neighborHasRadiation,countAdj:countAdj,
  clusterCount:clusterCount,adjMult:adjMult,radiated:radiated,habServiced:habServiced,reclaimServes:reclaimServes,habCapAt:habCapAt,coolingAt:coolingAt,heatRatio:heatRatio,
  effRates:effRates,solveFlows:solveFlows,limitingInput:limitingInput,lifeDemand:lifeDemand,scenario:scenario,
  unlocked:unlocked,eligible:eligible,placeReason:placeReason,canPlace:canPlace,canDemolish:canDemolish,
  placeAt:placeAt,prereqsDone:prereqsDone,tileScore:tileScore,bestTile:bestTile,
  newState:newState,deliverable:deliverable,applyReward:applyReward,processEndTurn:processEndTurn,meetsRate:meetsRate
};
})(typeof module!=="undefined"&&module.exports?module.exports:(this.window?window:this));
