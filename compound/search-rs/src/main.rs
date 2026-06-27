// COMPOUND — CANONICAL mechanics + greedy AI + search (Rust).
// This is the design/balancing lab and the source of truth for the rules: the
// deterministic map, the flow solver, processEndTurn (run-to-deadlines end rule),
// the scenario/economy, the greedy heuristic (port of balance.js), and a parallel
// beam search. Iterate on ANYTHING here (recipes, map, life-support, economy) and
// both AIs reflect it immediately. compound/engine.js (the playable game) is synced
// from this when a design settles; it was validated identical (greedy + a found
// order reproduce the same directive turns / 800).
//
// METRIC: number of directives passed (each 1/0). The search MAXIMIZES it; the gap we care about
// is search_count - greedy_count (a directive set is "good" when the optimal passes all but the
// greedy falls short). Setup-independent, unlike arbitrary prestige.
//
// modes:  search   -> beam search, print best #directives + build order
//         greedy   -> run the greedy heuristic, print #directives + per-directive turns
//         gap      -> run both on the built-in scenario, print greedy/search counts and the gap
//         sweep    -> run greedy+search over variants() (hand-listed directive sets), tabulate gaps
//         gen      -> GENERATE directive sets (fixed required spine + K sampled optionals); keep
//                     those the optimal passes fully but greedy doesn't; rank by gap
//         validate -> replay a fixed historical order (engine self-check)
//         nobuild  -> start colony only, per-turn trace
//   env:  BEAM (2000; gen 250) PLANCAP (400) HORIZON (=turns); GENN GENK SEED; PARAMS=<file>

use std::env;

const W: i32 = 9;
const H: i32 = 7;
const NT: usize = 63; // tiles
const NG: usize = 14; // goods
const NB: usize = 19; // building types

// goods
const POWER:usize=0; const WORKERS:usize=1; const FOOD:usize=2; const WATER:usize=3;
const ORE:usize=4; const ICE:usize=5; const SILICA:usize=6; const RARE:usize=7;
const METAL:usize=8; const GLASS:usize=9; const ALLOY:usize=10; const ELEC:usize=11;
const COMP:usize=12; const RESEARCH:usize=13;

// building types (ORDER)
const SOLAR:usize=0; const REACTOR:usize=1; const RADIATOR:usize=2; const HABITAT:usize=3;
const OREMINE:usize=4; const ICEX:usize=5; const SILICAQ:usize=6; const RAREMINE:usize=7;
const SCRAPPER:usize=8; const SMELTER:usize=9; const WATERPLANT:usize=10; const RECLAIMER:usize=11;
const GREENHOUSE:usize=12; const ALGAE:usize=13; const GLASSKILN:usize=14; const FOUNDRY:usize=15;
const EFAB:usize=16; const ASSEMBLER:usize=17; const LAB:usize=18;

const ABBR: [&str; NB] = ["So","Rx","Ra","Hb","Or","Ic","Si","Re","Sc","Sm","Wa","Rc","Gh","Al","Gl","Fo","En","As","Lb"];
const GOODNAME: [&str; NG] = ["pow","wrk","food","water","ore","ice","sil","rare","metal","glass","alloy","elec","comp","rsch"];

// deterministic RNG (xorshift64) for reproducible directive sampling
fn xs(s:&mut u64)->u64 { *s^=*s<<13; *s^=*s>>7; *s^=*s<<17; *s }
fn rng_range(s:&mut u64, lo:i64, hi:i64)->i64 { lo + (xs(s)%(((hi-lo+1).max(1)) as u64)) as i64 }

#[derive(Clone)]
struct Btype {
    bt: usize,
    inp: [f64; NG],
    out: [f64; NG],
    heat: f64,
    cap: f64,        // habitat base capacity (0 if not housing)
    is_hab: bool,
    radiation: bool, // emits radiation (reactor)
    cool_out: f64,   // radiator
    solar_scaled: bool,
    lava_bonus: bool,
    rad_sensitive: bool,
    lab_syn: bool,
    deposit: i32,    // required deposit good-index, or -1
    requires_wreck: bool,
    recycles: bool,  // reclaimer
    locked: bool,
    in_idx: Vec<usize>,  // sparse: good indices this type consumes / produces (perf for solve hot loop)
    out_idx: Vec<usize>,
}
fn z() -> [f64; NG] { [0.0; NG] }
fn btypes() -> Vec<Btype> {
    let base = Btype{bt:1,inp:z(),out:z(),heat:0.0,cap:0.0,is_hab:false,radiation:false,cool_out:0.0,
        solar_scaled:false,lava_bonus:false,rad_sensitive:false,lab_syn:false,deposit:-1,requires_wreck:false,recycles:false,locked:false,
        in_idx:vec![],out_idx:vec![]};
    let mut v = vec![base.clone(); NB];
    macro_rules! set { ($i:expr, $($f:ident : $val:expr),*) => { { let b=&mut v[$i]; $(b.$f=$val;)* } } }
    // solar
    set!(SOLAR, bt:1, solar_scaled:true); v[SOLAR].out[POWER]=3.0;
    // reactor
    set!(REACTOR, bt:2, heat:3.0, radiation:true); v[REACTOR].inp[WATER]=1.0; v[REACTOR].inp[WORKERS]=1.0; v[REACTOR].out[POWER]=9.0;
    // radiator
    set!(RADIATOR, bt:1, cool_out:4.0);
    // habitat
    set!(HABITAT, bt:1, cap:5.0, is_hab:true, rad_sensitive:true, lava_bonus:true);
    // oreMine
    set!(OREMINE, bt:1, deposit:ORE as i32); v[OREMINE].inp[POWER]=1.0; v[OREMINE].inp[WORKERS]=1.0; v[OREMINE].out[ORE]=3.0;
    // iceExtractor
    set!(ICEX, bt:1, deposit:ICE as i32); v[ICEX].inp[POWER]=1.0; v[ICEX].inp[WORKERS]=1.0; v[ICEX].out[ICE]=3.0;
    // silicaQuarry
    set!(SILICAQ, bt:1, deposit:SILICA as i32); v[SILICAQ].inp[POWER]=1.0; v[SILICAQ].inp[WORKERS]=1.0; v[SILICAQ].out[SILICA]=3.0;
    // rareMine
    set!(RAREMINE, bt:2, deposit:RARE as i32); v[RAREMINE].inp[POWER]=2.0; v[RAREMINE].inp[WORKERS]=1.0; v[RAREMINE].out[RARE]=1.0;
    // scrapper
    set!(SCRAPPER, bt:2, requires_wreck:true); v[SCRAPPER].inp[POWER]=2.0; v[SCRAPPER].inp[WORKERS]=1.0; v[SCRAPPER].out[METAL]=2.0; v[SCRAPPER].out[RARE]=1.0;
    // smelter
    set!(SMELTER, bt:1, heat:2.0); v[SMELTER].inp[ORE]=2.0; v[SMELTER].inp[POWER]=1.0; v[SMELTER].inp[WORKERS]=1.0; v[SMELTER].out[METAL]=2.0;
    // waterPlant
    set!(WATERPLANT, bt:1); v[WATERPLANT].inp[ICE]=2.0; v[WATERPLANT].inp[POWER]=1.0; v[WATERPLANT].inp[WORKERS]=1.0; v[WATERPLANT].out[WATER]=3.0;
    // reclaimer
    set!(RECLAIMER, bt:2, recycles:true); v[RECLAIMER].inp[POWER]=1.0; v[RECLAIMER].inp[WORKERS]=1.0;
    // greenhouse
    set!(GREENHOUSE, bt:1, rad_sensitive:true); v[GREENHOUSE].inp[WATER]=1.0; v[GREENHOUSE].inp[POWER]=1.0; v[GREENHOUSE].inp[WORKERS]=1.0; v[GREENHOUSE].out[FOOD]=3.0;
    // algaeVat
    set!(ALGAE, bt:2); v[ALGAE].inp[POWER]=2.0; v[ALGAE].inp[WORKERS]=1.0; v[ALGAE].out[FOOD]=2.0;
    // glassKiln
    set!(GLASSKILN, bt:1, heat:2.0); v[GLASSKILN].inp[SILICA]=2.0; v[GLASSKILN].inp[POWER]=1.0; v[GLASSKILN].inp[WORKERS]=1.0; v[GLASSKILN].out[GLASS]=2.0;
    // foundry
    set!(FOUNDRY, bt:2, heat:3.0); v[FOUNDRY].inp[METAL]=2.0; v[FOUNDRY].inp[RARE]=1.0; v[FOUNDRY].inp[POWER]=1.0; v[FOUNDRY].inp[WORKERS]=1.0; v[FOUNDRY].out[ALLOY]=2.0;
    // electronicsFab
    set!(EFAB, bt:2); v[EFAB].inp[GLASS]=1.0; v[EFAB].inp[RARE]=1.0; v[EFAB].inp[POWER]=1.0; v[EFAB].inp[WORKERS]=2.0; v[EFAB].out[ELEC]=2.0;
    // assembler
    set!(ASSEMBLER, bt:3, heat:2.0, locked:true); v[ASSEMBLER].inp[ALLOY]=1.0; v[ASSEMBLER].inp[ELEC]=1.0; v[ASSEMBLER].inp[POWER]=1.0; v[ASSEMBLER].inp[WORKERS]=2.0; v[ASSEMBLER].out[COMP]=2.0;
    // lab
    set!(LAB, bt:3, locked:true, lab_syn:true); v[LAB].inp[COMP]=1.0; v[LAB].inp[POWER]=1.0; v[LAB].inp[WORKERS]=2.0; v[LAB].out[RESEARCH]=2.0;
    for b in v.iter_mut() {
        b.in_idx =(0..NG).filter(|&g| b.inp[g]>0.0).collect();
        b.out_idx=(0..NG).filter(|&g| b.out[g]>0.0).collect();
    }
    v
}

const COLO: f64 = 0.22;
const LIFE: [f64; NG] = {
    let mut a = [0.0; NG]; a[FOOD]=0.2; a[WATER]=0.2; a[POWER]=0.2; a
};
const RECY_FRAC: f64 = 0.6;
const IMMIG_BASE: u32 = 2;

struct Tile { q:i32, r:i32, dep:i32, lava:bool, wreck:bool, nb:Vec<usize> }
struct Map { tiles: Vec<Tile> }

