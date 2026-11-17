/* Gene system — start-of-game loadout of 5 genes (one per standard slot:
 * dna / evolve / mutation / travel / environmental), all effects read from
 * data/genes.json fields. Every numeric value below the field mapping is data;
 * the only constants are the calibration scales (CAL, commented).
 *
 * Field mapping (raw genes.json field → engine effect):
 *   bonus_dna                    → +starting DNA (exact: ATP Boost +8)
 *   blue_bubble_bonus_dna        → +DNA per time bubble (exact +1)
 *   bonus_arid/humid/rural/urban → +matching country trait (exact)
 *   bonus_air/land/sea_transfer  → +air/land/sea_transmission trait (exact)
 *   mutation_chance              → +mutation trait (exact, floored at 0)
 *   change_to_cure_base_multiplier → +cure work required (exact)
 *   orange_bubble_mult           → infection-DNA multiplier 1 + v×BUBBLE_SCALE (近似: original
 *                                  adds +v DNA per orange bubble; our orange income is continuous)
 *   red_bubble_mult              → death-DNA multiplier, same scale; red income itself is new
 *                                  (CAL.DNA_PER_DEATH in engine.js) (近似)
 *   devolve_dna_add              → +DNA flat on every devolve (exact: Ionised Helix +2)
 *   s/a/t_cost_increase          → cost inflation frozen for that grid_type (Stasis genes,
 *                                  canonical "costs stop increasing") (近似: our inflation is a
 *                                  single global rate, frozen per category)
 *   bubble_autopress             → bubbles auto-collected — our engine always collects, so this
 *                                  gene's net effect is only its negative mults (documented)
 *   closed_borders_spread_enhance → closed borders still leak (Suppression gene) (近似 factor)
 *   nexus_bonus                  → spread bonus inside patient-zero country (Native Biome) (近似)
 *   t/a_random_mutations         → random mutations may also hit transmission/ability nodes (exact intent)
 *   devolve_stop_increase        → no-op in our cost model (devolve costs never ramp) (documented)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PlagueEng = root.PlagueEng || {}; root.PlagueEng.Genes = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CAL = {
    BUBBLE_SCALE: 0.25,   // orange/red bubble mult v → income ×(1+0.25v); Cytochrome Surge 4 → ×2 (校准)
    BORDER_LEAK: 0.5,     // with Suppression gene a closed border still passes 50% flow (校准)
    NEXUS_BONUS: 0.35     // Native Biome: patient-zero country spread ×1.35 (校准)
  };

  /* The five standard slots, in canonical order (genes.json gene_category values). */
  var SLOTS = ['dna', 'evolve', 'mutation', 'travel', 'environmental'];

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

  /* selection: { dna: geneId|null, evolve: …, mutation: …, travel: …, environmental: … } */
  function apply(genesData, selection) {
    var m = {
      startDna: 0, trickleAdd: 0,
      traitAdds: {},                 // trait key → delta (arid/humid/rural/urban/air/land/sea/mutation/cure)
      orangeMult: 1, redMult: 1,
      devolveAdd: 0,
      costFreeze: { symptom: false, ability: false, transmission: false },
      borderLeak: 1,                 // 1 = closed border fully blocks (default)
      nexusBonus: 0,
      mutPools: { transmission: false, ability: false },
      picked: []
    };
    if (!genesData || !selection) return m;
    SLOTS.forEach(function (slot) {
      var id = selection[slot];
      if (!id) return;
      var g = genesData[id];
      if (!g || g.gene_category !== slot) return;   // data integrity: gene must belong to the slot
      m.picked.push(id);
      m.startDna += num(g.bonus_dna);
      m.trickleAdd += num(g.blue_bubble_bonus_dna);
      var traitMap = {
        bonus_arid: 'arid', bonus_humid: 'humid', bonus_rural: 'rural', bonus_urban: 'urban',
        bonus_air_transfer: 'air_transmission', bonus_land_transfer: 'land_transmission',
        bonus_sea_transfer: 'sea_transmission', mutation_chance: 'mutation',
        change_to_cure_base_multiplier: 'cure_base_multiplier'
      };
      Object.keys(traitMap).forEach(function (f) {
        if (num(g[f])) m.traitAdds[traitMap[f]] = (m.traitAdds[traitMap[f]] || 0) + num(g[f]);
      });
      m.orangeMult *= 1 + num(g.orange_bubble_mult) * CAL.BUBBLE_SCALE;
      m.redMult *= 1 + num(g.red_bubble_mult) * CAL.BUBBLE_SCALE;
      m.devolveAdd += num(g.devolve_dna_add);
      if (num(g.s_cost_increase)) m.costFreeze.symptom = true;
      if (num(g.a_cost_increase)) m.costFreeze.ability = true;
      if (num(g.t_cost_increase)) m.costFreeze.transmission = true;
      if (num(g.closed_borders_spread_enhance)) m.borderLeak = CAL.BORDER_LEAK;
      if (num(g.nexus_bonus)) m.nexusBonus = CAL.NEXUS_BONUS;
      if (num(g.t_random_mutations)) m.mutPools.transmission = true;
      if (num(g.a_random_mutations)) m.mutPools.ability = true;
    });
    return m;
  }

  return { CAL: CAL, SLOTS: SLOTS, apply: apply };
});
