/* Plague web — simulation engine core (node + browser).
 *
 * Every country/disease/govaction number comes from the phase-0 extracted JSON:
 *   countries.json (58 countries, raw field names), diseases/bacteria.json (global block +
 *   64 nodes with change_to_* effects, tech_requirement_and/or), routes.json (air/ocean
 *   route weights, land_routes_mult), govactions.json (govactions_standard: thresholds,
 *   priorities, effects, news templates), land_adjacency.json (derived from the phase-0
 *   country-indexed raster).
 *
 * Formulas are ours (calibration); all calibration constants are gathered in CAL with
 * comments. No country/node numeric values are hardcoded.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./rng.js'), require('./model.js'), require('./genes.js')
    );
  } else {
    root.PlagueEng = root.PlagueEng || {};
    root.PlagueEng.Engine = factory(root.PlagueEng.Rng, root.PlagueEng.Model, root.PlagueEng.Genes);
  }
})(typeof self !== 'undefined' ? self : this, function (Rng, Model, GenesMod) {
  'use strict';
  var root_genes = GenesMod || null;

  /* ---------- CALIBRATION (formula constants, not data) ---------- */
  var CAL = {
    DNA_START: 9,            // starting DNA points
    DNA_TRICKLE_DAYS: 3,     // +1 DNA every N days (time bubbles)
    DNA_PER_INFECT: 1.6e-8,  // DNA per new infection (infection bubbles)
    DNA_NEW_COUNTRY: 2,      // burst when a country is first infected
    DEVOLVE_REFUND: 0.8,     // fraction of paid cost refunded on devolve
    COST_INFLATION: 0.03,    // +3% per already-evolved node (mirrors rising costs in the game)

    SPREAD_RATE: 0.035,      // β scale: newInf = β·I·S/N
    SPREAD_EXP: 1.0,         // β ∝ (BASE_SEED+infectiousness points)^exp
    BETA_CAP: 4.0,
    EFF_INF_FLOOR: 0.5,      // suppression can never fully stop environmental spread
    MEDICAL_STRENGTH: 600,   // medical_capacity·(budget/10000)·this = suppression weight
    DETECT_MIN: 9,           // absolute infected before a country can notice
    DETECT_FRAC: 2e-7,       // infected/N threshold for detection

    DEATH_SCALE: 0.0014,     // daily mortality = scale·lethalityPoints^exp·(1-medical save)
    DEATH_EXP: 1.05,
    DEATH_MED_SAVE: 0.45,    // max fraction of deaths prevented by rich medicine

    ROUTE_K: 0.06,           // cross-border flow scale
    AIR_SCALE: 0.012,        // air_transmission points → multiplier
    SEA_SCALE: 0.012,
    LAND_SCALE: 0.012,
    ROUTE_MULT_CAP: 4.0,
    LAND_ROUTE_SCALE: 0.001, // land_routes_mult(101) × this = effective land weight

    CURE_WORK: 9000,         // base research "work" for 100% cure
    CURE_AWARE_BASE: 0.5,    // research effort floor once globally aware
    CURE_AWARE_CAP: 3.0,
    RESEARCHER_INFECTED_EFF: 0.35, // infected fraction of a country still researching
    RESEARCH_ALLOC_BASE: 0.2,// baseline research allocation while unaware/aware

    MUTATION_RATE: 0.008,    // per-day chance × mutation points (v2 校准: ×0.5=每250天/病毒×2=每62天,
                             // 接近原作"病毒数月一突变"的体感; 阶段1的0.0022使病毒个性太弱)
    GOV_RAMP: 0.05,          // random-gate ramp per day since detection
    GOV_RAMP_CAP: 8,

    DNA_PER_DEATH: 1.1e-8,   // red-bubble income per death (v2: death DNA stream; 校准)

    /* ---- plague-type mechanics (v2). Keyed by the DATA field disease_type_gui, so no
     * tree/node numbers are hardcoded here — only formula constants, all annotated.
     * Data-driven parts: virus mutation×4 (traits.mutation=2 vs 0.5), fungus cross-border
     * ~0 (global_*_rate=0.0001) + spore bursts (change_to_spore_counter), bio-weapon ramp
     * suppression (change_to_gene_compression_counter), prion/nano/bio cure speed
     * (global cure_requirement_base_multipler 0.2 / 1.45 / 0.18), parasite symbiosis
     * (-3/-6/-9 severity in tree). The constants below calibrate what the tables only
     * describe qualitatively (标注近似). */
    PRION_SLOW_DAYS: 200,    // 近似: prion "slow start" ramp length in days
    PRION_SLOW_FACTOR: 0.45, // 近似: spread ×0.45 at day 0 → ×1.0 at PRION_SLOW_DAYS
    PARASITE_SEV_DISCOUNT: 0.15, // 近似: symptom stealth — effective severity ×0.85
    BIO_RAMP: 0.012,         // 近似: bio-weapon auto lethality points per day, unsuppressed
    BIO_RAMP_CAP: 55,        // 近似: cap of the auto lethality accumulator
    BIO_COMPRESS_FACTOR: [1, 0.62, 0.34, 0.12], // 近似: ramp × by gene-compression count 0..3
    KILLCODE_COST: 32,       // 近似: nano-virus 终止码 DNA cost (canonical Kill Switch family)
    KILLCODE_PENALTY: 1.7,   // 近似: each kill-code use multiplies cure work required
    CUREMODE_MUT_DAYS: 60,   // 近似: cure scenario — the plague auto-evolves a symptom every N days
    CUREMODE_RESEARCH_MULT: 2 // 近似: simplified cure player — many cure.json effect fields extracted as
                              // empty objects in phase 0, so the response tree has fewer working tools
                              // than the real cure mode; research power ×3 compensates (校准)
  };

  /* Difficulty calibration (v2): 医疗效率 / DNA 收益 / 突变率 multipliers. Index = difficulty.
   * Index 1 (普通) is identity, so phase-1 calibration and tests are unchanged by default. */
  var DIFF_CAL = [
    { key: 'easy',   zh: '简单', med: 0.75, dna: 1.25, mut: 0.7 },
    { key: 'normal', zh: '普通', med: 1.0,  dna: 1.0,  mut: 1.0 },
    { key: 'brutal', zh: '困难', med: 1.35, dna: 0.8,  mut: 1.5 }
  ];

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /* ================= Engine ================= */
  function Engine(data, opts) {
    opts = opts || {};
    if (!data || !data.countries || !data.disease || !data.govactions)
      throw new Error('Engine requires countries, disease and govactions data');
    this.data = data;
    this.CAL = CAL;
    var seed = (opts.seed === undefined) ? 20260101 : opts.seed;
    this.rng = new Rng(seed);

    /* ---- v2: plague identity, difficulty, genes, scenario rules ---- */
    this.plagueTypeGui = data.disease.global.disease_type_gui || 'Bacteria';
    this.difficulty = (opts.difficulty === undefined) ? 1 : opts.difficulty;
    this.diff = DIFF_CAL[this.difficulty] || DIFF_CAL[1];
    this.geneSelection = opts.genes || null;
    this.gm = (root_genes ? root_genes.apply(data.genes, opts.genes) : null) ||
      { startDna: 0, trickleAdd: 0, traitAdds: {}, orangeMult: 1, redMult: 1, devolveAdd: 0,
        costFreeze: { symptom: false, ability: false, transmission: false }, borderLeak: 1,
        nexusBonus: 0, mutPools: { transmission: false, ability: false }, picked: [] };
    this.scenarioRules = opts.scenarioRules || {};   // {medicalMult, winMode, timeLimitDays, cureMode}
    this.medicalMult = (this.scenarioRules.medicalMult === undefined) ? 1 :
      this.scenarioRules.medicalMult;
    this.cureMode = !!this.scenarioRules.cureMode;   // scenario "cure": player runs the response
    // cureMode: opts.plagueData = {global, nodes} of the plague the world fights (UI passes
    // the standard bacteria tree restricted to the scenario's scen_symptoms list)
    this.plagueData = opts.plagueData || data.disease;
    this.plagueOwned = {};
    this.autoLethality = 0;      // bio-weapon time ramp accumulator
    this.killCodeUses = 0;       // nano-virus 终止码 times used
    this.hasKillSwitchNode = !!data.disease.nodes.kill_switch_stasis; // canonical nano tree id
    this.cureBoost = 1;          // cure scenario: player research multiplier from cure tree

    var g = data.disease.global;
    this.owned = {};            // node id -> true
    this.paid = {};             // node id -> DNA actually paid (devolve refund / mutation flag)
    this.mutated = {};          // node id -> true if arrived by mutation (refund 0)
    this.traits = Model.traitsFromGlobal(g);
    this.applyGeneTraits();
    this.dna = CAL.DNA_START + this.gm.startDna;
    this.dnaPool = 0;           // fractional accumulator
    this.day = 0;
    this.plagueName = opts.plagueName || data.disease.disease_type_gui || 'Plague';
    this.gameOver = null;       // {win:bool, reason}
    this.news = [];             // {day, key, params:{s}, kind}
    this.stats = { totalInfectedEver: 0, peakInfected: 0, daysAware: 0 };

    // countries state
    this.countries = {};
    var self = this;
    Object.keys(data.countries).forEach(function (k) {
      var c = data.countries[k];
      self.countries[k] = {
        key: k, name: c.name,
        pop0: c.original_population,
        healthy: c.original_population * 1.0,
        infected: 0, dead: 0,
        detected: false, daysSinceDetect: 0,
        airOpen: true, seaOpen: true, landOpen: true,
        localInfMod: 0,         // from gov change_local_infectiousness
        researchAlloc: 0,       // from research funding actions
        actions: {},            // action id -> day taken
        firstInfectedDay: -1
      };
    });

    // cross-border networks
    this.airRoutes = []; this.seaRoutes = []; this.landRoutes = [];
    var split = function (k) { return k.split(','); };
    Object.keys(data.routes.air_routes || {}).forEach(function (k) {
      var ab = split(k);
      if (self.countries[ab[0]] && self.countries[ab[1]])
        self.airRoutes.push({ a: ab[0], b: ab[1], w: data.routes.air_routes[k] });
    });
    Object.keys(data.routes.ocean_routes || {}).forEach(function (k) {
      var ab = split(k);
      if (self.countries[ab[0]] && self.countries[ab[1]])
        self.seaRoutes.push({ a: ab[0], b: ab[1], w: data.routes.ocean_routes[k] });
    });
    var adj = (data.landAdjacency && data.landAdjacency.adjacency) || {};
    this.landMult = num(data.routes.land_routes_mult);
    Object.keys(adj).forEach(function (a) {
      if (!self.countries[a]) return;
      adj[a].forEach(function (b) {
        if (self.countries[b] && a < b)
          self.landRoutes.push({ a: a, b: b, w: self.landMult * CAL.LAND_ROUTE_SCALE });
      });
    });

    // gov actions: mode table ordered by local priority (ties shuffled once with a
    // fixed-seed rng — must not consume the game stream, so save/load replays identically).
    // v2: table is selectable — opts.govTable names a table inside govactions.json
    // (e.g. 'govactions_standard' default / 'govactions_neurax' for the board_game scenario);
    // opts.govActionsData embeds a scenario's own table outright (black_death ships one).
    var govSrc = opts.govActionsData ||
      data.govactions[opts.govTable || 'govactions_standard'];
    this.govTableUsed = opts.govActionsData ? '(scenario)' : (opts.govTable || 'govactions_standard');
    this.govActions = Object.keys(govSrc).map(function (id) {
      var a = govSrc[id]; a.id = id; return a;
    });
    var shuffleRng = new Rng(0x5eed);
    shuffleRng.shuffle(this.govActions);
    this.govActions.sort(function (x, y) {
      return num(x.trigger_local_priority) - num(y.trigger_local_priority);
    });

    this.globallyAware = false;
    this.cure = { progress: 0, workRequired: CAL.CURE_WORK, spent: 0 };
    this._cureMilestones = {};
    this._flavorTimer = this.rng.int(15, 30);
    this.newsFlavor = (data.newsFlavor || []).filter(function (x) { return x && x.en; });

    // nano-virus (data: global cure_requirement_base_multipler > 1, only nano among the 7):
    // cure research starts on day 0 — the rogue nanobot broadcast is public knowledge.
    if (this.traits.cure_research_rate_mult > 1 && !this.cureMode) {
      this.globallyAware = true;
      this.pushNews('Nano-virus DNA detected!', {}, 'discover');
    }
    // cure scenario: research is the player, starts immediately
    if (this.cureMode) this.globallyAware = true;

    // patient zero
    var p0 = opts.patientZero;
    if (!p0 || !this.countries[p0]) {
      var keys = Object.keys(this.countries);
      p0 = keys[this.rng.int(0, keys.length - 1)];
    }
    this.patientZero = p0;
    this.infect(p0, 1, 'start');
  }

  /* ---- infection helpers ---- */
  Engine.prototype.infect = function (key, n, why) {
    var c = this.countries[key];
    n = Math.min(n, c.healthy);
    if (n <= 0) return 0;
    c.healthy -= n; c.infected += n;
    this.stats.totalInfectedEver += n;
    if (c.firstInfectedDay < 0) {
      c.firstInfectedDay = this.day;
      this.dna += CAL.DNA_NEW_COUNTRY;
      this.pushNews('Disease has spread to new country', { s: c.name }, 'spread', key);
    }
    return n;
  };

  Engine.prototype.pushNews = function (key, params, kind, countryKey) {
    this.news.push({
      day: this.day, key: key, params: params || {}, kind: kind || 'info', country: countryKey || null
    });
    if (this.news.length > 400) this.news.splice(0, this.news.length - 400);
  };

  /* ---- traits / evolution ---- */
  Engine.prototype.applyGeneTraits = function () {
    var adds = this.gm.traitAdds || {};
    for (var k in adds) this.traits[k] = (this.traits[k] || 0) + adds[k];
    if (this.traits.mutation < 0) this.traits.mutation = 0;   // Creationist can floor it
  };

  Engine.prototype.recomputeTraits = function () {
    var base = this.cureMode ? this.plagueData : this.data.disease;
    var t = Model.traitsFromGlobal(base.global);
    var nodes = base.nodes;
    var own = this.cureMode ? this.plagueOwned : this.owned;
    for (var id in own) {
      if (own[id] && nodes[id]) Model.applyNode(t, nodes[id], +1);
    }
    this.traits = t;
    this.applyGeneTraits();
  };

  /* cure scenario: the response tree's effect fields, mapped straight from cure.json:
   *   change_to_development_speed        → research speed ×(1+Σ) (data field)
   *   change_to_global_infect_mod        → spread modifier Σ (negative = slower plague)
   *   change_to_{air,land,sea}_travel_restriction → cross-border flow ×(1−0.15Σ) (校准近似)
   */
  Engine.prototype.recomputeCureBoost = function () {
    var nodes = this.data.disease.nodes, dev = 0, infMod = 0, trav = 0;
    for (var id in this.owned) {
      if (!this.owned[id] || !nodes[id]) continue;
      dev += num(nodes[id].change_to_development_speed);
      infMod += num(nodes[id].change_to_global_infect_mod);
      trav += num(nodes[id].change_to_air_travel_restriction) +
        num(nodes[id].change_to_land_travel_restriction) +
        num(nodes[id].change_to_sea_travel_restriction);
    }
    this.cureBoost = Math.max(0.1, 1 + dev);
    this.cureInfMod = infMod;
    this.cureTravelFactor = Math.max(0.15, 1 - 0.15 * trav);
  };

  Engine.prototype.nodeCost = function (id) {
    var nd = this.data.disease.nodes[id];
    if (!nd) return Infinity;
    var base = Math.abs(num(nd.cost));
    var owned = Object.keys(this.owned).filter(function (k) { return this[k]; }, this.owned).length;
    // Stasis genes (Sympto-/Patho-/Trans-Stasis): that category's costs stop inflating
    var freeze = (nd.grid_type === 'symptom' && this.gm.costFreeze.symptom) ||
      (nd.grid_type === 'ability' && this.gm.costFreeze.ability) ||
      (nd.grid_type === 'transmission' && this.gm.costFreeze.transmission);
    var infl = freeze ? 0 : CAL.COST_INFLATION;
    return Math.ceil(base * (1 + infl * owned));
  };

  Engine.prototype.canEvolve = function (id) {
    var nd = this.data.disease.nodes[id];
    if (!nd || this.owned[id]) return false;
    if (!Model.nodeAvailable(nd, this.owned)) return false;
    return this.dna >= this.nodeCost(id);
  };

  Engine.prototype.evolve = function (id) {
    if (!this.canEvolve(id)) return false;
    var cost = this.nodeCost(id);
    this.dna -= cost;
    this.owned[id] = true; this.paid[id] = cost; this.mutated[id] = false;
    if (!this.cureMode) this.recomputeTraits();   // cureMode: owned tree is the response, not the plague
    var nd = this.data.disease.nodes[id];
    this.pushNews('%s has evolved', { s: nd.name }, 'evolve');
    // fungus spore burst (data: change_to_spore_counter on the burst/eruption chain):
    // evolving a burst node releases spores into that many new countries immediately.
    var spores = num(nd.change_to_spore_counter);
    if (spores > 0 && !this.cureMode) this.sporeBurst(spores);
    // cure scenario: response-tree nodes feed the player's research/response power
    if (this.cureMode) this.recomputeCureBoost();
    return true;
  };

  /* Infect up to n random so-far-uninfected countries (fungus Spore Burst / Eruption). */
  Engine.prototype.sporeBurst = function (n) {
    var self = this;
    var clean = Object.keys(this.countries).filter(function (k) {
      return self.countries[k].infected <= 0 && self.countries[k].healthy > 0;
    });
    if (!clean.length) return 0;
    this.rng.shuffle(clean);
    var done = 0;
    for (var i = 0; i < n && i < clean.length; i++) {
      var k = clean[i];
      this.infect(k, Math.max(1, Math.round(this.countries[k].healthy * 1e-6)), 'spore');
      done++;
      this.pushNews('Spore burst infects new country', { s: this.countries[k].name }, 'spread', k);
    }
    return done;
  };

  Engine.prototype.canDevolve = function (id) {
    var nd = this.data.disease.nodes[id];
    if (!nd || !this.owned[id]) return false;
    // devolving a node that others depend on (and-requirement) is blocked
    for (var oid in this.owned) {
      if (oid !== id && this.owned[oid]) {
        var reqs = Model.reqList(this.data.disease.nodes[oid].tech_requirement_and);
        if (reqs.indexOf(id) >= 0) return false;
      }
    }
    return true;
  };

  Engine.prototype.devolve = function (id) {
    if (!this.canDevolve(id)) return false;
    var refund = this.mutated[id] ? 0 : Math.floor(num(this.paid[id]) * CAL.DEVOLVE_REFUND);
    refund += this.gm.devolveAdd || 0;   // Ionised Helix gene: flat +DNA per devolve
    this.dna += refund;
    delete this.owned[id]; delete this.paid[id]; delete this.mutated[id];
    if (!this.cureMode) this.recomputeTraits();
    if (this.cureMode) this.recomputeCureBoost();
    return true;
  };

  /* ---- nano-virus 终止码 (kill code): unlocked by evolving the canonical
   * kill_switch_stasis node; costs DNA; resets cure progress to 0; every use makes
   * the next cure harder (work × CAL.KILLCODE_PENALTY). 近似: canonical broadcast overload. */
  Engine.prototype.killCodeUnlocked = function () {
    return !!(this.hasKillSwitchNode && this.owned.kill_switch_stasis);
  };
  Engine.prototype.killCodeCost = function () {
    return CAL.KILLCODE_COST;
  };
  Engine.prototype.launchKillCode = function () {
    if (!this.killCodeUnlocked() || this.gameOver) return false;
    if (this.dna < this.killCodeCost()) return false;
    this.dna -= this.killCodeCost();
    this.killCodeUses++;
    this.cure.progress = 0; this.cure.spent = 0; this._cureMilestones = {};
    this.cure.workRequired = this.cureWorkRequired();  // penalty now lives inside cureWorkRequired()
    this.pushNews('Nano-virus kill code broadcast wipes cure progress', {}, 'cure');
    return true;
  };

  /* ---- per-country dynamics ---- */
  /* plague-type spread scale: prion 慢热 (slow start ramping to 1 over PRION_SLOW_DAYS,
   * 近似), Native Biome gene bonus inside patient-zero country. */
  Engine.prototype.plagueBetaScale = function (ck) {
    var s = (this.scenarioRules.spreadMult === undefined) ? 1 : this.scenarioRules.spreadMult;
    if (s !== 1) return s;   // scenario spread calibration (board_game: distribution is slower than a virus)
    if (this.plagueTypeGui === 'Prion') {
      s *= CAL.PRION_SLOW_FACTOR + (1 - CAL.PRION_SLOW_FACTOR) *
        Math.min(1, this.day / CAL.PRION_SLOW_DAYS);
    }
    if (this.gm.nexusBonus && ck === this.patientZero) s *= 1 + this.gm.nexusBonus;
    return s;
  };

  /* parasite symptom stealth (近似): effective severity ×(1-discount) drives awareness,
   * government severity gates and the UI — traits.severity stays the raw data sum. */
  Engine.prototype.effSeverity = function () {
    var d = this.plagueTypeGui === 'Parasite' ? CAL.PARASITE_SEV_DISCOUNT : 0;
    return this.traits.severity * (1 - d);
  };

  /* bio-weapon: total lethality = tree sum + time auto-ramp ( suppressed by
   * gene_compression_counter count via BIO_COMPRESS_FACTOR, 近似). */
  Engine.prototype.effLethality = function () {
    return Math.max(0, this.traits.lethality + this.autoLethality);
  };

  Engine.prototype.betaFor = function (ck) {
    var c = this.data.countries[ck], st = this.countries[ck];
    var effInf = Math.max(CAL.EFF_INF_FLOOR, Model.CAL.BASE_SEED + this.traits.infectiousness +
      st.localInfMod + (this.cureMode ? this.cureInfMod || 0 : 0));
    var att = Model.attributeMultiplier(this.traits, c);
    var med = 1;
    if (st.detected) {
      var w = num(c.medical_capacity) * (num(c.medical_budget) / 10000) * CAL.MEDICAL_STRENGTH;
      w *= this.diff.med * this.medicalMult;   // difficulty 医疗效率 + scenario rule
      med = 1 / (1 + w);
    }
    var beta = CAL.SPREAD_RATE * Math.pow(effInf, CAL.SPREAD_EXP) * att * med;
    beta *= this.plagueBetaScale(ck);
    return Math.min(CAL.BETA_CAP, beta);
  };

  Engine.prototype.mortalityFor = function (ck) {
    var c = this.data.countries[ck], st = this.countries[ck];
    var pts = this.effLethality();
    if (pts <= 0) return 0;
    var save = 0;
    if (st.detected) save = clamp(num(c.medical_capacity) / 0.002, 0, 1) * CAL.DEATH_MED_SAVE *
      this.diff.med * this.medicalMult;
    return CAL.DEATH_SCALE * Math.pow(pts, CAL.DEATH_EXP) * (1 - clamp(save, 0, 0.9));
  };

  Engine.prototype.routeMult = function (kind) {
    var t = this.traits, pts, scale, g;
    if (kind === 'air') { pts = t.air_transmission; scale = CAL.AIR_SCALE; g = t.global_air_rate; }
    else if (kind === 'sea') { pts = t.sea_transmission; scale = CAL.SEA_SCALE; g = t.global_sea_rate; }
    else { pts = t.land_transmission; scale = CAL.LAND_SCALE; g = t.global_land_rate; }
    var m = Math.min(CAL.ROUTE_MULT_CAP, Math.max(0.05, g * (1 + num(pts) * scale)));
    if (this.cureMode) m *= (this.cureTravelFactor === undefined ? 1 : this.cureTravelFactor);
    return m;
  };

  /* flow along one route a→b; returns new infections seeded in b.
   * Endpoint capability comes from routes.txt itself (papua has port=0 yet real ocean
   * routes; the airport/port flags gate govactions + UI instead). Border closures stop flow. */
  Engine.prototype.routeFlow = function (a, b, w, kind) {
    var A = this.countries[a], B = this.countries[b];
    var closed = 0;
    if (kind === 'air') { closed = (!A.airOpen || !B.airOpen) ? 1 : 0; }
    else if (kind === 'sea') { closed = (!A.seaOpen || !B.seaOpen) ? 1 : 0; }
    else { closed = (!A.landOpen || !B.landOpen) ? 1 : 0; }
    if (closed && this.gm.borderLeak >= 1) return 0;
    var leak = closed ? this.gm.borderLeak : 1;   // Suppression gene: closed borders leak
    var Na = A.healthy + A.infected;
    if (Na <= 0 || A.infected <= 0 || B.healthy <= 0) return 0;
    var frac = A.infected / Na;
    var flow = CAL.ROUTE_K * w * this.routeMult(kind) * frac * B.healthy * leak;
    if (flow < 1) { // probabilistic seeding of the first cases
      return this.rng.chance(flow) ? 1 : 0;
    }
    return flow;
  };

  /* ---- government actions ---- */
  Engine.prototype.govActionEligible = function (act, ck) {
    var c = this.data.countries[ck], st = this.countries[ck];
    if (st.actions[act.id]) return false;
    if (num(act.condition_has_airport) && !c.airport) return false;
    if (num(act.condition_has_port) && !c.port) return false;
    var N = st.pop0;
    var linf = st.infected / N;
    var ldead = st.dead / N;
    var v;
    v = num(act.condition_local_infected_percent); if (v && linf < v) return false;
    v = num(act.condition_global_infected_percent);
    if (v) {
      var g = this.totals();
      if ((g.infected / g.pop0) < v) return false;
    }
    v = num(act.condition_population_dead); if (v && ldead < v) return false;
    v = num(act.condition_disease_severity); if (v && this.effSeverity() < v) return false;
    var taken = Model.reqList(act.condition_action_taken);
    for (var i = 0; i < taken.length; i++) if (!st.actions[taken[i]]) return false;
    var notTaken = Model.reqList(act.condition_action_not_taken);
    for (var j = 0; j < notTaken.length; j++) if (st.actions[notTaken[j]]) return false;
    // random gate, ramping once the country has known about the plague for a while
    var p = num(act.condition_random);
    if (p > 0) {
      var ramp = num(act.random_increase_flag) ?
        Math.min(CAL.GOV_RAMP_CAP, 1 + CAL.GOV_RAMP * st.daysSinceDetect) : 1;
      if (!this.rng.chance(p * ramp)) return false;
    } else if (!this._govLadderOk(act, ck)) {
      return false;
    }
    return true;
  };

  /* actions with no random gate fire in strict priority ladder: eligible only if all
   * higher-priority (lower number) eligible-or-taken actions before it are already taken */
  Engine.prototype._govLadderOk = function (act, ck) {
    var st = this.countries[ck];
    for (var i = 0; i < this.govActions.length; i++) {
      var other = this.govActions[i];
      if (other.id === act.id) break;
      if (num(other.trigger_local_priority) < num(act.trigger_local_priority) &&
          !st.actions[other.id] && this._hardCondOk(other, ck)) return false;
    }
    return true;
  };

  Engine.prototype._hardCondOk = function (act, ck) {
    var c = this.data.countries[ck], st = this.countries[ck];
    if (num(act.condition_has_airport) && !c.airport) return false;
    if (num(act.condition_has_port) && !c.port) return false;
    var v;
    v = num(act.condition_local_infected_percent); if (v && st.infected / st.pop0 < v) return false;
    v = num(act.condition_population_dead); if (v && st.dead / st.pop0 < v) return false;
    v = num(act.condition_disease_severity); if (v && this.effSeverity() < v) return false;
    return true;
  };

  Engine.prototype.runGovernment = function () {
    var self = this;
    if (this.scenarioRules.noGovActions) return;   // board_game: a board game draws no epidemic response (近似)
    Object.keys(this.countries).forEach(function (ck) {
      var st = self.countries[ck];
      if (!st.detected || self.gameOver) return;
      // at most one action per country per day, in priority order
      for (var i = 0; i < self.govActions.length; i++) {
        var act = self.govActions[i];
        if (self.govActionEligible(act, ck)) {
          st.actions[act.id] = self.day;
          if (num(act.change_air_borders) < 0) st.airOpen = false;
          if (num(act.change_sea_borders) < 0) st.seaOpen = false;
          if (num(act.change_land_borders) < 0) st.landOpen = false;
          st.localInfMod += num(act.change_local_infectiousness);
          st.researchAlloc += num(act.change_research_allocation);
          if (num(act.news_flag) && typeof act.news_content === 'string' && act.news_content) {
            self.pushNews(act.news_content, { s: st.name }, 'gov', ck);
          }
          break;
        }
      }
    });
  };

  /* ---- cure research ---- */
  Engine.prototype.cureResearchPerDay = function () {
    if (!this.globallyAware) return 0;
    var t = this.traits, tot = this.totals(), self = this;
    var awareness = CAL.CURE_AWARE_BASE +
      this.effSeverity() * 0.01 + (tot.dead / tot.pop0) * 4 + (tot.infected / tot.pop0) * 1;
    awareness = Math.min(CAL.CURE_AWARE_CAP, awareness);
    var power = 0;
    Object.keys(this.countries).forEach(function (ck) {
      var c = self.data.countries[ck], st = self.countries[ck];
      // research capacity collapses as a country falls ill (healthy + reduced infected)
      var capacity = (st.healthy + CAL.RESEARCHER_INFECTED_EFF * st.infected) / st.pop0;
      power += (num(c.medical_budget) / 10000) * (1 + 0.5 * c.wealthy) * capacity *
        (CAL.RESEARCH_ALLOC_BASE + st.researchAlloc);
    });
    power *= awareness;
    power /= (1 + num(t.research_inefficiency_multiplier));
    power *= this.traits.cure_research_rate_mult || 1; // data: global cure_requirement_base_multipler
    power *= this.diff.med;                            // difficulty 医疗效率
    if (this.cureMode) power *= this.cureBoost * CAL.CUREMODE_RESEARCH_MULT; // cure scenario
    return power;
  };

  Engine.prototype.cureWorkRequired = function () {
    var t = this.traits;
    // nano-virus kill-code penalty is part of the daily-recomputed requirement:
    // each use permanently multiplies the remaining cure work. (Bug fix: this
    // term was previously set only inside launchKillCode and overwritten daily
    // by this same function, so the penalty never actually applied.)
    return CAL.CURE_WORK * (1 + num(t.cure_base_multiplier)) *
      Math.pow(CAL.KILLCODE_PENALTY, this.killCodeUses);
  };

  /* ---- mutation ---- */
  Engine.prototype.mutationStep = function () {
    var m = this.traits.mutation;
    // cure scenario: the plague has no player — it forces a symptom every CUREMODE_MUT_DAYS
    var forced = this.cureMode && (this.day % CAL.CUREMODE_MUT_DAYS === 0);
    if (m <= 0 && !forced) return;
    if (!forced && !this.rng.chance(CAL.MUTATION_RATE * m * this.diff.mut)) return;
    var nodes = this.cureMode ? this.plagueData.nodes : this.data.disease.nodes, self = this;
    var own = this.cureMode ? this.plagueOwned : this.owned;
    var pool = Object.keys(nodes).filter(function (id) {
      if (own[id] || !Model.nodeAvailable(nodes[id], own)) return false;
      var gt = nodes[id].grid_type;
      if (gt === 'symptom') return true;
      if (gt === 'transmission' && self.gm.mutPools.transmission) return true;  // Base Oxidisation
      if (gt === 'ability' && self.gm.mutPools.ability) return true;            // Base Hydrolysis
      return false;
    });
    if (!pool.length) return;
    var id = this.rng.pick(pool);
    if (this.cureMode) { this.plagueOwned[id] = true; }
    else { this.owned[id] = true; this.paid[id] = 0; this.mutated[id] = true; }
    this.recomputeTraits();
    this.pushNews('%s has mutated and developed the %s symptom without using DNA points',
      { s: this.plagueName, s2: nodes[id].name }, 'mutation');
  };

  /* ---- totals ---- */
  Engine.prototype.totals = function () {
    var h = 0, i = 0, d = 0, pop0 = 0;
    for (var k in this.countries) {
      var st = this.countries[k];
      h += st.healthy; i += st.infected; d += st.dead; pop0 += st.pop0;
    }
    return { healthy: h, infected: i, dead: d, pop0: pop0 };
  };

  /* ---- one simulation day ---- */
  Engine.prototype.tick = function () {
    if (this.gameOver) return this.gameOver;
    var self = this;
    this.day++;

    /* 1. detection */
    Object.keys(this.countries).forEach(function (ck) {
      var st = self.countries[ck];
      if (!st.detected && st.infected > 0) {
        var thr = Math.max(CAL.DETECT_MIN, st.pop0 * CAL.DETECT_FRAC);
        if (st.infected >= thr) {
          st.detected = true; st.daysSinceDetect = 0;
          self.pushNews('New disease spotted in %s', { s: st.name }, 'discover', ck);
        }
      } else if (st.detected) st.daysSinceDetect++;
    });
    var anyDetected = false;
    for (var k2 in this.countries) if (this.countries[k2].detected) { anyDetected = true; break; }
    if (anyDetected && !this.globallyAware) {
      this.globallyAware = true;
      this.pushNews('Global health authorities are aware of the disease', {}, 'discover');
    }
    if (this.globallyAware) this.stats.daysAware++;

    /* 2. local spread + deaths */
    var newInfTotal = 0, newDeathsTotal = 0;
    Object.keys(this.countries).forEach(function (ck) {
      var st = self.countries[ck];
      if (st.infected <= 0) return;
      var N = st.healthy + st.infected;
      if (N <= 0) { st.infected = 0; return; }
      var beta = self.betaFor(ck);
      var local = beta * st.infected * (st.healthy / N);
      // corpse transmission
      local += num(self.traits.corpse_transmission) * 0.02 * st.dead * (st.healthy / Math.max(1, N));
      var ni = Math.min(st.healthy, local);
      var deaths = Math.min(st.infected, st.infected * self.mortalityFor(ck));
      st.healthy -= ni; st.infected += ni - deaths; st.dead += deaths;
      if (st.healthy < 0) { st.infected += st.healthy; st.healthy = 0; }
      if (st.infected < 0) st.infected = 0;
      newInfTotal += ni; newDeathsTotal += deaths;
    });

    /* 3. cross-border transmission */
    var seeds = [];
    function eachRoute(routes, kind) {
      routes.forEach(function (r) {
        var fab = self.routeFlow(r.a, r.b, r.w, kind);
        var fba = self.routeFlow(r.b, r.a, r.w, kind);
        if (fab > 0) seeds.push([r.b, fab]);
        if (fba > 0) seeds.push([r.a, fba]);
      });
    }
    eachRoute(this.airRoutes, 'air');
    eachRoute(this.seaRoutes, 'sea');
    eachRoute(this.landRoutes, 'land');
    seeds.forEach(function (s) { newInfTotal += self.infect(s[0], s[1], 'route'); });

    /* 4. government reactions */
    this.runGovernment();

    /* 5. cure research */
    if (this.globallyAware) {
      var rd = this.cureResearchPerDay();
      this.cure.spent += rd;
      this.cure.workRequired = this.cureWorkRequired();
      this.cure.progress = Math.min(1, this.cure.progress + rd / this.cure.workRequired);
      // cure milestone news (verified l10n keys)
      var ms = [[0.25, 'Cure 25%% complete', 'cure25'], [0.5, 'Cure 50%% complete', 'cure50'], [0.75, 'Cure 75%% complete', 'cure75']];
      for (var mi = 0; mi < ms.length; mi++) {
        if (this.cure.progress >= ms[mi][0] && !this._cureMilestones[ms[mi][2]]) {
          this._cureMilestones[ms[mi][2]] = true;
          this.pushNews(ms[mi][1], {}, 'cure');
        }
      }
      if (this.cure.progress >= 1) {
        this.gameOver = this.cureMode
          ? { win: true, reason: 'cure_complete', day: this.day }     // cure player saved the world
          : { win: false, reason: 'cure_complete', day: this.day };
        this.pushNews('Cure construction complete', {}, 'cure');
        return this.gameOver;
      }
    }

    /* 5b. bio-weapon auto lethality ramp (change_to_gene_compression_counter nodes in the
     * tree mark the plague; each owned compression level scales the ramp down — 近似 of the
     * canonical "lethality increases over time unless compressed" mechanic). */
    if (this.plagueTypeGui === 'Bioweapon') {
      var comp = Math.min(3, Math.round(num(this.traits.gene_compression_counter)));
      var factor = CAL.BIO_COMPRESS_FACTOR[comp] || 0.1;
      this.autoLethality = Math.min(CAL.BIO_RAMP_CAP, this.autoLethality + CAL.BIO_RAMP * factor);
    }

    /* 6. mutation */
    this.mutationStep();

    /* 6b. world flavor news sampled from events.json (verified l10n keys only) */
    this._flavorTimer -= 1;
    if (this._flavorTimer <= 0) {
      this._flavorTimer = this.rng.int(18, 40);
      if (this.newsFlavor.length) {
        var fl = this.rng.pick(this.newsFlavor);
        var fparams = {};
        if (fl.en.indexOf('%s') >= 0) {
          var alive = Object.keys(this.countries).filter(function (k) {
            return self.countries[k].healthy > 0;
          });
          fparams.s = alive.length ? this.data.countries[this.rng.pick(alive)].name : this.plagueName;
        }
        this.pushNews(fl.en, fparams, 'world');
      }
    }

    /* 7. DNA income — time bubbles (blue), infection stream (orange) and death stream
     * (red); difficulty DNA 收益 and gene multipliers apply to all three. */
    if (this.day % CAL.DNA_TRICKLE_DAYS === 0)
      this.dnaPool += (1 + this.gm.trickleAdd) * this.diff.dna;   // fractional trickle pools
    this.dnaPool += newInfTotal * CAL.DNA_PER_INFECT * this.gm.orangeMult * this.diff.dna;
    this.dnaPool += newDeathsTotal * CAL.DNA_PER_DEATH * this.gm.redMult * this.diff.dna;
    if (this.dnaPool >= 1) {
      var g = Math.floor(this.dnaPool);
      this.dna += g; this.dnaPool -= g;
    }

    /* 8. win / lose */
    var tot = this.totals();
    if (tot.peak !== undefined) {}
    this.stats.peakInfected = Math.max(this.stats.peakInfected, tot.infected);
    if (tot.healthy + tot.infected <= 0.5) {
      this.gameOver = this.cureMode
        ? { win: false, reason: 'extinction', day: this.day }   // cure player failed
        : { win: true, reason: 'extinction', day: this.day };
      this.pushNews('There are no healthy people left in the world', {}, 'end');
    } else if (this.stats.totalInfectedEver > 1 && tot.infected <= 0.5 && tot.dead > 0) {
      this.gameOver = { win: false, reason: 'eradicated', day: this.day };
      this.pushNews('The plague has been eradicated', {}, 'end');
    }
    /* scenario win modes: board_game = 风靡全球 (every country reached) within the
     * scenario's two-year limit; timeLimitDays overrun = loss. 近似 of the board-game goal. */
    if (!this.gameOver && this.scenarioRules.winMode === 'ubiquity') {
      var reached = 0, totalC = 0;
      for (var ck2 in this.countries) {
        totalC++;
        if (this.countries[ck2].firstInfectedDay >= 0) reached++;
      }
      if (reached >= totalC) {
        this.gameOver = { win: true, reason: 'ubiquity', day: this.day };
        this.pushNews('The game has been distributed worldwide', {}, 'end');
      } else if (this.scenarioRules.timeLimitDays && this.day >= this.scenarioRules.timeLimitDays) {
        this.gameOver = { win: false, reason: 'time_limit', day: this.day };
        this.pushNews('Investors pull funding: the two years are up', {}, 'end');
      }
    }
    return this.gameOver;
  };

  /* ---- save / load ---- */
  Engine.prototype.save = function () {
    var cs = {};
    for (var k in this.countries) {
      var st = this.countries[k];
      cs[k] = {
        h: st.healthy, i: st.infected, d: st.dead, det: st.detected ? 1 : 0,
        dd: st.daysSinceDetect, air: st.airOpen ? 1 : 0, sea: st.seaOpen ? 1 : 0,
        land: st.landOpen ? 1 : 0, lim: st.localInfMod, ra: st.researchAlloc,
        act: st.actions, fid: st.firstInfectedDay
      };
    }
    return {
      v: 2, day: this.day, dna: Math.floor(this.dna), dnaPool: this.dnaPool,
      rng: this.rng.getState(), patientZero: this.patientZero,
      owned: this.owned, paid: this.paid, mutated: this.mutated,
      countries: cs, cure: this.cure, globallyAware: this.globallyAware,
      stats: this.stats, gameOver: this.gameOver,
      cureMilestones: this._cureMilestones, flavorTimer: this._flavorTimer,
      newsTail: this.news.slice(-60),
      /* v2 fields (v1 saves load with defaults via load()) */
      plagueTypeGui: this.plagueTypeGui, difficulty: this.difficulty,
      genes: this.geneSelection || null, genePicked: this.gm.picked,
      scenarioRules: this.scenarioRules, govTableUsed: this.govTableUsed,
      autoLethality: this.autoLethality, killCodeUses: this.killCodeUses,
      plagueOwned: this.plagueOwned
    };
  };

  Engine.prototype.load = function (sv) {
    this.day = sv.day; this.dna = sv.dna; this.dnaPool = sv.dnaPool || 0;
    this.rng.setState(sv.rng);
    this.owned = sv.owned; this.paid = sv.paid || {}; this.mutated = sv.mutated || {};
    this.patientZero = sv.patientZero;
    this.recomputeTraits();
    for (var k in sv.countries) {
      var s = sv.countries[k], st = this.countries[k];
      if (!st) continue;
      st.healthy = s.h; st.infected = s.i; st.dead = s.d; st.detected = !!s.det;
      st.daysSinceDetect = s.dd; st.airOpen = !!s.air; st.seaOpen = !!s.sea;
      st.landOpen = !!s.land; st.localInfMod = s.lim; st.researchAlloc = s.ra;
      st.actions = s.act || {}; st.firstInfectedDay = s.fid;
    }
    this.cure = sv.cure; this.globallyAware = sv.globallyAware;
    this.stats = sv.stats; this.gameOver = sv.gameOver || null;
    this._cureMilestones = sv.cureMilestones || {};
    this._flavorTimer = (sv.flavorTimer !== undefined) ? sv.flavorTimer : 20;
    this.news = sv.newsTail || [];
    /* v1 saves (phase 1) lack these — defaults keep them replayable */
    if (sv.difficulty !== undefined) { this.difficulty = sv.difficulty; this.diff = DIFF_CAL[sv.difficulty] || this.diff; }
    if (sv.autoLethality !== undefined) this.autoLethality = sv.autoLethality;
    if (sv.killCodeUses !== undefined) this.killCodeUses = sv.killCodeUses;
    if (sv.plagueOwned) this.plagueOwned = sv.plagueOwned;
    if (this.cureMode) this.recomputeCureBoost();
  };

  /* UI hook: plague-specific action buttons, computed from live engine state. */
  Engine.prototype.specialActions = function () {
    var self = this, out = [];
    // fungus: next spore burst node in the two chains (data: change_to_spore_counter nodes)
    var sporeNodes = Object.keys(this.data.disease.nodes).filter(function (id) {
      return num(self.data.disease.nodes[id].change_to_spore_counter) > 0 &&
        !self.owned[id] && Model.nodeAvailable(self.data.disease.nodes[id], self.owned);
    });
    if (sporeNodes.length) {
      sporeNodes.sort(function (a, b) { return self.nodeCost(a) - self.nodeCost(b); });
      var sid = sporeNodes[0];
      out.push({ id: 'spore', kind: 'spore', node: sid, cost: this.nodeCost(sid),
        label: '孢子爆发', hint: '感染新的国家' });
    }
    // nano-virus 终止码 (requires kill_switch_stasis evolved)
    if (this.killCodeUnlocked()) {
      out.push({ id: 'killcode', kind: 'killcode', cost: this.killCodeCost(),
        label: '终止码广播', hint: '清空解药进度 (需求×' + CAL.KILLCODE_PENALTY + ')' });
    }
    return out;
  };

  Engine.prototype.snapshotForTest = function () {
    var t = this.totals();
    return {
      day: this.day, dna: this.dna, infected: t.infected, dead: t.dead, healthy: t.healthy,
      cure: this.cure.progress, infectiousness: this.traits.infectiousness,
      severity: this.traits.severity, lethality: this.traits.lethality,
      effSeverity: this.effSeverity(), effLethality: this.effLethality(),
      plagueType: this.plagueTypeGui, autoLethality: this.autoLethality,
      killCodeUses: this.killCodeUses, difficulty: this.difficulty,
      countriesInfected: Object.keys(this.countries).filter(function (k) {
        return this.countries[k].infected > 0;
      }, this).length,
      openAirports: Object.keys(this.countries).filter(function (k) {
        return this.countries[k].airOpen && this.data.countries[k].airport;
      }, this).length
    };
  };

  Engine.CAL = CAL;
  return Engine;
});