fn nb_dirs(r:i32) -> [(i32,i32);6] {
    if r & 1 == 1 { [(1,0),(1,-1),(0,-1),(-1,0),(0,1),(1,1)] }
    else { [(1,0),(0,-1),(-1,-1),(-1,0),(-1,1),(0,1)] }
}
fn build_map() -> Map {
    let id_of = |q:i32,r:i32| -> Option<usize> { if q>=0&&q<W&&r>=0&&r<H { Some((r*W+q) as usize) } else { None } };
    let mut tiles: Vec<Tile> = Vec::with_capacity(NT);
    for r in 0..H { for q in 0..W { tiles.push(Tile{q,r,dep:-1,lava:false,wreck:false,nb:vec![]}); } }
    let setdep = |tiles:&mut Vec<Tile>, list:&[(i32,i32)], k:i32| { for &(q,r) in list { if let Some(i)=id_of(q,r){tiles[i].dep=k;} } };
    setdep(&mut tiles, &[(3,1),(4,3),(3,4),(5,5),(7,6)], ORE as i32);
    setdep(&mut tiles, &[(8,0),(8,2),(8,4),(7,5)], ICE as i32);
    setdep(&mut tiles, &[(2,2),(5,1),(2,5),(6,6)], SILICA as i32);
    setdep(&mut tiles, &[(6,1),(1,4),(4,5)], RARE as i32);
    for &(q,r) in &[(4,2),(1,6),(7,3)] { if let Some(i)=id_of(q,r){tiles[i].wreck=true;} }
    for &(q,r) in &[(1,1),(0,5)] { if let Some(i)=id_of(q,r){tiles[i].lava=true;} }
    for i in 0..NT { let (q,r)=(tiles[i].q,tiles[i].r); let mut nb=vec![];
        for (dq,dr) in nb_dirs(r) { if let Some(n)=id_of(q+dq,r+dr){nb.push(n);} } tiles[i].nb=nb; }
    Map{tiles}
}
fn sun_factor(q:i32) -> f64 { 1.0 - 0.6*(q as f64)/((W-1) as f64) }

// ---- directives / scenario ----
#[derive(Clone)]
struct Directive { good:usize, rate:f64, dur:u32, deadline:u32, req:Vec<usize>, must:bool,
    rew_build:[i32;4], rew_immig:u32, rew_unlock:bool, rew_demolish:i32, rp:f64 }
fn scenario() -> Vec<Directive> {
    // rewards: D3 unlocks assembler+lab and grants +1 T3; D1->+1T1, D2->+1T2 and +1 demolish/turn.
    let mk = |good,rate,dur,deadline,req:Vec<usize>,must,rb:[i32;4],immig,unlock,rp|
        Directive{good,rate,dur,deadline,req,must,rew_build:rb,rew_immig:immig,rew_unlock:unlock,rew_demolish:0,rp};
    // loose feasible baseline (re-derive gap-4 via `hill` + `tighten` under the corrected worker model)
    let mut v = vec![
        mk(FOOD,4.0,2,6,vec![],true,[0,1,0,0],0,false,40.0),       // D1
        mk(METAL,4.0,2,9,vec![0],true,[0,0,1,0],0,false,70.0),     // D2
        mk(ELEC,3.0,2,12,vec![1],true,[0,0,0,1],0,true,120.0),     // D3 (unlock + T3)
        mk(COMP,3.0,2,16,vec![2],true,[0,0,0,0],0,false,160.0),    // D4 components
        mk(RESEARCH,3.0,2,18,vec![3],true,[0,0,0,0],0,false,260.0),// D5 research
        mk(RESEARCH,3.0,2,12,vec![],false,[0,0,0,0],0,false,50.0), // D6 opt research
        mk(WATER,6.0,2,14,vec![],false,[0,0,0,0],0,false,50.0),    // D7 opt water
        mk(ELEC,4.0,2,16,vec![],false,[0,0,0,0],0,false,50.0),     // D8 opt elec
        mk(ALLOY,3.0,2,16,vec![],false,[0,0,0,0],0,false,50.0),    // D9 opt alloy
    ];
    v[1].rew_demolish = 1;  // Metalworks grants +1 demolish/turn (matches engine.js)
    v
}
const TURNS: u32 = 18;

// Directive-set variants to sweep (mechanics held constant). Each returns (name, economy, directives).
// Index map: D1=0 D2=1 D3=2 D4=3(opt water) D5=4 D6=5(opt food) D7=6. Edit/extend freely.
fn variants() -> Vec<(String, Econ, Vec<Directive>)> {
    let e = default_econ();
    let base = || scenario();
    let mut out: Vec<(String, Econ, Vec<Directive>)> = Vec::new();
    out.push(("baseline".into(), e.clone(), base()));
    // optional-vs-critical-path tension: tighten / loosen the water optional's deadline
    { let mut s=base(); s[3].deadline=9;  out.push(("D4 water dl 9".into(),  e.clone(), s)); }
    { let mut s=base(); s[3].deadline=10; out.push(("D4 water dl 10".into(), e.clone(), s)); }
    { let mut s=base(); s[3].deadline=13; out.push(("D4 water dl 13".into(), e.clone(), s)); }
    { let mut s=base(); s[3].rate=12.0;   out.push(("D4 water rate 12".into(),e.clone(), s)); }
    // long-pole optional (food) — earlier deadline / higher rate
    { let mut s=base(); s[5].deadline=14; out.push(("D6 food dl 14".into(),  e.clone(), s)); }
    { let mut s=base(); s[5].rate=18.0;   out.push(("D6 food rate 18".into(), e.clone(), s)); }
    // harder long-pole required: components sustain longer / research demands more labs
    { let mut s=base(); s[4].dur=4;       out.push(("D5 comp dur 4".into(),   e.clone(), s)); }
    { let mut s=base(); s[6].rate=6.0;    out.push(("D7 research rate 6".into(),e.clone(), s)); }
    { let mut s=base(); s[6].rate=8.0; s[6].dur=3; out.push(("D7 research 8/d3".into(), e.clone(), s)); }
    // reward-timing: D3 grants its tier-3 later (move to D5) — does deferring it widen the gap?
    { let mut s=base(); s[2].rew_build=[0,0,0,0]; s[4].rew_build=[0,0,0,1]; out.push(("T3 reward on D5".into(), e.clone(), s)); }
    out
}

// economy knobs (the things we iterate on). Loaded from params.txt when present so engine.js stays
// the single source of truth; falls back to these defaults otherwise.
#[derive(Clone)]
struct Econ { build_rate:[u8;4], immig:u32, start_pop:f64, demolish_rate:i32 }
fn default_econ() -> Econ { Econ{ build_rate:[0,1,1,0], immig:2, start_pop:5.0, demolish_rate:0 } }

// params.txt format (good = GOODORDER index, matching the good consts above):
//   buildRate <t1> <t2> <t3>
//   immig <n>
//   startPop <n>
//   dir <good> <rate> <dur> <deadline> <must> <rb1> <rb2> <rb3> <immigR> <unlock> <rp> [req...]
fn load_params(path:&str) -> Option<(Econ, Vec<Directive>)> {
    let txt = std::fs::read_to_string(path).ok()?;
    let mut econ = default_econ(); let mut dirs = Vec::new();
    for line in txt.lines() {
        let t:Vec<&str> = line.split_whitespace().collect();
        if t.is_empty() { continue; }
        match t[0] {
            "buildRate" => econ.build_rate=[0, t[1].parse().unwrap(), t[2].parse().unwrap(), t[3].parse().unwrap()],
            "immig" => econ.immig = t[1].parse().unwrap(),
            "startPop" => econ.start_pop = t[1].parse().unwrap(),
            "dir" => {
                let g:usize=t[1].parse().unwrap();
                let rb=[0, t[6].parse().unwrap(), t[7].parse().unwrap(), t[8].parse().unwrap()];
                let req:Vec<usize> = t[12..].iter().map(|x| x.parse().unwrap()).collect();
                dirs.push(Directive{ good:g, rate:t[2].parse().unwrap(), dur:t[3].parse().unwrap(),
                    deadline:t[4].parse().unwrap(), req, must:t[5]=="1", rew_build:rb,
                    rew_immig:t[9].parse().unwrap(), rew_unlock:t[10]=="1", rew_demolish:0, rp:t[11].parse().unwrap() });
            }
            _ => {}
        }
    }
    if dirs.is_empty() { return None; }
    Some((econ, dirs))
}

#[derive(Clone, Copy, Default)]
struct Building { ty:u8, tile:u16 }
const BCAP: usize = 64;   // max buildings (<= 63 tiles); fixed array keeps State Copy (no heap clone)

#[derive(Clone, Copy)]
struct State {
    bld: [Building; BCAP], nb: usize,
    occ: [i32; NT],
    placed: [u8;4],
    build_rate: [u8;4],
    unlocked: [bool; NB],
    done: [bool;16], failed: [bool;16], progress: [u8;16],
    prestige: f64, pop: f64, immig: u32, turn: u32,
    demolish_max: i32, demolished: i32,   // per-turn dismantle allowance (of OLD buildings)
    over: bool,
    eval_sur: [f64;NG], eval_life: bool,  // stashed from end_turn's solve, reused by score (avoids a 2nd solve)
}

struct Eng { bt: Vec<Btype>, map: Map, elig: Vec<Vec<usize>> }

impl Eng {
    fn new() -> Eng {
        let bt=btypes(); let map=build_map();
        // precompute, per type, the tiles that are statically eligible (deposit/wreck constraints,
        // ignoring occupancy) — so best_tile_mult scans 3-5 tiles for extractors instead of all 63.
        let mut elig=vec![Vec::new(); NB];
        for t in 0..NB { let b=&bt[t];
            for id in 0..NT { let tile=&map.tiles[id];
                let ok = if b.requires_wreck { tile.wreck }
                    else if tile.wreck { false }
                    else if b.deposit>=0 { tile.dep==b.deposit }
                    else { true };
                if ok { elig[t].push(id); } } }
        Eng{ bt, map, elig }
    }

