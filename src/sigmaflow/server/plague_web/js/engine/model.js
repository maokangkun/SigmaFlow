/* Disease trait model — pure data-driven aggregation over the disease evolution tree.
 *
 * All numbers come from data/diseases/<plague>.json:
 *  - the "global" block seeds every trait (base disease before any evolution),
 *  - each node's change_to_* fields add to the matching trait,
 *  - cost is negative in the raw data (DNA cost = Math.abs(cost)).
 *
 * CALIBRATION constants live in CAL below and are commented; everything else is data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PlagueEng = root.PlagueEng || {}; root.PlagueEng.Model = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- CALIBRATION (not from data tables) ----
   * BASE_SEED: infectivity "points" credited to the starting pathogen before any node
   *   (bacteria global block starts global_infectiousness at 0; the real game's zero-day
   *   plague still spreads, this is that floor).
   * ATTR_FLOOR/CAP: clamp for the per-country attribute multiplier.
   */
  var CAL = {
    BASE_SEED: 4,
    ATTR_FLOOR: 0.55,
    ATTR_CAP: 4.0
  };

  var TRAIT_KEYS = [
    'wealthy', 'poverty', 'urban', 'rural', 'hot', 'cold', 'humid', 'arid',
    'air_transmission', 'sea_transmission', 'land_transmission', 'corpse_transmission',
    'mutation', 'cure_base_multiplier', 'research_inefficiency_multiplier',
    'spore_counter', 'gene_compression_counter'
  ];
  var GLOBAL_EXTRA_KEYS = [
    'global_air_rate', 'global_sea_rate', 'global_land_rate',
    'global_infectiousness', 'global_severity', 'global_lethality',
    'land_transmission', 'sea_transmission', 'air_transmission'
  ];

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

  /* TraitState: starting traits from the disease global block. */
  function traitsFromGlobal(g) {
    var t = {
      infectiousness: num(g.global_infectiousness),
      severity: num(g.global_severity),
      lethality: num(g.global_lethality)
    };
    TRAIT_KEYS.forEach(function (k) { t[k] = num(g[k]); });
    t.global_air_rate = num(g.global_air_rate);
    t.global_sea_rate = num(g.global_sea_rate);
    t.global_land_rate = num(g.global_land_rate);
    /* cure research RATE multiplier from the disease global block (raw field name has the
     * original typo "multipler"). prion 0.2 (cure 5x slower), bio-weapon 0.18,
     * nano-virus 1.45 (cure 45% faster, race from day 0); absent elsewhere → 1. */
    t.cure_research_rate_mult = g.cure_requirement_base_multipler > 0 ?
      num(g.cure_requirement_base_multipler) : 1;
    return t;
  }

  /* Apply one node's change_to_* fields onto traits (sign=+1 evolve, -1 devolve). */
  function applyNode(traits, node, sign) {
    traits.infectiousness += sign * num(node.change_to_infectiousness);
    traits.severity += sign * num(node.change_to_severity);
    traits.lethality += sign * num(node.change_to_lethality);
    for (var i = 0; i < TRAIT_KEYS.length; i++) {
      var k = TRAIT_KEYS[i];
      var key = 'change_to_' + k;
      if (node[key] !== undefined) traits[k] += sign * num(node[key]);
    }
  }

  /* Country attribute multiplier: 1 + Σ flag_c[a]·trait[a]
   * e.g. base bacteria: poverty 1 / urban 1 / rural 1 / hot .1 / cold .1 / humid 1 / arid 1 / wealthy 0
   * → poor rural hot country bonus = 1+1+1+0.1 = 3.1×, rich temperate = 1+0 = 1.0×.
   */
  function attributeMultiplier(traits, c) {
    var m = 1 +
      c.wealthy * traits.wealthy + c.poverty * traits.poverty +
      c.urban * traits.urban + c.rural * traits.rural +
      c.hot * traits.hot + c.cold * traits.cold +
      c.humid * traits.humid + c.arid * traits.arid;
    return Math.min(CAL.ATTR_CAP, Math.max(CAL.ATTR_FLOOR, m));
  }

  /* Requirement check: tech_requirement_and/or are either 0 or a comma list of node ids.
   * and = all listed must be owned; or = at least one. */
  function reqList(v) {
    if (typeof v === 'string' && v.trim()) return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (typeof v === 'number' && v) return [String(v)];
    return [];
  }
  function nodeAvailable(node, owned) {
    var and = reqList(node.tech_requirement_and);
    for (var i = 0; i < and.length; i++) if (!owned[and[i]]) return false;
    var or = reqList(node.tech_requirement_or);
    if (or.length) {
      var ok = false;
      for (var j = 0; j < or.length; j++) if (owned[or[j]]) { ok = true; break; }
      if (!ok) return false;
    }
    return true;
  }

  return {
    CAL: CAL,
    TRAIT_KEYS: TRAIT_KEYS,
    traitsFromGlobal: traitsFromGlobal,
    applyNode: applyNode,
    attributeMultiplier: attributeMultiplier,
    nodeAvailable: nodeAvailable,
    reqList: reqList
  };
});
