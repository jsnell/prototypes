// COMPOUND — CANONICAL mechanics + greedy AI + search (Rust).
// This is the design/balancing lab and the source of truth for the rules: the
// deterministic map, the flow solver, processEndTurn (run-to-deadlines end rule),
// the scenario/economy, the greedy heuristic (port of balance.js), and a parallel
// beam search. Iterate on ANYTHING here (recipes, map, life-support, economy) and
// both AIs reflect it immediately. compound/engine.js (the playable game) is synced
// from this when a design settles; it was validated identical (greedy + a found
// order reproduce the same directive turns / 800).
//
// Build order is the only "better": 800 is the prestige ceiling, so the search
// minimizes the turn all 7 directives complete. On the current economy: greedy 800
// @T14, search 800 @T12 (gap 2). Edit the rules below, then `cargo run --release gap`.
//
// modes:  search   -> beam search, print best all-7 turn + build order
//         greedy   -> run the greedy heuristic, print its all-7 turn + per-directive
//         gap      -> run both, print greedy turn, optimal turn, and the gap
//         validate -> replay a fixed historical order (engine self-check)
//         nobuild  -> start colony only, per-turn trace
//   env:  BEAM (default 2000) PLANCAP (400) HORIZON (14); PARAMS=<file> loads economy from a file

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
}
fn z() -> [f64; NG] { [0.0; NG] }
fn btypes() -> Vec<Btype> {
    let base = Btype{bt:1,inp:z(),out:z(),heat:0.0,cap:0.0,is_hab:false,radiation:false,cool_out:0.0,
        solar_scaled:false,lava_bonus:false,rad_sensitive:false,lab_syn:false,deposit:-1,requires_wreck:false,recycles:false,locked:false};
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
    rew_build:[i32;4], rew_immig:u32, rew_unlock:bool, rp:f64 }
fn scenario() -> Vec<Directive> {
    // rewards: D3 unlocks assembler+lab and grants +1 T3; D1->+1T1, D2->+1T2.
    let mk = |good,rate,dur,deadline,req:Vec<usize>,must,rb:[i32;4],immig,unlock,rp|
        Directive{good,rate,dur,deadline,req,must,rew_build:rb,rew_immig:immig,rew_unlock:unlock,rp};
    vec![
        mk(FOOD,5.0,2,5,vec![],true,[0,1,0,0],0,false,40.0),      // D1
        mk(METAL,5.0,2,9,vec![0],true,[0,0,1,0],0,false,70.0),    // D2
        mk(ELEC,4.0,2,13,vec![1],true,[0,0,0,1],0,true,120.0),    // D3 (unlock + T3)
        mk(WATER,9.0,2,11,vec![0],false,[0,0,0,0],0,false,60.0),  // D4
        mk(COMP,3.0,3,18,vec![2],true,[0,0,0,0],0,false,160.0),   // D5
        mk(FOOD,14.0,2,18,vec![2],false,[0,0,0,0],0,false,90.0),  // D6
        mk(RESEARCH,3.0,2,23,vec![4],true,[0,0,0,0],0,false,260.0)// D7
    ]
}
const TURNS: u32 = 24;

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
struct Econ { build_rate:[u8;4], immig:u32, start_pop:f64 }
fn default_econ() -> Econ { Econ{ build_rate:[0,1,1,0], immig:2, start_pop:5.0 } }

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
                    rew_immig:t[9].parse().unwrap(), rew_unlock:t[10]=="1", rp:t[11].parse().unwrap() });
            }
            _ => {}
        }
    }
    if dirs.is_empty() { return None; }
    Some((econ, dirs))
}

#[derive(Clone, Copy)]
struct Building { ty:u8, tile:u16 }

#[derive(Clone)]
struct State {
    bld: Vec<Building>,
    occ: [i32; NT],
    placed: [u8;4],
    build_rate: [u8;4],
    unlocked: [bool; NB],
    done: [bool;7], failed: [bool;7], progress: [u8;7],
    prestige: f64, pop: f64, immig: u32, turn: u32,
    over: bool,
    eval_sur: [f64;NG], eval_life: bool,  // stashed from end_turn's solve, reused by score (avoids a 2nd solve)
}