    fn unlocked(&self, s:&State, t:usize) -> bool { !self.bt[t].locked || s.unlocked[t] }
    fn eligible(&self, s:&State, t:usize, id:usize) -> bool {
        if s.occ[id] >= 0 { return false; }
        let tile = &self.map.tiles[id]; let b = &self.bt[t];
        if b.requires_wreck { return tile.wreck; }
        if tile.wreck { return false; }
        if b.deposit >= 0 && tile.dep != b.deposit { return false; }
        true
    }
    fn neighbor_has_radiation(&self, s:&State, id:usize) -> bool {
        for &n in &self.map.tiles[id].nb { let bi=s.occ[n]; if bi<0 {continue;}
            if self.bt[s.bld[bi as usize].ty as usize].radiation { return true; } }
        false
    }
    fn count_adj<F:Fn(usize)->bool>(&self, s:&State, id:usize, pred:F) -> i32 {
        let mut n=0; for &nb in &self.map.tiles[id].nb { let bi=s.occ[nb]; if bi<0 {continue;}
            if pred(s.bld[bi as usize].ty as usize) { n+=1; } } n
    }
    fn cluster_count(&self, s:&State, t:usize, id:usize) -> f64 {
        let b=&self.bt[t]; let has_in = b.inp.iter().any(|&x| x>0.0); if !has_in { return 0.0; }
        let mut np=[false;NG];
        for &nb in &self.map.tiles[id].nb { let bi=s.occ[nb]; if bi<0{continue;}
            let ob=&self.bt[s.bld[bi as usize].ty as usize];
            for &g in &ob.out_idx { np[g]=true; } }   // sparse: only goods this neighbor produces
        let mut mt=0; for &g in &b.in_idx { if g==POWER||g==WORKERS {continue;} if np[g] { mt+=1; } }
        if mt>3 {3.0} else {mt as f64}
    }
    fn adj_mult(&self, s:&State, t:usize, id:usize) -> f64 {
        let b=&self.bt[t]; let tile=&self.map.tiles[id]; let mut m=1.0;
        m *= 1.0 + COLO*self.cluster_count(s,t,id);
        if b.lab_syn {
            let labs=self.count_adj(s,id,|x| x==LAB) as f64;
            let habs=self.count_adj(s,id,|x| x==HABITAT) as f64;
            m *= 1.0 + 0.25*labs + 0.10*habs;
        }
        if b.solar_scaled { m *= sun_factor(tile.q); }
        if b.lava_bonus && tile.lava { m *= 1.4; }
        if b.rad_sensitive && !tile.lava && self.neighbor_has_radiation(s,id) { m *= 0.4; }
        m
    }
    fn cooling_at(&self, s:&State, id:usize) -> f64 {
        let mut avail=0.0;
        for &nb in &self.map.tiles[id].nb { let bi=s.occ[nb]; if bi<0{continue;}
            let rt=&self.bt[s.bld[bi as usize].ty as usize]; if rt.cool_out<=0.0 {continue;}
            let mut em=self.count_adj(s,nb,|x| self.bt[x].heat>0.0); if em<1 {em=1;}
            avail += rt.cool_out/(em as f64);
        }
        avail
    }
    fn heat_ratio(&self, s:&State, t:usize, id:usize) -> f64 {
        let h=self.bt[t].heat; if h<=0.0 {return 1.0;}
        let r=(1.0+self.cooling_at(s,id))/h; if r<1.0 {r} else {1.0}
    }
    fn radiated(&self, s:&State, id:usize) -> bool { !self.map.tiles[id].lava && self.neighbor_has_radiation(s,id) }
    fn hab_serviced(&self, s:&State, id:usize) -> bool { self.count_adj(s,id,|x| self.bt[x].recycles)>0 }
    fn hab_cap_at(&self, s:&State, id:usize) -> f64 {
        let tile=&self.map.tiles[id]; 5.0*(if tile.lava {1.4} else if self.radiated(s,id){0.4} else {1.0})
    }
    fn capacity(&self, s:&State) -> f64 {
        let mut c=0.0; for b in &s.bld[..s.nb] { if self.bt[b.ty as usize].is_hab { c+=self.hab_cap_at(s,b.tile as usize); } } c
    }
    fn life_demand(&self, s:&State) -> [f64;NG] {
        let mut l=[0.0;NG]; l[FOOD]=s.pop*LIFE[FOOD]; l[POWER]=s.pop*LIFE[POWER]; l[WATER]=s.pop*LIFE[WATER];
        let (mut tot, mut serv)=(0.0,0.0);
        for b in &s.bld[..s.nb] { if self.bt[b.ty as usize].is_hab { let c=self.hab_cap_at(s,b.tile as usize); tot+=c; if self.hab_serviced(s,b.tile as usize){serv+=c;} } }
        if tot>0.0 { l[WATER] *= 1.0-(serv/tot)*RECY_FRAC; }
        l
    }

    // returns surplus[NG], life_met, ratio[NG]
    fn solve(&self, s:&State) -> ([f64;NG], bool, [f64;NG]) {
        let n=s.nb;
        // per-building type + effective input/output multipliers (computed once; iteration is sparse)
        let mut ty=vec![0usize;n]; let mut hr=vec![0.0f64;n]; let mut m=vec![0.0f64;n];
        for i in 0..n { let t=s.bld[i].ty as usize; let id=s.bld[i].tile as usize;
            let h=self.heat_ratio(s,t,id); ty[i]=t; hr[i]=h; m[i]=self.adj_mult(s,t,id)*h; }
        let l=self.life_demand(s);
        // Workers are allocated by a uniform throttle on *nominal* demand, frozen: every consumer is
        // cut by the same ratio, and labor is never reclaimed when a building turns out throttled.
        // Demand is the RAW worker requirement (not scaled by heat) — a building reserves its full
        // labor regardless of any throttle, so heat-capped buildings still tie up their workers.
        let wr = { let mut wd=0.0; for i in 0..n { wd += self.bt[ty[i]].inp[WORKERS]; }
            if wd<=1e-12 {1.0} else {(s.pop/wd).min(1.0)} };
        let mut frac=vec![1.0f64; n];
        let mut ratio=[1.0f64;NG];
        for _ in 0..200 {
            let mut prod=[0.0f64;NG]; prod[WORKERS]=s.pop; let mut cons=[0.0f64;NG];
            for i in 0..n { let f=frac[i]; if f<=0.0 {continue;} let b=&self.bt[ty[i]];
                for &g in &b.out_idx { prod[g]+=b.out[g]*m[i]*f; }
                for &g in &b.in_idx  { cons[g]+=b.inp[g]*hr[i]*f; } }
            for g in 0..NG { let avail=(prod[g]-l[g]).max(0.0); let d=cons[g];
                ratio[g]= if d<=1e-12 {1.0} else {(avail/d).min(1.0)}; }
            ratio[WORKERS]=wr;
            let mut md=0.0;
            for i in 0..n { let b=&self.bt[ty[i]]; let mut r=1.0f64;
                for &g in &b.in_idx { if ratio[g]<r {r=ratio[g];} }
                let nf=0.5*frac[i]+0.5*r; let d=(nf-frac[i]).abs(); if d>md {md=d;} frac[i]=nf; }
            if md<1e-7 { break; }
        }
        let mut prod=[0.0f64;NG]; prod[WORKERS]=s.pop; let mut cons=[0.0f64;NG];
        for i in 0..n { let f=frac[i]; if f<=0.0 {continue;} let b=&self.bt[ty[i]];
            for &g in &b.out_idx { prod[g]+=b.out[g]*m[i]*f; }
            for &g in &b.in_idx  { cons[g]+=b.inp[g]*hr[i]*f; } }
        let mut sur=[0.0;NG]; for g in 0..NG { sur[g]=prod[g]-cons[g]-l[g]; }
        let life_met = prod[FOOD]>=l[FOOD]-1e-6 && prod[WATER]>=l[WATER]-1e-6 && prod[POWER]>=l[POWER]-1e-6;
        (sur, life_met, ratio)
    }

    fn place(&self, s:&mut State, t:usize, id:usize) {
        let idx=s.nb; s.bld[idx]=Building{ty:t as u8, tile:id as u16}; s.nb+=1;
        s.occ[id]=idx as i32; s.placed[self.bt[t].bt]+=1;
    }
    // dismantle the building on `tile` (swap_remove keeps bld dense; fix occ for the moved building)
    fn demolish_at(&self, s:&mut State, tile:usize) {
        let bi=s.occ[tile]; if bi<0 {return;} let bi=bi as usize;
        s.occ[tile]=-1;
        s.nb-=1; let last=s.bld[s.nb];           // manual swap_remove on the fixed array
        if bi<s.nb { s.bld[bi]=last; s.occ[last.tile as usize]=bi as i32; }
        s.demolished+=1;
    }

    fn prereqs_done(&self, s:&State, sc:&[Directive], d:usize) -> bool {
        for &r in &sc[d].req { if !s.done[r] {return false;} } true
    }
    fn deliverable(&self, s:&State, sc:&[Directive], d:usize) -> bool {
        !s.done[d] && !s.failed[d] && s.turn<=sc[d].deadline && self.prereqs_done(s,sc,d)
    }

    // process end of turn (mutates s). returns nothing; sets s.over/result-ish.
    fn end_turn(&self, s:&mut State, sc:&[Directive]) {
        if s.over { return; }
        let (sur,life_met,_) = self.solve(s);
        s.eval_sur = sur; s.eval_life = life_met;   // stash for score() to reuse
        let mut avail = sur;
        // act = deliverable, sorted must-first then deadline asc
        let mut act: Vec<usize> = (0..sc.len()).filter(|&d| self.deliverable(s,sc,d)).collect();
        act.sort_by(|&a,&b| {
            if sc[a].must != sc[b].must { return if sc[a].must {std::cmp::Ordering::Less} else {std::cmp::Ordering::Greater}; }
            sc[a].deadline.cmp(&sc[b].deadline)
        });
        for &d in &act {
            let g=sc[d].good;
            let r=(avail[g]*10.0).round()/10.0;
            if r >= sc[d].rate {
                avail[g]-=sc[d].rate;
                s.progress[d]+=1;
                if s.progress[d] as u32 >= sc[d].dur {
                    s.done[d]=true;
                    // apply reward
                    if sc[d].rew_unlock { s.unlocked[ASSEMBLER]=true; s.unlocked[LAB]=true; }
                    for t in 1..4 { s.build_rate[t]+= sc[d].rew_build[t] as u8; }
                    s.immig += sc[d].rew_immig;
                    s.demolish_max += sc[d].rew_demolish;
                    s.prestige += sc[d].rp;
                }
            }
        }
        for d in 0..sc.len() { if s.done[d]||s.failed[d] {continue;}
            if s.turn>=sc[d].deadline && (s.progress[d] as u32) < sc[d].dur { s.failed[d]=true; } }
        let lost = (0..sc.len()).any(|d| sc[d].must && s.failed[d]);
        let all_must = (0..sc.len()).all(|d| !sc[d].must || s.done[d]);
        let all_done = (0..sc.len()).all(|d| s.done[d] || s.failed[d]);
        if lost { s.over=true; return; }
        if all_done { s.over=true; return; }
        // continue
        s.turn += 1; s.placed=[0;4]; s.demolished=0;
        if life_met { let room=self.capacity(s)-s.pop; if room>0.0 { let g=(s.immig as f64).min(room); s.pop+=g; } }
        if s.turn > TURNS { s.over=true; if !all_must { /* defeat */ } }
    }

