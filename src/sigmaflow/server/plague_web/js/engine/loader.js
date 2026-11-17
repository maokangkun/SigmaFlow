/* Data loader — node (fs) and browser (fetch) modes.
 * v2: loads all 7 standard plague trees + the cure-mode tree + 3 scenario packages.
 * Scenario adapter: scenario data_files use disease_tech for the node map — normalize to
 * {global, nodes}; per-scenario rules are calibrated constants (annotated) motivated by the
 * scenario's own data (scen_description / scen_plague_type / govactions table). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var fs = require('fs'), path = require('path');
    module.exports = factory(function (p) {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', p), 'utf8'));
    });
  } else {
    root.PlagueEng = root.PlagueEng || {};
    root.PlagueEng.loadData = factory(function (p) {
      return fetch('data/' + p).then(function (r) {
        if (!r.ok) throw new Error('cannot load data/' + p + ': ' + r.status);
        return r.json();
      });
    });
    /* same api object under a stable name for ui/main.js (assignment inside the factory
     * body is not visible here — Chromium closures over UMD args from factory bodies
     * proved unreliable; this branch's direct statements are the working pattern) */
    root.PlagueEng.Scenarios = root.PlagueEng.loadData;
  }
})(typeof self !== 'undefined' ? self : this, function (readJson) {
  'use strict';

  /* The 7 standard plagues (phase-0 diseases/ files). ids == file stems. */
  var PLAGUES = ['bacteria', 'virus', 'fungus', 'parasite', 'prion', 'rogue_nanobot', 'escaped_bio_weapon'];
  /* Scenario selection card: 3 official scenarios deep-mined in phase 0. */
  var SCENARIOS = ['black_death', 'board_game', 'cure'];

  function loadAll(read) {
    var diseases = {};
    PLAGUES.forEach(function (p) { diseases[p] = read('diseases/' + p + '.json'); });
    diseases.cure_tree = read('diseases/cure.json');      // cure-mode response tree
    var scenarios = {};
    SCENARIOS.forEach(function (s) { scenarios[s] = read('scenarios/' + s + '.json'); });
    return {
      countries: read('countries.json'),
      disease: diseases.bacteria,     // default (phase-1 compat); UI swaps by selection
      diseases: diseases,
      scenarios: scenarios,
      routes: read('routes.json'),
      govactions: read('govactions.json'),
      events: read('events.json'),
      genes: read('genes.json'),
      l10n: read('l10n_zh.json'),
      landAdjacency: read('land_adjacency.json'),
      newsFlavor: read('news_flavor.json'),
      icons: read('icons_manifest.json')
    };
  }

  /* Normalize a scenario package into engine opts pieces:
   *  { disease:{global,nodes}, govActionsData|null, govTable|null, rules, plagueFile, info }
   * Rules are calibration (annotated), each motivated by scenario data:
   *  - black_death: scenario ships its own govactions_standard (43 actions, 3 differing from
   *    the standard table) + a bacteria tree with 13 scenario-specific nodes; 医疗效率×0.35
   *    近似 realizes the task's "无现代医疗" rule (medieval plague vs modern antibiotics).
   *  - board_game: neurax tree (80 nodes, hype/complexity as inf/severity); goal 风靡全球 =
   *    every country reached (winMode ubiquity); the scenario text gives investors "two years"
   *    → 730-day limit. Uses the main govactions_neurax table (the scenario's own file is empty).
   *  - cure: reverse play simplified to 解药加速方 (annotated in UI): the player evolves the
   *    cure-mode response tree (diseases/cure.json); the plague is the standard bacteria tree
   *    restricted to the scenario's scen_symptoms list, auto-evolving on a timer. */
  function scenarioConfig(scenJson, diseases) {
    var id = scenJson.id;
    var df = scenJson.data_files;
    var out = { info: scenJson.info || {}, rules: {}, plagueFile: null };
    if (id === 'black_death') {
      var bd = df['bacteria.txt'];
      out.disease = { global: bd.global, nodes: bd.disease_tech };
      out.govActionsData = df['govactions_standard.txt'].government_actions;
      out.rules = { medicalMult: 0.35, label: '黑死病 · 中世纪菌株 (医疗效率×0.35, 近似)' };
      out.plagueFile = 'black_death';
    } else if (id === 'board_game') {
      var bg = df['neurax.txt'];
      out.disease = { global: bg.global, nodes: bg.disease_tech };
      out.govTable = 'govactions_neurax';
      out.rules = { winMode: 'ubiquity', timeLimitDays: 730, noGovActions: true, spreadMult: 0.03,
        label: '极致桌游 · 两年内风靡全球 (简化: 胜利=所有国家可买到, 扩散×0.1, 无政府防疫)' };
      out.plagueFile = 'board_game';
    } else if (id === 'cure') {
      out.disease = diseases.cure_tree;
      out.govTable = 'govactions_standard';
      var si = df['scenario.txt']['Scenario Information'];
      var symIds = String(si.scen_symptoms || '').split(',').filter(Boolean);
      var nodes = {};
      var src = diseases.bacteria.nodes;
      symIds.forEach(function (sid) { if (src[sid]) nodes[sid] = src[sid]; });
      out.plagueData = { global: diseases.bacteria.global, nodes: nodes };
      out.rules = { cureMode: true, label: '解药加速方 · 简化反向模式 (拯救世界)' };
      out.plagueFile = 'cure';
    } else {
      throw new Error('unknown scenario ' + id);
    }
    return out;
  }

  var api = {
    PLAGUES: PLAGUES,
    SCENARIOS: SCENARIOS,
    sync: function () { return loadAll(readJson); },
    scenarioConfig: scenarioConfig,
    browser: function () {
      var names = ['countries.json'].concat(
        PLAGUES.map(function (p) { return 'diseases/' + p + '.json'; }),
        ['diseases/cure.json'],
        SCENARIOS.map(function (s) { return 'scenarios/' + s + '.json'; }),
        ['routes.json', 'govactions.json', 'events.json', 'genes.json', 'l10n_zh.json',
          'land_adjacency.json', 'news_flavor.json', 'icons_manifest.json']);
      return Promise.all(names.map(readJson)).then(function (rs) {
        var diseases = {};
        PLAGUES.forEach(function (p, i) { diseases[p] = rs[1 + i]; });
        diseases.cure_tree = rs[1 + PLAGUES.length];
        var scenarios = {};
        SCENARIOS.forEach(function (s, i) { scenarios[s] = rs[2 + PLAGUES.length + i]; });
        return {
          countries: rs[0], disease: diseases.bacteria, diseases: diseases,
          scenarios: scenarios,
          routes: rs[2 + PLAGUES.length + SCENARIOS.length],
          govactions: rs[3 + PLAGUES.length + SCENARIOS.length],
          events: rs[4 + PLAGUES.length + SCENARIOS.length],
          genes: rs[5 + PLAGUES.length + SCENARIOS.length],
          l10n: rs[6 + PLAGUES.length + SCENARIOS.length],
          landAdjacency: rs[7 + PLAGUES.length + SCENARIOS.length],
          newsFlavor: rs[8 + PLAGUES.length + SCENARIOS.length],
          icons: rs[9 + PLAGUES.length + SCENARIOS.length]
        };
      });
    }
  };
  return api;
});