struct Eng { bt: Vec<Btype>, map: Map }

impl Eng {
    fn new() -> Eng { Eng{ bt: btypes(), map: build_map() } }

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
            for g in 0..NG { if ob.out[g]>0.0 { np[g]=true; } } }
        let mut mt=0; for g in 0..NG { if g==POWER||g==WORKERS {continue;} if b.inp[g]>0.0 && np[g] { mt+=1; } }
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
        let mut c=0.0; for b in &s.bld { if self.bt[b.ty as usize].is_hab { c+=self.hab_cap_at(s,b.tile as usize); } } c
    }
    fn life_demand(&self, s:&State) -> [f64;NG] {
        let mut l=[0.0;NG]; l[FOOD]=s.pop*LIFE[FOOD]; l[POWER]=s.pop*LIFE[POWER]; l[WATER]=s.pop*LIFE[WATER];
        let (mut tot, mut serv)=(0.0,0.0);
        for b in &s.bld { if self.bt[b.ty as usize].is_hab { let c=self.hab_cap_at(s,b.tile as usize); tot+=c; if self.hab_serviced(s,b.tile as usize){serv+=c;} } }
        if tot>0.0 { l[WATER] *= 1.0-(serv/tot)*RECY_FRAC; }
        l
    }

    // returns surplus[NG], life_met
    fn solve(&self, s:&State) -> ([f64;NG], bool, [f64;NG]) {
        let n=s.bld.len();
        // eff in/out per building
        let mut ein=vec![[0.0f64;NG]; n];
        let mut eout=vec![[0.0f64;NG]; n];
        for i in 0..n {
            let t=s.bld[i].ty as usize; let id=s.bld[i].tile as usize;
            let hr=self.heat_ratio(s,t,id); let m=self.adj_mult(s,t,id)*hr;
            let b=&self.bt[t];
            for g in 0..NG { if b.inp[g]>0.0 { ein[i][g]=b.inp[g]*hr; } if b.out[g]>0.0 { eout[i][g]=b.out[g]*m; } }
        }
        let l=self.life_demand(s);
        let mut frac=vec![1.0f64; n];
        let mut ratio=[1.0f64;NG];
        for _ in 0..200 {
            let mut prod=[0.0f64;NG]; prod[WORKERS]=s.pop; let mut cons=[0.0f64;NG];
            for i in 0..n { let f=frac[i]; if f<=0.0 {continue;}
                for g in 0..NG { if eout[i][g]>0.0 {prod[g]+=eout[i][g]*f;} if ein[i][g]>0.0 {cons[g]+=ein[i][g]*f;} } }
            for g in 0..NG { let avail=(prod[g]-l[g]).max(0.0); let d=cons[g];
                ratio[g]= if d<=1e-12 {1.0} else {(avail/d).min(1.0)}; }
            let mut md=0.0;
            for i in 0..n { let mut r=1.0f64; for g in 0..NG { if ein[i][g]>0.0 { if ratio[g]<r {r=ratio[g];} } }
                let nf=0.5*frac[i]+0.5*r; let d=(nf-frac[i]).abs(); if d>md {md=d;} frac[i]=nf; }
            if md<1e-7 { break; }
        }
        let mut prod=[0.0f64;NG]; prod[WORKERS]=s.pop; let mut cons=[0.0f64;NG];
        for i in 0..n { let f=frac[i]; if f<=0.0 {continue;}
            for g in 0..NG { if eout[i][g]>0.0 {prod[g]+=eout[i][g]*f;} if ein[i][g]>0.0 {cons[g]+=ein[i][g]*f;} } }
        let mut sur=[0.0;NG]; for g in 0..NG { sur[g]=prod[g]-cons[g]-l[g]; }
        let life_met = prod[FOOD]>=l[FOOD]-1e-6 && prod[WATER]>=l[WATER]-1e-6 && prod[POWER]>=l[POWER]-1e-6;
        (sur, life_met, ratio)
    }

    fn place(&self, s:&mut State, t:usize, id:usize) {
        let idx=s.bld.len(); s.bld.push(Building{ty:t as u8, tile:id as u16});
        s.occ[id]=idx as i32; s.placed[self.bt[t].bt]+=1;
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
        s.turn += 1; s.placed=[0;4];
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
        for id in 0..NT { if !self.eligible(s,t,id) {continue;}
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
        let mut s=State{ bld:vec![], occ:[-1;NT], placed:[0;4], build_rate:econ.build_rate, unlocked:[false;NB],
            done:[false;7], failed:[false;7], progress:[0;7], prestige:0.0, pop:econ.start_pop, immig:econ.immig, turn:1, over:false,
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
    for b in &s.bld { let t=b.ty as usize; let bt=&eng.bt[t];
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
    for b in &s.bld { let t=b.ty as usize; let bt=&eng.bt[t]; if bt.heat>0.0 {
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

struct Node { s:State, parent:i32, plan:Vec<usize> }

// parallel beam search: minimize the turn all directives complete. returns (turn, build order).
fn beam_search(eng:&Eng, sc:&[Directive], econ:&Econ, beam:usize, horizon:u32, plancap:usize) -> (Option<u32>, Vec<Vec<usize>>) {
    let nthreads: usize = std::thread::available_parallelism().map(|n|n.get()).unwrap_or(4);
    let root = eng.new_state(econ);
    let mut levels: Vec<Vec<Node>> = vec![vec![Node{s:root,parent:-1,plan:vec![]}]];
    let mut solution: Option<u32> = None;
    let mut sol_chain: Vec<Vec<usize>> = vec![];
    let ndir = sc.len();
    let expand_node = |pi:usize, node:&Node| -> (Vec<(f64,State,i32,Vec<usize>)>, Vec<Vec<usize>>) {
        let mut children=Vec::new(); let mut wins=Vec::new();
        if node.s.over { return (children,wins); }
        let (sur,_life,ratio)=eng.solve(&node.s);
        let cands=candidate_types(eng,&node.s,sc,&sur,&ratio);
        let mut by:[Vec<usize>;4]=[vec![],vec![],vec![],vec![]];
        for &t in &cands { by[eng.bt[t].bt].push(t); }
        let m1=multisets(&by[1], node.s.build_rate[1] as usize);
        let m2=multisets(&by[2], node.s.build_rate[2] as usize);
        let m3=multisets(&by[3], node.s.build_rate[3] as usize);
        let need=short_goods(eng,&node.s,sc,&sur,&ratio);
        let mut plans: Vec<(f64,Vec<usize>)> = Vec::new();
        for a in &m1 { for b in &m2 { for c in &m3 {
            let mut p=Vec::with_capacity(a.len()+b.len()+c.len());
            p.extend_from_slice(a); p.extend_from_slice(b); p.extend_from_slice(c);
            let mut hit=[false;NG]; let mut score=0.0;
            for &t in &p { let bt=&eng.bt[t];
                for g in 0..NG { if bt.out[g]>0.0 && need[g] && !hit[g] {hit[g]=true; score+=10.0;} }
                if t==HABITAT { score += if eng.capacity(&node.s)-node.s.pop < node.s.immig as f64 {6.0} else {1.0}; }
                if t==RADIATOR { score+=4.0; }
            }
            score -= 0.3*(p.len() as f64);
            plans.push((score,p));
        }}}
        plans.sort_by(|x,y| y.0.partial_cmp(&x.0).unwrap());
        plans.truncate(plancap);
        for (_,plan) in plans {
            let mut c=node.s.clone();
            for &ty in &plan { let id=eng.best_tile_mult(&c,ty);
                if id>=0 && c.placed[eng.bt[ty].bt] < c.build_rate[eng.bt[ty].bt] { eng.place(&mut c,ty,id as usize); } }
            eng.end_turn(&mut c,sc);
            if (0..ndir).all(|d| c.done[d]) { wins.push(plan); continue; }
            if c.over { continue; }
            let sf=eng.score(&c,sc);
            children.push((sf, c, pi as i32, plan));
        }
        (children, wins)
    };
    for turn in 1..=horizon {
        let prev = levels.last().unwrap();
        let np = prev.len();
        let mut children: Vec<(f64, State, i32, Vec<usize>)> = Vec::new();
        let mut win: Option<(i32,Vec<usize>)> = None;
        std::thread::scope(|scope| {
            let chunk = (np + nthreads - 1)/nthreads.max(1);
            let mut handles=Vec::new();
            for c in 0..nthreads {
                let lo=c*chunk; let hi=((c+1)*chunk).min(np); if lo>=hi {continue;}
                let exp=&expand_node; let prev=&prev;
                handles.push(scope.spawn(move || {
                    let mut ch=Vec::new(); let mut wn:Option<(i32,Vec<usize>)>=None;
                    for pi in lo..hi { let (mut c2,wins)=exp(pi,&prev[pi]); ch.append(&mut c2);
                        if wn.is_none() { if let Some(p)=wins.into_iter().next() { wn=Some((pi as i32,p)); } } }
                    (ch,wn)
                }));
            }
            for h in handles { let (mut ch,wn)=h.join().unwrap(); children.append(&mut ch);
                if win.is_none() { win=wn; } }
        });
        if let Some((pi,plan)) = win {
            let mut chain=vec![plan];
            let mut p=pi; let mut lvl=levels.len()-1;
            while p>=0 && lvl>0 { let nd=&levels[lvl][p as usize]; chain.push(nd.plan.clone()); p=nd.parent; lvl-=1; }
            chain.reverse();
            sol_chain=chain; solution=Some(turn); break;
        }
        children.sort_by(|x,y| y.0.partial_cmp(&x.0).unwrap());
        let mut seen=std::collections::HashSet::new();
        let mut kept: Vec<Node> = Vec::new();
        for (_,st,par,plan) in children.into_iter() {
            if kept.len()>=beam {break;}
            let mut sig: Vec<u32> = st.bld.iter().map(|b| (b.ty as u32)*100 + b.tile as u32).collect();
            sig.sort();
            if !seen.insert(sig) {continue;}
            kept.push(Node{s:st,parent:par,plan});
        }
        if kept.is_empty() { break; }
        levels.push(kept);
    }
    (solution, sol_chain)
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
            let prog: Vec<String> = (0..7).map(|d| format!("D{}{}", d+1, if s.done[d]{"v"}else if s.failed[d]{"x"}else{"."})).collect();
            println!("after T{}: {} prestige={}", t+1, prog.join(" "), s.prestige as i32);
        }
        let all7=(0..7).all(|d| s.done[d]);
        println!("RESULT all7={} turn={} prestige={}", all7, s.turn, s.prestige as i32);
        return;
    }

    // ---- beam search ----
    let beam: usize = env::var("BEAM").ok().and_then(|v|v.parse().ok()).unwrap_or(2000);
    let horizon: u32 = env::var("HORIZON").ok().and_then(|v|v.parse().ok()).unwrap_or(14);
    let plancap: usize = env::var("PLANCAP").ok().and_then(|v|v.parse().ok()).unwrap_or(400);

    if mode=="greedy" {
        let (s, dt) = eng.greedy_run(&econ,&sc);
        let all7=(0..sc.len()).all(|d| s.done[d]);
        let turn = if all7 { (0..sc.len()).map(|d| dt[d]).max().unwrap() } else {-1};
        println!("GREEDY: {} prestige={}", if all7 {format!("800 @T{}",turn)} else {"NOT 800".to_string()}, s.prestige as i32);
        for d in 0..sc.len() { println!("  D{} {}", d+1, if s.done[d]{format!("@T{}",dt[d])} else {"x".to_string()}); }
        return;
    }

    if mode=="sweep" {
        // run greedy + search on each named variant; tabulate outcomes so we can see which
        // directive sets widen the greedy-vs-optimal gap. Columns: greedy and search each as
        // done/total @turn (prestige); turn-gap counts only when BOTH complete all directives.
        println!("{:<26} {:>14} {:>14} {:>6}", "variant", "greedy", "search", "gap");
        for (name, e2, sc2) in variants() {
            let (gs, gdt) = eng.greedy_run(&e2, &sc2);
            let g_done = (0..sc2.len()).filter(|&d| gs.done[d]).count();
            let g_all = g_done==sc2.len();
            let g_turn = if g_all { (0..sc2.len()).map(|d| gdt[d]).max().unwrap() } else {-1};
            let (sol,_) = beam_search(&eng,&sc2,&e2,beam,horizon,plancap);
            // search prestige/done: re-derive by replaying? simpler: report turn; full-completion implied
            let s_turn = sol.map(|t| t as i32).unwrap_or(-1);
            let g_col = format!("{}/{} @T{} ({})", g_done, sc2.len(), if g_all{g_turn}else{-1}, gs.prestige as i32);
            let s_col = if s_turn>0 { format!("all @T{}", s_turn) } else { "no all".to_string() };
            let gap = if g_all && s_turn>0 { format!("{}", g_turn - s_turn) } else { "-".to_string() };
            println!("{:<26} {:>14} {:>14} {:>6}", name, g_col, s_col, gap);
        }
        return;
    }

    let (solution, sol_chain) = beam_search(&eng, &sc, &econ, beam, horizon, plancap);
    let s_turn = solution.map(|t| t as i32).unwrap_or(-1);
    if mode=="gap" {
        let (gs, gdt) = eng.greedy_run(&econ,&sc);
        let g_all7=(0..sc.len()).all(|d| gs.done[d]);
        let g_turn = if g_all7 { (0..sc.len()).map(|d| gdt[d]).max().unwrap() } else {-1};
        println!("==== GAP (Rust canonical) ====");
        println!("greedy: {}", if g_all7 {format!("800 @T{}",g_turn)} else {format!("NOT 800 (prestige {})",gs.prestige as i32)});
        println!("search: {}", if s_turn>0 {format!("800 @T{}",s_turn)} else {"no 800 found".to_string()});
        println!("gap:    {}", if g_all7 && s_turn>0 {format!("{} turns", g_turn - s_turn)} else {"n/a".to_string()});
        for (i,plan) in sol_chain.iter().enumerate() { let a:Vec<&str>=plan.iter().map(|&t|ABBR[t]).collect();
            println!("  search T{}: {}", i+1, if a.is_empty(){"-".to_string()}else{a.join(" ")}); }
        return;
    }
    match solution {
        None => println!("no all-7 within horizon={} (beam={})", horizon, beam),
        Some(turn) => {
            println!("BEST all-7 @T{}  (beam={}, horizon={})", turn, beam, horizon);
            for (i,plan) in sol_chain.iter().enumerate() {
                let abbr: Vec<&str> = plan.iter().map(|&t| ABBR[t]).collect();
                println!("  T{}: {}", i+1, if abbr.is_empty(){"-".to_string()}else{abbr.join(" ")});
            }
        }
    }
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
        for b in &s.bld { let t=b.ty as usize; let bt=&self.bt[t];
            if bt.heat<=0.0 || bt.out[good]<=0.0 {continue;}
            if self.heat_ratio(s,t,b.tile as usize)>=0.999 {continue;}
            for &nb in &self.map.tiles[b.tile as usize].nb { if self.eligible(s,RADIATOR,nb){set.insert(nb);} } }
        set.into_iter().collect()
    }
    fn reclaim_tiles(&self, s:&State) -> Vec<usize> {
        let mut set=std::collections::BTreeSet::new();
        for b in &s.bld { if !self.bt[b.ty as usize].is_hab {continue;}
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
        let (sur,_life,_)=self.solve(s);
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