    // start-placement tile score (engine.js tileScore/bestTile)
    fn best_tile_start(&self, s:&State, t:usize) -> i32 {
        let b=&self.bt[t]; let mut best=-1i32; let mut bs=-1e9;
        for id in 0..NT { if !self.eligible(s,t,id) {continue;}
            let tile=&self.map.tiles[id]; let mut sc=0.0;
            if b.deposit<0 && tile.dep>=0 { sc-=6.0; }
            if !b.lava_bonus && tile.lava { sc-=3.0; }
            sc += (self.adj_mult(s,t,id)-1.0)*10.0;
            if b.solar_scaled { sc += sun_factor(tile.q)*3.0; }
            if sc>bs { bs=sc; best=id as i32; }
        }
        best
    }
    // search-placement (balance.js bestTileByMult) with reclaimer-adjacency tiebreak
    fn best_tile_mult(&self, s:&State, t:usize) -> i32 {
        let b=&self.bt[t]; let mut best=-1i32; let mut bm=-1e9; let mut bsec=-1i32;
        for &id in &self.elig[t] { if s.occ[id]>=0 {continue;}   // static-eligible tiles, skip occupied
            let tile=&self.map.tiles[id];
            let mut m = self.adj_mult(s,t,id)*self.heat_ratio(s,t,id);
            if b.cap>0.0 { m = if tile.lava {1.4} else if self.radiated(s,id){0.4} else {1.0}; }
            if b.radiation { m -= 0.6*(self.count_adj(s,id,|x| self.bt[x].is_hab) as f64); }
            if b.cap>0.0 { m -= 0.6*(self.count_adj(s,id,|x| self.bt[x].radiation) as f64); }
            if b.deposit<0 && !b.requires_wreck && tile.dep>=0 { m -= 0.25; }
            if !b.lava_bonus && tile.lava { m -= 0.4; }
            let sec = if b.cap>0.0 && self.count_adj(s,id,|x| self.bt[x].recycles)>0 {1} else {0};
            if m > bm+1e-9 || ((m-bm).abs()<=1e-9 && sec>bsec) { bm=m; best=id as i32; bsec=sec; }
        }
        best
    }

    fn new_state(&self, econ:&Econ) -> State {
        let mut s=State{ bld:[Building::default();BCAP], nb:0, occ:[-1;NT], placed:[0;4], build_rate:econ.build_rate, unlocked:[false;NB],
            done:[false;16], failed:[false;16], progress:[0;16], prestige:0.0, pop:econ.start_pop, immig:econ.immig, turn:1,
            demolish_max:econ.demolish_rate, demolished:0, over:false,
            eval_sur:[0.0;NG], eval_life:false };
        let start=[SOLAR,SOLAR,HABITAT,ICEX,WATERPLANT,GREENHOUSE];
        for &t in &start { let id=self.best_tile_start(&s,t); if id>=0 { self.place(&mut s,t,id as usize); } }
        s.placed=[0;4];
        s
    }
}

// ---- search ----
fn short_goods(eng:&Eng, s:&State, sc:&[Directive], sur:&[f64;NG], ratio:&[f64;NG]) -> [bool;NG] {
    let mut need=[false;NG];
    for d in 0..sc.len() { if s.done[d]||s.failed[d] {continue;} if sur[sc[d].good] < sc[d].rate-0.05 { need[sc[d].good]=true; } }
    // inputs starving any running producer (ratio<1 for an input it consumes)
    for b in &s.bld[..s.nb] { let t=b.ty as usize; let bt=&eng.bt[t];
        for g in 0..NG { if bt.inp[g]>0.0 && g!=WORKERS && ratio[g]<0.999 { need[g]=true; } } }
    if sur[POWER]<2.0 { need[POWER]=true; }
    need
}
fn producers_for(g:usize) -> &'static [usize] {
    match g {
        POWER => &[SOLAR,REACTOR], FOOD => &[GREENHOUSE,ALGAE], METAL => &[SMELTER,SCRAPPER], RARE => &[RAREMINE,SCRAPPER],
        WATER => &[WATERPLANT], ORE => &[OREMINE], ICE => &[ICEX], SILICA => &[SILICAQ],
        GLASS => &[GLASSKILN], ALLOY => &[FOUNDRY], ELEC => &[EFAB], COMP => &[ASSEMBLER], RESEARCH => &[LAB],
        _ => &[],
    }
}
// tiles of OLD buildings worth dismantling: worker-consuming producers whose every output is in
// large enough surplus that removing them still meets life support + every live directive's rate.
// Freeing their workforce can let more useful buildings run.
fn demolish_candidates(eng:&Eng, s:&State, sc:&[Directive], sur:&[f64;NG]) -> Vec<usize> {
    let mut maxrate=[0.0f64;NG];
    for d in 0..sc.len() { if s.done[d]||s.failed[d] {continue;} let g=sc[d].good; if sc[d].rate>maxrate[g]{maxrate[g]=sc[d].rate;} }
    let mut out=Vec::new();
    for b in &s.bld[..s.nb] {
        let t=b.ty as usize; let bt=&eng.bt[t];
        if bt.inp[WORKERS]<=0.0 {continue;}                 // only worker-consuming buildings free workforce
        let id=b.tile as usize;
        let m=eng.adj_mult(s,t,id)*eng.heat_ratio(s,t,id);
        let mut has_out=false; let mut redundant=true;
        for g in 0..NG { if bt.out[g]>0.0 { has_out=true;
            if sur[g] < bt.out[g]*m + maxrate[g] - 1e-9 { redundant=false; break; } } }
        if has_out && redundant { out.push(id); }
    }
    out
}
fn candidate_types(eng:&Eng, s:&State, sc:&[Directive], sur:&[f64;NG], ratio:&[f64;NG]) -> Vec<usize> {
    let need=short_goods(eng,s,sc,sur,ratio);
    let mut set=[false;NB];
    let mut add=|t:usize, set:&mut [bool;NB]| { if eng.unlocked(s,t) && eng.best_tile_mult(s,t)>=0 { set[t]=true; } };
    for g in 0..NG { if !need[g] {continue;}
        for &t in producers_for(g) { add(t,&mut set);
            let bt=&eng.bt[t]; for ig in 0..NG { if bt.inp[ig]>0.0 && ig!=WORKERS && ig!=POWER { for &it in producers_for(ig) { add(it,&mut set); } } }
        }
        if g==WATER { add(RECLAIMER,&mut set); }
    }
    add(HABITAT,&mut set);
    // radiator if a heat producer of a needed good is throttled
    let mut want_rad=false;
    for b in &s.bld[..s.nb] { let t=b.ty as usize; let bt=&eng.bt[t]; if bt.heat>0.0 {
        let mut serves=false; for g in 0..NG { if bt.out[g]>0.0 && need[g] {serves=true;} }
        if serves && eng.heat_ratio(s,t,b.tile as usize)<0.999 { want_rad=true; break; } } }
    if want_rad { add(RADIATOR,&mut set); }
    (0..NB).filter(|&t| set[t]).collect()
}
// multisets of size 0..=k from items
fn multisets(items:&[usize], k:usize) -> Vec<Vec<usize>> {
    let mut out=vec![vec![]];
    fn rec(items:&[usize], k:usize, start:usize, cur:&mut Vec<usize>, out:&mut Vec<Vec<usize>>) {
        if !cur.is_empty() { out.push(cur.clone()); }
        if cur.len()==k { return; }
        for i in start..items.len() { cur.push(items[i]); rec(items,k,i,cur,out); cur.pop(); }
    }
    let mut cur=vec![]; rec(items,k,0,&mut cur,&mut out); out
}

struct Node { s:State, parent:i32, plan:Vec<usize>, demo:Option<usize> }
type Step = (Option<usize>, Vec<usize>);   // (tile demolished this turn, building types placed)

// parallel beam search: MAXIMIZE stars (optionals) among all-required-complete runs. The per-turn
// action is (optionally demolish one redundant building) then (place a build plan).
// returns (stars, end_turn, per-turn steps).
fn beam_search(eng:&Eng, sc:&[Directive], econ:&Econ, beam:usize, horizon:u32, plancap:usize) -> (i32, u32, Vec<Step>) {
    let nthreads: usize = std::thread::available_parallelism().map(|n|n.get()).unwrap_or(4);
    let root = eng.new_state(econ);
    let mut levels: Vec<Vec<Node>> = vec![vec![Node{s:root,parent:-1,plan:vec![],demo:None}]];
    let ndir = sc.len();
    let opt_total = (0..ndir).filter(|&d| !sc[d].must).count();  // stars available
    let (mut best_count, mut best_turn, mut best_chain, mut best_found) = (0usize, u32::MAX, Vec::new(), false);
    // node -> (live children (score,state,parent,plan,demo), best terminal (stars,plan,demo))
    let expand_node = |pi:usize, node:&Node| -> (Vec<(f64,State,i32,Vec<usize>,Option<usize>)>, Option<(usize,Vec<usize>,Option<usize>)>) {
        let mut children=Vec::new(); let mut term:Option<(usize,Vec<usize>,Option<usize>)>=None;
        if node.s.over { return (children,term); }
        // demolish options: None, plus each redundant producer (restored — quality over the small
        // beam-dilution; coarse dedup below keeps the beam from filling with near-duplicates).
        let mut demo_opts: Vec<Option<usize>> = vec![None];
        if node.s.demolish_max - node.s.demolished > 0 {
            let (bsur,_,_)=eng.solve(&node.s);
            for tile in demolish_candidates(eng,&node.s,sc,&bsur) { demo_opts.push(Some(tile)); }
        }
        // build a combined plan list across demolish options, pre-scored, capped to plancap
        let mut combined: Vec<(f64, Option<usize>, Vec<usize>)> = Vec::new();
        for &dopt in &demo_opts {
            let mut tmp=node.s.clone();
            if let Some(tile)=dopt { eng.demolish_at(&mut tmp, tile); }
            let (sur,_life,ratio)=eng.solve(&tmp);
            let cands=candidate_types(eng,&tmp,sc,&sur,&ratio);
            let mut by:[Vec<usize>;4]=[vec![],vec![],vec![],vec![]];
            for &t in &cands { by[eng.bt[t].bt].push(t); }
            let m1=multisets(&by[1], tmp.build_rate[1] as usize);
            let m2=multisets(&by[2], tmp.build_rate[2] as usize);
            let m3=multisets(&by[3], tmp.build_rate[3] as usize);
            let need=short_goods(eng,&tmp,sc,&sur,&ratio);
            for a in &m1 { for b in &m2 { for c in &m3 {
                let mut p=Vec::with_capacity(a.len()+b.len()+c.len());
                p.extend_from_slice(a); p.extend_from_slice(b); p.extend_from_slice(c);
                let mut hit=[false;NG]; let mut score=0.0;
                for &t in &p { let bt=&eng.bt[t];
                    for g in 0..NG { if bt.out[g]>0.0 && need[g] && !hit[g] {hit[g]=true; score+=10.0;} }
                    if t==HABITAT { score += if eng.capacity(&tmp)-tmp.pop < tmp.immig as f64 {6.0} else {1.0}; }
                    if t==RADIATOR { score+=4.0; }
                }
                score -= 0.3*(p.len() as f64);
                if dopt.is_some() { score -= 1.0; }   // mild bias: demolish only if it earns its keep
                combined.push((score, dopt, p));
            }}}
        }
        combined.sort_by(|x,y| y.0.partial_cmp(&x.0).unwrap());
        combined.truncate(plancap);
        // memo: while c still equals the (per-dopt) base layout, best_tile_mult(ty) is layout-
        // independent, so the first placement is identical across all plans sharing this dopt.
        let mut tile_memo=std::collections::HashMap::<(i64,usize),i32>::new();
        for (_,dopt,plan) in combined {
            let mut c=node.s.clone();
            if let Some(tile)=dopt { eng.demolish_at(&mut c, tile); }
            let dk = dopt.map_or(-1i64, |t| t as i64); let mut dirty=false;
            for &ty in &plan {
                let id = if dirty { eng.best_tile_mult(&c,ty) }
                         else { *tile_memo.entry((dk,ty)).or_insert_with(|| eng.best_tile_mult(&c,ty)) };
                if id>=0 && c.placed[eng.bt[ty].bt] < c.build_rate[eng.bt[ty].bt] { eng.place(&mut c,ty,id as usize); dirty=true; } }
            eng.end_turn(&mut c,sc);
            if c.over {
                if (0..ndir).all(|d| !sc[d].must || c.done[d]) {
                    let opt=(0..ndir).filter(|&d| !sc[d].must && c.done[d]).count();
                    if term.as_ref().map_or(true,|t| opt>t.0) { term=Some((opt,plan,dopt)); }
                }
                continue;
            }
            let sf=eng.score(&c,sc);
            children.push((sf, c, pi as i32, plan, dopt));
        }
        (children, term)
    };
    for turn in 1..=horizon {
        let prev = levels.last().unwrap();
        let np = prev.len();
        let mut children: Vec<(f64, State, i32, Vec<usize>, Option<usize>)> = Vec::new();
        let mut term: Option<(usize,i32,Vec<usize>,Option<usize>)> = None;  // (stars, parent_pi, plan, demo)
        std::thread::scope(|scope| {
            let chunk = (np + nthreads - 1)/nthreads.max(1);
            let mut handles=Vec::new();
            for c in 0..nthreads {
                let lo=c*chunk; let hi=((c+1)*chunk).min(np); if lo>=hi {continue;}
                let exp=&expand_node; let prev=&prev;
                handles.push(scope.spawn(move || {
                    let mut ch=Vec::new(); let mut tm:Option<(usize,i32,Vec<usize>,Option<usize>)>=None;
                    for pi in lo..hi { let (mut c2,t2)=exp(pi,&prev[pi]); ch.append(&mut c2);
                        if let Some((cnt,plan,d))=t2 { if tm.as_ref().map_or(true,|x| cnt>x.0){tm=Some((cnt,pi as i32,plan,d));} } }
                    (ch,tm)
                }));
            }
            for h in handles { let (mut ch,tm)=h.join().unwrap(); children.append(&mut ch);
                if let Some(x)=tm { if term.as_ref().map_or(true,|y| x.0>y.0){term=Some(x);} } }
        });
        if let Some((cnt,pi,plan,demo)) = term {
            if !best_found || cnt>best_count || (cnt==best_count && turn<best_turn) {
                let mut chain:Vec<Step>=vec![(demo,plan)];
                let mut p=pi; let mut lvl=levels.len()-1;
                while p>=0 && lvl>0 { let nd=&levels[lvl][p as usize]; chain.push((nd.demo,nd.plan.clone())); p=nd.parent; lvl-=1; }
                chain.reverse();
                best_count=cnt; best_turn=turn; best_chain=chain; best_found=true;
            }
        }
        if best_found && best_count==opt_total { break; }   // got all stars; can't do better
        children.sort_by(|x,y| y.0.partial_cmp(&x.0).unwrap());
        let mut seen=std::collections::HashSet::<u64>::new();
        let mut kept: Vec<Node> = Vec::new();
        for (_,st,par,plan,demo) in children.into_iter() {
            if kept.len()>=beam {break;}
            // exact dedup by building layout (FNV hash of sorted ty*100+tile) — cheap, no Vec alloc
            let mut ids=[0u32;BCAP]; for i in 0..st.nb { ids[i]=(st.bld[i].ty as u32)*100+st.bld[i].tile as u32; }
            ids[..st.nb].sort_unstable();
            let mut h:u64=1469598103934665603;
            for i in 0..st.nb { h^=ids[i] as u64; h=h.wrapping_mul(1099511628211); }
            if !seen.insert(h) {continue;}
            kept.push(Node{s:st,parent:par,plan,demo});
        }
        if kept.is_empty() { break; }
        levels.push(kept);
    }
    (if best_found {best_count as i32} else {-1}, if best_turn==u32::MAX {0} else {best_turn}, best_chain)
}

fn main() {
    let mode = env::args().nth(1).unwrap_or("search".to_string());
    let eng = Eng::new();
    // Rust is canonical: use the built-in scenario by default. PARAMS=<file> opts into the JS bridge.
    let (econ, sc) = match env::var("PARAMS") {
        Ok(p) => load_params(&p).unwrap_or_else(|| (default_econ(), scenario())),
        Err(_) => (default_econ(), scenario()),
    };

    if mode=="nobuild" {
        let mut s=eng.new_state(&econ);
        while !s.over {
            let (sur,life,_)=eng.solve(&s);
            println!("T{} pop={:.0} life={} pow={:.1} food={:.1} water={:.1} metal={:.1} elec={:.1}",
                s.turn, s.pop, life as i32, sur[POWER],sur[FOOD],sur[WATER],sur[METAL],sur[ELEC]);
            eng.end_turn(&mut s,&sc);
        }
        println!("over turn={} prestige={}", s.turn, s.prestige as i32);
        return;
    }
    if mode=="validate" {
        // replay the JS beam search's T12 order (types per turn), tiles via best_tile_mult
        let order: Vec<Vec<usize>> = vec![
            vec![GREENHOUSE,SCRAPPER],
            vec![SOLAR,SCRAPPER],
            vec![GLASSKILN,HABITAT,SCRAPPER],
            vec![SOLAR,SILICAQ,EFAB],
            vec![GLASSKILN,WATERPLANT,EFAB,REACTOR],
            vec![WATERPLANT,ICEX,FOUNDRY],
            vec![WATERPLANT,RADIATOR,ALGAE,ALGAE,ASSEMBLER],
            vec![WATERPLANT,ICEX,ALGAE,ALGAE,ASSEMBLER],
            vec![WATERPLANT,SOLAR,ALGAE,REACTOR,ASSEMBLER],
            vec![WATERPLANT,RADIATOR,ALGAE,REACTOR,LAB],
            vec![GREENHOUSE,GREENHOUSE,ALGAE,ALGAE,LAB],
            vec![HABITAT,HABITAT],
        ];
        let mut s=eng.new_state(&econ);
        for (t,plan) in order.iter().enumerate() {
            if s.over {break;}
            for &ty in plan { let id=eng.best_tile_mult(&s,ty);
                if id>=0 && s.placed[eng.bt[ty].bt] < s.build_rate[eng.bt[ty].bt] { eng.place(&mut s,ty,id as usize); } }
            eng.end_turn(&mut s,&sc);
            let prog: Vec<String> = (0..sc.len()).map(|d| format!("D{}{}", d+1, if s.done[d]{"v"}else if s.failed[d]{"x"}else{"."})).collect();
            println!("after T{}: {} prestige={}", t+1, prog.join(" "), s.prestige as i32);
        }
        let all7=(0..sc.len()).all(|d| s.done[d]);
        println!("RESULT all7={} turn={} prestige={}", all7, s.turn, s.prestige as i32);
        return;
    }

    // ---- search / gap / sweep ----  metric: number of directives passed (1/0 each)
    // defaults tuned for ~1s/run: low beam + high plancap finds the true optimum (plancap is the lever).
    let beam: usize = env::var("BEAM").ok().and_then(|v|v.parse().ok()).unwrap_or(64);
    let horizon: u32 = env::var("HORIZON").ok().and_then(|v|v.parse().ok()).unwrap_or(TURNS);
    let plancap: usize = env::var("PLANCAP").ok().and_then(|v|v.parse().ok()).unwrap_or(800); // 400 truncated the winning plan composition -> non-monotonic stars

    // metric: STARS = optionals completed; required are mandatory (a required failure = DEFEAT = -1).
    let opt_tot = |sc2:&[Directive]| (0..sc2.len()).filter(|&d| !sc2[d].must).count();
    let greedy_outcome = |e2:&Econ, sc2:&[Directive]| -> (i32, u32) {
        let (s,dt)=eng.greedy_run(e2,sc2);
        let req_all=(0..sc2.len()).all(|d| !sc2[d].must || s.done[d]);
        let opt=(0..sc2.len()).filter(|&d| !sc2[d].must && s.done[d]).count() as i32;
        let turn=(0..sc2.len()).filter(|&d| s.done[d]).map(|d| dt[d]).max().unwrap_or(0) as u32;
        (if req_all {opt} else {-1}, turn)
    };

    if mode=="export" {
        // emit both AI solutions as explicit per-turn (demolish tiles, [(typeName,tile)]) moves +
        // expected stars, for faithful replay through the JS engine (Rust<->JS parity check).
        let names:[&str;NB]=["solar","reactor","radiator","habitat","oreMine","iceExtractor","silicaQuarry","rareMine","scrapper","smelter","waterPlant","reclaimer","greenhouse","algaeVat","glassKiln","foundry","electronicsFab","assembler","lab"];
        // search: re-simulate the winning chain (deterministic) to recover the actual tiles
        let (sstar,_,chain)=beam_search(&eng,&sc,&econ,beam,horizon,plancap);
        let mut s=eng.new_state(&econ); let mut ssn=vec![snapshot(&s)];
        for step in &chain { if s.over {break;}
            if let Some(t)=step.0 { eng.demolish_at(&mut s,t); }
            for &ty in &step.1 { let id=eng.best_tile_mult(&s,ty);
                if id>=0 && s.placed[eng.bt[ty].bt] < s.build_rate[eng.bt[ty].bt] { eng.place(&mut s,ty,id as usize); } }
            ssn.push(snapshot(&s)); eng.end_turn(&mut s,&sc); }
        // greedy: same turn loop as greedy_run, snapshotting per turn
        let mut g=eng.new_state(&econ); let mut gsn=vec![snapshot(&g)];
        while !g.over { let mut guard=0; while guard<200 { if !eng.build_step(&mut g,&sc){break;} guard+=1; }
            gsn.push(snapshot(&g)); eng.end_turn(&mut g,&sc); }
        let greq=(0..sc.len()).all(|d| !sc[d].must || g.done[d]);
        let gstar=if greq {(0..sc.len()).filter(|&d| !sc[d].must && g.done[d]).count() as i32} else {-1};
        println!("{{\"seed\":{},\"search\":{{\"stars\":{},\"turns\":{}}},\"greedy\":{{\"stars\":{},\"turns\":{}}}}}",
            seed_json(&ssn[0],&names), sstar, moves_json(&ssn,&names), gstar, moves_json(&gsn,&names));
        return;
    }
    if mode=="greedy" {
        let (gs, dt) = eng.greedy_run(&econ,&sc);
        let req_all=(0..sc.len()).all(|d| !sc[d].must || gs.done[d]);
        let opt=(0..sc.len()).filter(|&d| !sc[d].must && gs.done[d]).count();
        println!("GREEDY: {}", if req_all {format!("WIN {}/{} stars", opt, opt_tot(&sc))} else {"DEFEAT (required failed)".to_string()});
        for d in 0..sc.len() { println!("  D{} {} {}", d+1, if sc[d].must{"req"}else{"opt"}, if gs.done[d]{format!("@T{}",dt[d])} else {"x".to_string()}); }
        return;
    }

    if mode=="sweep" {
        // per variant: stars (optionals) the optimal gets vs the greedy. GAP = search - greedy.
        println!("{:<24} {:>14} {:>14} {:>5}", "variant", "greedy", "search(opt)", "gap");
        for (name, e2, sc2) in variants() {
            let (gstar, _) = greedy_outcome(&e2, &sc2);
            let (sstar, st, _) = beam_search(&eng,&sc2,&e2,beam,horizon,plancap);
            let ot=opt_tot(&sc2);
            let g=if gstar<0 {"DEFEAT".to_string()} else {format!("{}/{} stars", gstar, ot)};
            let s=if sstar<0 {"DEFEAT".to_string()} else {format!("{}/{} @T{}", sstar, ot, st)};
            let gap=if gstar>=0 && sstar>=0 {format!("{}", sstar-gstar)} else {"-".to_string()};
            println!("{:<24} {:>14} {:>14} {:>5}", name, g, s, gap);
        }
        return;
    }

    if mode=="gen" {
        // GENERATE good directive sets: fixed required spine (keeps the game sound) + K sampled
        // optionals. Keep sets the OPTIMAL passes fully but greedy doesn't; rank by gap = #greedy fails.
        // env: GENN samples (60), GENK optionals (3), SEED, BEAM (250 for speed).
        let nsamp:usize = env::var("GENN").ok().and_then(|v|v.parse().ok()).unwrap_or(60);
        let kopt:usize  = env::var("GENK").ok().and_then(|v|v.parse().ok()).unwrap_or(3);
        let gbeam:usize = env::var("BEAM").ok().and_then(|v|v.parse().ok()).unwrap_or(64);
        let rewards_on = env::var("REWARDS").map(|v| v=="1").unwrap_or(false); // sample build/immig rewards on optionals
        let mut seed:u64 = env::var("SEED").ok().and_then(|v|v.parse().ok()).unwrap_or(0x9e3779b97f4a7c15);
        let e = default_econ();
        // candidate optional goods with sensible rate ranges
        let cand:[(usize,i64,i64);8] = [(WATER,6,14),(FOOD,8,18),(METAL,6,12),(GLASS,4,10),(ALLOY,4,8),(ELEC,4,8),(COMP,3,6),(RESEARCH,3,6)];
        let dz=[0,0,0,0];
        let spine = || vec![
            Directive{good:FOOD,rate:5.0,dur:2,deadline:5,req:vec![],must:true,rew_build:[0,1,0,0],rew_immig:0,rew_unlock:false,rew_demolish:0,rp:40.0},
            Directive{good:METAL,rate:5.0,dur:2,deadline:7,req:vec![0],must:true,rew_build:[0,0,1,0],rew_immig:0,rew_unlock:false,rew_demolish:1,rp:70.0},
            Directive{good:ELEC,rate:4.0,dur:2,deadline:10,req:vec![1],must:true,rew_build:[0,0,0,1],rew_immig:0,rew_unlock:true,rew_demolish:0,rp:120.0},
            Directive{good:COMP,rate:3.0,dur:3,deadline:15,req:vec![2],must:true,rew_build:dz,rew_immig:0,rew_unlock:false,rew_demolish:0,rp:160.0},
            Directive{good:RESEARCH,rate:3.0,dur:2,deadline:17,req:vec![3],must:true,rew_build:dz,rew_immig:0,rew_unlock:false,rew_demolish:0,rp:260.0},
        ];
        let mut results:Vec<(i32,i32,i32,String)>=Vec::new(); // (gap, greedy_stars, opt_total, desc)
        for _ in 0..nsamp {
            let mut sc2=spine(); let mut desc=String::new();
            for _ in 0..kopt {
                let (g,lo,hi)=cand[(xs(&mut seed)%(cand.len() as u64)) as usize];
                let rate=rng_range(&mut seed,lo,hi) as f64;
                let dl=rng_range(&mut seed,7,18) as u32;
                let mut rb=dz; let mut rimm=0; let mut rtag="";
                if rewards_on { match xs(&mut seed)%5 { 0=>{rb[1]=1;rtag="+T1";} 1=>{rb[2]=1;rtag="+T2";} 2=>{rb[3]=1;rtag="+T3";} 3=>{rimm=1;rtag="+im";} _=>{} } }
                sc2.push(Directive{good:g,rate,dur:2,deadline:dl,req:vec![],must:false,rew_build:rb,rew_immig:rimm,rew_unlock:false,rew_demolish:0,rp:50.0});
                desc.push_str(&format!("{}{}@{}{} ", GOODNAME[g], rate as i32, dl, rtag));
            }
            let (gs,_gdt)=eng.greedy_run(&e,&sc2);
            let greedy_req=(0..sc2.len()).all(|d| !sc2[d].must || gs.done[d]); // required = greedy can do it
            let gstar=(0..sc2.len()).filter(|&d| !sc2[d].must && gs.done[d]).count() as i32;
            let ot=(0..sc2.len()).filter(|&d| !sc2[d].must).count() as i32;
            let (sstar,_,_)=beam_search(&eng,&sc2,&e,gbeam,horizon,plancap);
            // keep: greedy clears required, optimal gets ALL stars, greedy gets fewer
            if greedy_req && sstar==ot && (sstar - gstar)>0 { results.push((sstar-gstar, gstar, ot, desc)); }
        }
        results.sort_by(|a,b| b.0.cmp(&a.0));
        println!("GEN: {} samples, {} optionals each, beam {} (kept: greedy clears required, optimal all stars)", nsamp, kopt, gbeam);
        if results.is_empty() { println!("  (none — optimal couldn't get all stars, or greedy got all; widen ranges / change K)"); }
        for (gap,gstar,ot,desc) in results.iter().take(15) {
            println!("  gap {}  greedy {}/{} stars  | optionals: {}", gap, gstar, ot, desc.trim());
        }
        return;
    }

    if mode=="hill" {
        // Hill-climb a scenario toward maximum GAP (search stars - greedy stars), subject to two
        // hard constraints: greedy must clear every required, and the optimum must still be able to
        // full-clear every optional. Plain integer gap is a flat plateau, so the continuous gradient
        // is -Σ(greedy's peak surplus margin on the optionals): it drives difficulty up smoothly
        // (greedy gets squeezed) until just before the optimum would break, then the constraint bites.
        // env: ITERS (per restart, 120), RESTARTS (3), HBEAM (inner-loop beam, 32), SEED.
        let iters:usize    = env::var("ITERS").ok().and_then(|v|v.parse().ok()).unwrap_or(120);
        let restarts:usize = env::var("RESTARTS").ok().and_then(|v|v.parse().ok()).unwrap_or(3);
        let hbeam:usize    = env::var("HBEAM").ok().and_then(|v|v.parse().ok()).unwrap_or(beam); // match production beam (fitness==verify)
        let mut seed:u64   = env::var("SEED").ok().and_then(|v|v.parse().ok()).unwrap_or(0x1234_5678_9abc_def1);
        // Objective is gap = search_stars - greedy_stars, which already rewards a high optimum, so a
        // full-clearable peak emerges on its own. Requiring full-clear at EVERY step (FULLCLEAR=1)
        // walls off the valleys the climb must cross and traps it at a low gap, so default is off.
        let full_clear = env::var("FULLCLEAR").map(|v| v=="1").unwrap_or(false);
        let e = econ.clone();
        let fitness = |sc:&[Directive]| -> Option<(i32,f64)> {
            let nd=sc.len();
            // greedy run, recording each directive's peak (surplus - rate) over the game
            let mut s=eng.new_state(&e); let mut peak=vec![f64::NEG_INFINITY; nd]; let mut guard=0;
            while !s.over && guard<60 {
                let mut g2=0; while g2<200 { if !eng.build_step(&mut s, sc){break;} g2+=1; }
                eng.end_turn(&mut s, sc);
                for d in 0..nd { let m=s.eval_sur[sc[d].good]-sc[d].rate; if m>peak[d]{peak[d]=m;} }
                guard+=1;
            }
            if !(0..nd).all(|d| !sc[d].must || s.done[d]) { return None; }   // greedy must clear requireds
            let greedy_stars=(0..nd).filter(|&d| !sc[d].must && s.done[d]).count() as i32;
            let opt=(0..nd).filter(|&d| !sc[d].must).count() as i32;
            let tension:f64=(0..nd).filter(|&d| !sc[d].must).map(|d| -peak[d].clamp(-6.0,6.0)).sum();
            if greedy_stars>=opt { return Some((0, tension)); }   // greedy got all -> gap 0, no search needed
            let (sstar,_,_)=beam_search(&eng, sc, &e, hbeam, TURNS, plancap);
            if full_clear { if sstar < opt { return None; } }       // optimum must full-clear
            else if sstar < 0 { return None; }                      // optimum must at least clear requireds
            Some((sstar-greedy_stars, tension))
        };
        // goods are a fixed property of the seed scenario; only rate/deadline/duration mutate
        let mutate = |sc:&[Directive], seed:&mut u64| -> Vec<Directive> {
            let mut v=sc.to_vec(); let nd=v.len();
            let d=(xs(seed)%nd as u64) as usize;
            match xs(seed)%3 {
                0 => { let dir=if xs(seed)%2==0 {1.0} else {-1.0}; v[d].rate=(v[d].rate+dir).max(1.0); }
                1 => { let dir=if xs(seed)%2==0 {1i64} else {-1}; v[d].deadline=(v[d].deadline as i64+dir).clamp(2,18) as u32; }
                _ => { let dir=if xs(seed)%2==0 {1i64} else {-1}; v[d].dur=(v[d].dur as i64+dir).clamp(1,4) as u32; }
            }
            v
        };
        let print_sc = |sc:&[Directive]| { for d in 0..sc.len() {
            println!("  D{} {} {}@{} dur{} dl{}{}", d+1, if sc[d].must{"REQ"}else{"opt"},
                GOODNAME[sc[d].good], sc[d].rate as i32, sc[d].dur, sc[d].deadline,
                if sc[d].req.is_empty(){String::new()}else{format!(" req{:?}",sc[d].req.iter().map(|r|r+1).collect::<Vec<_>>())}); } };
        let mut global:Option<(i32,f64,Vec<Directive>)>=None;
        for r in 0..restarts {
            let mut cur=scenario();
            for _ in 0..(r*4) { cur=mutate(&cur,&mut seed); }   // diversify later restarts
            let mut curfit=fitness(&cur);
            for _ in 0..iters {
                let cand=mutate(&cur,&mut seed);
                if let Some(cf)=fitness(&cand) {
                    let better=match curfit { None=>true, Some((g,t))=> cf.0>g || (cf.0==g && cf.1>=t) };
                    if better { cur=cand; curfit=Some(cf); }
                }
            }
            match curfit {
                Some((g,t))=>{ println!("restart {}: gap {} tension {:.2}", r, g, t);
                    if global.as_ref().map_or(true,|(bg,bt,_)| g>*bg||(g==*bg&&t>*bt)) { global=Some((g,t,cur.clone())); } }
                None=>println!("restart {}: (no valid scenario)", r),
            }
        }
        match global {
            Some((g,t,sc2))=>{ println!("\nBEST: gap {} tension {:.2}", g, t); print_sc(&sc2);
                let (gs,_)=eng.greedy_run(&e,&sc2);
                let greq=(0..sc2.len()).all(|d| !sc2[d].must || gs.done[d]);
                let gstar=(0..sc2.len()).filter(|&d| !sc2[d].must && gs.done[d]).count();
                let (ss,st,_)=beam_search(&eng,&sc2,&e,beam,TURNS,plancap);
                println!("verify (beam {}): greedy {}/{} stars{}, search {} stars @T{}",
                    beam, gstar, opt_tot(&sc2), if greq{""}else{" (REQ FAIL!)"}, ss, st); }
            None=>println!("no valid scenario found across {} restarts", restarts),
        }
        return;
    }

    if mode=="tighten" {
        // Deterministically remove wasted slack from the current scenario: pull every deadline as
        // early as it will go and push every rate as high as it will go, jointly, while keeping
        // greedy at 0 optionals (still clears requireds) and the optimum at full-clear.
        let e=econ.clone();
        let opt=(0..sc.len()).filter(|&d| !sc[d].must).count() as i32;
        let feasible=|sc2:&[Directive]| -> bool {
            let (gs,_)=eng.greedy_run(&e,sc2);
            if !(0..sc2.len()).all(|d| !sc2[d].must || gs.done[d]) { return false; }       // greedy clears requireds
            if (0..sc2.len()).any(|d| !sc2[d].must && gs.done[d]) { return false; }         // greedy stays 0/opt (gap = opt)
            let (ss,_,_)=beam_search(&eng,sc2,&e,beam,TURNS,plancap);
            ss==opt                                                                          // optimum full-clears
        };
        let mut cur=sc.clone();
        if !feasible(&cur) { println!("base scenario not feasible at beam {}", beam); return; }
        for _pass in 0..4 {
            let mut changed=false;
            for d in 0..cur.len() {                          // pull deadline earlier
                while cur[d].deadline>2 { let mut t=cur.clone(); t[d].deadline-=1;
                    if feasible(&t) { cur=t; changed=true; } else { break; } } }
            for d in 0..cur.len() {                          // push rate higher (cap 30)
                while cur[d].rate<30.0 { let mut t=cur.clone(); t[d].rate+=1.0;
                    if feasible(&t) { cur=t; changed=true; } else { break; } } }
            if !changed { break; }
        }
        println!("tightened scenario:");
        for d in 0..cur.len() { let b=&sc[d]; let c=&cur[d];
            println!("  D{} {} {}@{}{} dur{} dl{}{}", d+1, if c.must{"REQ"}else{"opt"}, GOODNAME[c.good],
                c.rate as i32, if c.rate!=b.rate {format!("(was {})",b.rate as i32)} else {String::new()},
                c.dur, c.deadline, if c.deadline!=b.deadline {format!("(was {})",b.deadline)} else {String::new()}); }
        let (gs,_)=eng.greedy_run(&e,&cur);
        let gstar=(0..cur.len()).filter(|&d| !cur[d].must && gs.done[d]).count();
        let (ss,st,_)=beam_search(&eng,&cur,&e,beam,TURNS,plancap);
        println!("verify (beam {}): greedy {}/{}, search {}/{} @T{}", beam, gstar, opt, ss, opt, st);
        return;
    }

    if mode=="slack" {
        // For each directive, how early can its deadline go (others held fixed) while keeping
        // greedy's required-pass AND the optimum's full-clear? Reveals which deadlines are loose.
        let e=econ.clone(); let base=sc.clone();
        let opt=(0..base.len()).filter(|&d| !base[d].must).count() as i32;
        let feasible=|sc2:&[Directive]| -> bool {
            let (gs,_)=eng.greedy_run(&e,sc2);
            if !(0..sc2.len()).all(|d| !sc2[d].must || gs.done[d]) { return false; }
            let (ss,_,_)=beam_search(&eng,sc2,&e,beam,TURNS,plancap);
            ss==opt
        };
        println!("deadline slack (earliest dl keeping greedy req-pass + search {}/{}; beam {}):", opt, opt, beam);
        for d in 0..base.len() {
            let cur=base[d].deadline; let mut earliest=cur; let mut dl=cur;
            while dl>2 { let mut sc2=base.clone(); sc2[d].deadline=dl-1;
                if feasible(&sc2) { earliest=dl-1; dl-=1; } else { break; } }
            println!("  D{} {} {}@{} dur{}  dl{} -> earliest dl{}  (slack {})",
                d+1, if base[d].must{"REQ"}else{"opt"}, GOODNAME[base[d].good], base[d].rate as i32, base[d].dur, cur, earliest, cur-earliest);
        }
        return;
    }

    let (sstar, st, sol_chain) = beam_search(&eng, &sc, &econ, beam, horizon, plancap);
    let ot=opt_tot(&sc);
    if mode=="gap" {
        let (gstar, gt) = greedy_outcome(&econ, &sc);
        println!("==== GAP (stars = optionals; required mandatory) ====");
        println!("greedy: {}", if gstar<0 {"DEFEAT".to_string()} else {format!("{}/{} stars @T{}", gstar, ot, gt)});
        println!("search: {}", if sstar<0 {"DEFEAT".to_string()} else {format!("{}/{} stars @T{}", sstar, ot, st)});
        println!("gap:    {} stars", if gstar>=0 && sstar>=0 {sstar-gstar} else {0});
        for (i,step) in sol_chain.iter().enumerate() { println!("  search T{}: {}", i+1, step_str(step)); }
        return;
    }
    println!("BEST {}/{} stars @T{}  (beam={}, horizon={})", sstar, ot, st, beam, horizon);
    for (i,step) in sol_chain.iter().enumerate() { println!("  T{}: {}", i+1, step_str(step)); }
}
// format one turn's step: demolished tile (if any) then placed buildings
fn step_str(s:&Step) -> String {
    let mut parts:Vec<String>=Vec::new();
    if let Some(tile)=s.0 { parts.push(format!("-@{}", tile)); }
    for &t in &s.1 { parts.push(ABBR[t].to_string()); }
    if parts.is_empty() { "-".to_string() } else { parts.join(" ") }
}

// snapshot a state's buildings as a sorted (tile,type) list, for diffing turn-to-turn
fn snapshot(s:&State) -> Vec<(usize,usize)> {
    let mut v:Vec<(usize,usize)>=(0..s.nb).map(|i| (s.bld[i].tile as usize, s.bld[i].ty as usize)).collect();
    v.sort(); v
}
fn seed_json(snap:&[(usize,usize)], names:&[&str]) -> String {
    let p:Vec<String>=snap.iter().map(|&(tile,ty)| format!("[\"{}\",{}]", names[ty], tile)).collect();
    format!("[{}]", p.join(","))
}
// turn-by-turn diff of building snapshots -> JSON moves [{demolish:[tiles], place:[[name,tile]]}]
fn moves_json(snaps:&[Vec<(usize,usize)>], names:&[&str]) -> String {
    let mut turns:Vec<String>=Vec::new();
    for w in 1..snaps.len() {
        let prev:std::collections::HashMap<usize,usize>=snaps[w-1].iter().cloned().collect();
        let cur:std::collections::HashMap<usize,usize>=snaps[w].iter().cloned().collect();
        let mut demo:Vec<usize>=prev.iter().filter(|(t,ty)| cur.get(t)!=Some(ty)).map(|(&t,_)| t).collect();
        demo.sort();
        let plc:Vec<String>=cur.iter().filter(|(t,ty)| prev.get(t)!=Some(ty))
            .map(|(&t,&ty)| format!("[\"{}\",{}]", names[ty], t)).collect();
        let ds:Vec<String>=demo.iter().map(|t| t.to_string()).collect();
        turns.push(format!("{{\"demolish\":[{}],\"place\":[{}]}}", ds.join(","), plc.join(",")));
    }
    format!("[{}]", turns.join(","))
}

// ---- greedy heuristic (faithful port of balance.js) -----------------------
impl Eng {
    fn slots_left(&self, s:&State, tier:usize) -> i32 { s.build_rate[tier] as i32 - s.placed[tier] as i32 }
    fn has_slot(&self, s:&State, t:usize) -> bool { self.slots_left(s, self.bt[t].bt) > 0 }
    // marginal extra `good` from placing (t,id): tentatively place on a clone, re-solve, measure delta
    fn gain(&self, s:&State, t:usize, id:usize, good:usize, base:f64) -> f64 {
        let mut c=s.clone(); self.place(&mut c,t,id); let (sur,_,_)=self.solve(&c); sur[good]-base
    }
    fn cool_tiles_for(&self, s:&State, good:usize) -> Vec<usize> {
        let mut set=std::collections::BTreeSet::new();
        for b in &s.bld[..s.nb] { let t=b.ty as usize; let bt=&self.bt[t];
            if bt.heat<=0.0 || bt.out[good]<=0.0 {continue;}
            if self.heat_ratio(s,t,b.tile as usize)>=0.999 {continue;}
            for &nb in &self.map.tiles[b.tile as usize].nb { if self.eligible(s,RADIATOR,nb){set.insert(nb);} } }
        set.into_iter().collect()
    }
    fn reclaim_tiles(&self, s:&State) -> Vec<usize> {
        let mut set=std::collections::BTreeSet::new();
        for b in &s.bld[..s.nb] { if !self.bt[b.ty as usize].is_hab {continue;}
            for &nb in &self.map.tiles[b.tile as usize].nb { if self.eligible(s,RECLAIMER,nb){set.insert(nb);} } }
        set.into_iter().collect()
    }
    // chooseForGood: every action that could raise `good` (producers, cooling, reclaimer, upstream
    // input drill), evaluated by marginal output; pick max (tie -> least-contested tier); cold-start drill.
    fn choose_for_good(&self, s:&State, good:usize, sur:&[f64;NG], depth:i32) -> Option<(usize,usize)> {
        if depth>10 {return None;}
        let base=sur[good];
        let mut cands:Vec<(usize,usize)>=Vec::new();
        for &t in producers_for(good) { if self.unlocked(s,t) && self.has_slot(s,t) { let id=self.best_tile_mult(s,t); if id>=0 {cands.push((t,id as usize));} } }
        if self.has_slot(s,RADIATOR) { for id in self.cool_tiles_for(s,good){cands.push((RADIATOR,id));} }
        if good==WATER && self.has_slot(s,RECLAIMER) { for id in self.reclaim_tiles(s){cands.push((RECLAIMER,id));} }
        for &t in producers_for(good) { if !self.unlocked(s,t){continue;} let bt=&self.bt[t];
            for g in 0..NG { if bt.inp[g]>0.0 && g!=WORKERS && sur[g]<bt.inp[g]-1e-6 { if let Some(sub)=self.choose_for_good(s,g,sur,depth+1){cands.push(sub);} } } }
        let mut best:Option<(usize,usize)>=None; let mut bestd=1e-6;
        for &(t,id) in &cands { let d=self.gain(s,t,id,good,base);
            let better = d>bestd+1e-9 || (best.is_some() && d>bestd-1e-9 && self.slots_left(s,self.bt[t].bt) > self.slots_left(s,self.bt[best.unwrap().0].bt));
            if better { bestd=d; best=Some((t,id)); } }
        if best.is_some(){return best;}
        for &t in producers_for(good) { if !self.unlocked(s,t){continue;} let bt=&self.bt[t];
            for g in 0..NG { if bt.inp[g]>0.0 && g!=WORKERS && sur[g]<bt.inp[g]-1e-6 { if let Some(sub)=self.choose_for_good(s,g,sur,depth+1){return Some(sub);} } } }
        None
    }
    fn start_by(&self, s:&State, sc:&[Directive], d:usize) -> i32 { sc[d].deadline as i32 - (sc[d].dur as i32 - s.progress[d] as i32) + 1 }
    fn g_place(&self, s:&mut State, c:Option<(usize,usize)>) -> bool {
        if let Some((t,id))=c { if self.has_slot(s,t) { self.place(s,t,id); return true; } } false
    }
    // speculative place: keep only if it doesn't drop a directive already being satisfied
    fn g_place_ahead(&self, s:&mut State, sc:&[Directive], c:Option<(usize,usize)>) -> bool {
        if let Some((t,id))=c { if !self.has_slot(s,t){return false;}
            let (sur,life,_)=self.solve(s);
            let mut before=Vec::new();
            for d in 0..sc.len(){ if self.deliverable(s,sc,d) && sur[sc[d].good]>=sc[d].rate-0.05 {before.push(d);} }
            let snap=s.clone(); self.place(s,t,id);
            let (sur2,life2,_)=self.solve(s);
            let mut bad = life && !life2;
            if !bad { for &d in &before { if sur2[sc[d].good] < sc[d].rate-0.05 {bad=true;break;} } }
            if bad { *s=snap; return false; }
            return true;
        }
        false
    }
    fn build_step(&self, s:&mut State, sc:&[Directive]) -> bool {
        let (sur,life,ratio)=self.solve(s);
        // 0. survival: life-support good in deficit, most negative first
        let mut neg:Vec<usize>=[FOOD,WATER,POWER].iter().cloned().filter(|&g| sur[g] < -1e-6).collect();
        neg.sort_by(|&a,&b| sur[a].partial_cmp(&sur[b]).unwrap());
        for g in neg { let c=self.choose_for_good(s,g,&sur,0); if self.g_place(s,c){return true;} }
        // 1. required, open & below rate, by urgency
        let mut req_open:Vec<usize>=(0..sc.len()).filter(|&d| sc[d].must && self.deliverable(s,sc,d) && sur[sc[d].good]<sc[d].rate-0.05).collect();
        req_open.sort_by(|&a,&b| self.start_by(s,sc,a).cmp(&self.start_by(s,sc,b)));
        for d in req_open { let c=self.choose_for_good(s,sc[d].good,&sur,0); if self.g_place(s,c){return true;} }
        // 2. housing ahead of next immigration batch
        if self.capacity(s)-s.pop < s.immig as f64 && self.has_slot(s,HABITAT) {
            let id=self.best_tile_mult(s,HABITAT); if id>=0 && self.g_place_ahead(s,sc,Some((HABITAT,id as usize))){return true;}
        }
        // 3. pre-build upcoming required
        let mut req_up:Vec<usize>=(0..sc.len()).filter(|&d| sc[d].must && !s.done[d] && !s.failed[d] && !self.deliverable(s,sc,d)).collect();
        req_up.sort_by(|&a,&b| self.start_by(s,sc,a).cmp(&self.start_by(s,sc,b)));
        for d in req_up { let c=self.choose_for_good(s,sc[d].good,&sur,0); if self.g_place_ahead(s,sc,c){return true;} }
        // 3.5 reclaim workforce: if worker-limited and a demolish allowance remains, dismantle a
        //     REDUNDANT producer (its output stays above life + every live directive rate without it —
        //     i.e. "won't need it again"). Frees workforce for buildings we do need.
        let _ = life;
        if s.demolished < s.demolish_max && ratio[WORKERS] < 0.999 {
            if let Some(&tile)=demolish_candidates(self,s,sc,&sur).first() { self.demolish_at(s,tile); return true; }
        }
        // 4. optionals (open or upcoming) below rate, no-compromise verify
        let mut opt:Vec<usize>=(0..sc.len()).filter(|&d| !sc[d].must && !s.done[d] && !s.failed[d] && sur[sc[d].good]<sc[d].rate-0.05).collect();
        opt.sort_by(|&a,&b| self.start_by(s,sc,a).cmp(&self.start_by(s,sc,b)));
        for d in opt { let c=self.choose_for_good(s,sc[d].good,&sur,0); if self.g_place_ahead(s,sc,c){return true;} }
        // 5. top up power/food/water headroom for next batch
        let mut low=[FOOD,WATER,POWER]; low.sort_by(|&a,&b| sur[a].partial_cmp(&sur[b]).unwrap());
        for g in low { if sur[g] < s.immig as f64 * LIFE[g] { let c=self.choose_for_good(s,g,&sur,0); if self.g_place_ahead(s,sc,c){return true;} } }
        false
    }
    fn greedy_run(&self, econ:&Econ, sc:&[Directive]) -> (State, [i32;16]) {
        let mut s=self.new_state(econ);
        let mut dt=[-1i32;16];
        while !s.over {
            let t=s.turn; let mut guard=0;
            while guard<200 { if !self.build_step(&mut s,sc){break;} guard+=1; }
            self.end_turn(&mut s,sc);
            for d in 0..sc.len(){ if s.done[d] && dt[d]<0 {dt[d]=t as i32;} }
        }
        (s,dt)
    }
}

impl Eng {
    fn score(&self, s:&State, sc:&[Directive]) -> f64 {
        let sur=&s.eval_sur; let life=s.eval_life;   // reuse end_turn's solve (no 2nd solve)
        let mut sco=0.0;
        // goods that still matter: any not-done directive's good + the recursive material inputs of
        // its producers. Being ready on the *critical chain* early is what enables an early finish,
        // so we credit it regardless of how far off the deadline is (no urgency down-weighting).
        let mut needed=[false;NG];
        for d in 0..sc.len() { if s.done[d]||s.failed[d] {continue;} needed[sc[d].good]=true; }
        for _ in 0..4 { // propagate to inputs a few levels (DAG depth is small)
            let mut more=[false;NG];
            for g in 0..NG { if !needed[g] {continue;}
                for &t in producers_for(g) { let bt=&self.bt[t];
                    for ig in 0..NG { if bt.inp[ig]>0.0 && ig!=WORKERS && !needed[ig] { more[ig]=true; } } } }
            let mut changed=false; for g in 0..NG { if more[g] && !needed[g] { needed[g]=true; changed=true; } }
            if !changed { break; }
        }
        for d in 0..sc.len() {
            if s.done[d] { sco+=1000.0; continue; }
            if s.failed[d] { sco-=5000.0; continue; }
            let prog=(s.progress[d] as f64)/(sc[d].dur as f64);
            let sup=(sur[sc[d].good]/sc[d].rate).min(1.0).max(0.0);
            sco += 700.0*prog + 400.0*sup;        // flat: long-pole directives count too
        }
        // chain readiness: reward having needed goods flowing, but BOUNDED so the beam isn't drawn
        // toward over-producing a good we don't need much of (addresses the "short a good is fine" note)
        for g in 0..NG { if needed[g] && g!=WORKERS { sco += 12.0 * sur[g].max(0.0).min(4.0); } }
        if !life { sco-=2000.0; }
        sco += s.pop*0.5 - (s.turn as f64)*0.01;
        sco
    }
}
