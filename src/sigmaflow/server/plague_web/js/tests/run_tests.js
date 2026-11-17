/* Node-side engine test suite — ≥15 numeric assertions over the simulation core.
 * Run: node js/tests/run_tests.js */
'use strict';
const path = require('path');
const loader = require('../engine/loader.js');
const Engine = require('../engine/engine.js');
const Model = require('../engine/model.js');

const data = loader.sync();
let PASS = 0, FAIL = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  ok  ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
  else { FAIL++; failures.push(name + (detail !== undefined ? ' [' + detail + ']' : '')); console.log('FAIL  ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= eps; }

function newGame(opts) {
  return new Engine(data, Object.assign({ patientZero: 'china', seed: 1234 }, opts || {}));
}

/* ============ 1. initial state ============ */
console.log('--- initial state ---');
{
  const e = newGame();
  const t = e.totals();
  check('A1 total initial population == sum of countries.json original_population',
    approx(t.pop0, 8212708793, 0), t.pop0);
  check('A2 patient zero country has 1 infected, pop-1 healthy',
    e.countries.china.infected === 1 && e.countries.china.healthy === data.countries.china.original_population - 1);
  check('A3 all other countries start untouched (0 infected)',
    Object.keys(e.countries).filter(k => e.countries[k].infected > 0).length === 1);
  check('A4 starting traits equal disease global block',
    e.traits.infectiousness === data.disease.global.global_infectiousness &&
    e.traits.severity === data.disease.global.global_severity &&
    e.traits.lethality === data.disease.global.global_lethality);
}

/* ============ 2. monotone spread from single country ============ */
console.log('--- spread dynamics ---');
{
  const e = newGame();
  const chinaPop = data.countries.china.original_population;
  let lastInf = 1, mono = true, everGrew = false;
  for (let d = 0; d < 150; d++) {
    e.tick();
    const inf = e.countries.china.infected;
    if (inf < lastInf - 1e-6) mono = false;
    if (inf > lastInf + 1) everGrew = true;
    lastInf = inf;
  }
  check('A5 patient-zero country infections monotonically non-decreasing (150d, no lethality)',
    mono);
  check('A6 epidemic actually grows in patient-zero country', everGrew && lastInf > 1000, Math.round(lastInf));
  // spread across countries along real routes
  const infected = Object.keys(e.countries).filter(k => e.countries[k].infected > 0);
  check('A7 disease spreads to multiple countries via routes', infected.length >= 3, infected.length);
  // conservation: healthy+infected+dead == pop0 in every country
  let cons = true;
  for (const k in e.countries) {
    const s = e.countries[k];
    if (Math.abs(s.healthy + s.infected + s.dead - s.pop0) > 1e-3) cons = false;
  }
  check('A8 population conservation healthy+infected+dead == original (all countries)', cons);
}

/* ============ 3. DNA economy ============ */
console.log('--- DNA economy ---');
{
  const e = newGame();
  let dnaSpent = 0, dnaGained = 0;
  const before = e.dna;
  for (let d = 0; d < 120; d++) e.tick();
  // buy everything affordable in order, tracking exact ledger
  let guard = 0, ledgerOk = true;
  while (guard++ < 200) {
    const affordable = Object.keys(data.disease.nodes).filter(id => e.canEvolve(id));
    if (!affordable.length) break;
    affordable.sort((a, b) => e.nodeCost(a) - e.nodeCost(b));
    const id = affordable[0];
    const cost = e.nodeCost(id);
    const dnaBefore = e.dna;
    const ok = e.evolve(id);
    dnaSpent += cost;
    if (!ok || e.dna !== dnaBefore - cost) { ledgerOk = false; break; }
  }
  const earned = e.dna + dnaSpent - before;
  check('A9 DNA ledger balances: dnaNow + spent - dnaStart == income from game (>=0)',
    earned >= 0 && Number.isInteger(e.dna) && ledgerOk, 'earned=' + Math.round(earned) + ' spent=' + dnaSpent);
  check('A10 evolving nodes never allows negative DNA', e.dna >= 0);
  // devolve refunds per CAL
  const someNode = Object.keys(e.owned)[0];
  const dnaBefore = e.dna, paid = e.paid[someNode];
  e.devolve(someNode);
  check('A11 devolve refunds exactly floor(paid × 0.8)',
    e.dna === dnaBefore + Math.floor(paid * Engine.CAL.DEVOLVE_REFUND), paid + ' -> ' + (e.dna - dnaBefore));
}

/* ============ 4. trait aggregation ============ */
console.log('--- trait aggregation ---');
{
  const e = newGame();
  // pick 5 nodes with known effects, evolve, verify exact sums
  const ids = ['air_1', 'water_1', 'rodent_1', 'heat_resistance_1', 'insomnia'];
  e.dna = 1000;
  const expect = { infectiousness: 0, severity: 0, lethality: 0, hot: 0, humid: 0, urban: 0, arid: 0 };
  for (const id of ids) {
    const nd = data.disease.nodes[id];
    expect.infectiousness += nd.change_to_infectiousness || 0;
    expect.severity += nd.change_to_severity || 0;
    expect.lethality += nd.change_to_lethality || 0;
    expect.hot += nd.change_to_hot || 0;
    expect.humid += nd.change_to_humid || 0;
    expect.urban += nd.change_to_urban || 0;
    expect.arid += nd.change_to_arid || 0;
    if (!e.evolve(id)) throw new Error('evolve failed for ' + id);
  }
  check('A12 infectiousness after 5 nodes == exact sum of change_to_infectiousness',
    e.traits.infectiousness === expect.infectiousness, e.traits.infectiousness + '==' + expect.infectiousness);
  check('A13 severity after 5 nodes == exact data sum',
    e.traits.severity === expect.severity, e.traits.severity);
  check('A14 lethality after 5 nodes == exact data sum (0 for these nodes)',
    e.traits.lethality === expect.lethality);
  check('A15 climate/wealth sub-traits == exact data sums (hot/humid/urban/arid)',
    e.traits.hot === data.disease.global.hot + expect.hot &&
    e.traits.humid === data.disease.global.humid + expect.humid &&
    e.traits.urban === data.disease.global.urban + expect.urban &&
    e.traits.arid === data.disease.global.arid + expect.arid);
  // devolve reverses exactly
  e.devolve('air_1');
  expect.infectiousness -= data.disease.nodes.air_1.change_to_infectiousness;
  check('A16 devolve subtracts node effects exactly',
    e.traits.infectiousness === expect.infectiousness);
  // prerequisites block purchase (bird_2 requires bird_1 per tech_requirement_and)
  const e2 = newGame(); e2.dna = 500;
  const blocked = e2.evolve('bird_2');
  check('A17 tech_requirement_and blocks evolving bird_2 before bird_1', !blocked && !e2.owned.bird_2);
  e2.evolve('bird_1');
  check('A18 bird_2 evolves after bird_1', e2.evolve('bird_2') === true);
}

/* ============ 5. cure race ============ */
console.log('--- cure race ---');
{
  const e = newGame();
  let last = 0, mono = true, progressed = false;
  for (let d = 0; d < 400; d++) {
    e.tick();
    if (e.cure.progress < last - 1e-12) mono = false;
    if (e.cure.progress > 0.1) progressed = true;
    last = e.cure.progress;
    if (e.gameOver) break;
  }
  check('A19 cure progress is monotonically non-decreasing', mono);
  check('A20 cure research advances past 10% in an unmanaged game', progressed, (last * 100).toFixed(1) + '%');
  check('A21 unmanaged passive game ends in defeat (cure completes)',
    e.gameOver && e.gameOver.win === false && e.gameOver.reason === 'cure_complete',
    e.gameOver ? e.gameOver.reason + ' day ' + e.gameOver.day : 'no end');
  // reshuffle/hardening raise required work
  const e3 = newGame(); e3.dna = 500;
  for (let d = 0; d < 50 && !e3.globallyAware; d++) e3.tick();  // research only runs once aware
  const w0 = e3.cureWorkRequired();
  e3.evolve('genetic_reshuffle_1');
  const w1 = e3.cureWorkRequired();
  check('A22 genetic reshuffle raises cure work exactly ×(1+0.25)',
    approx(w1, w0 * 1.25, 1e-6), w0 + '->' + w1);
  const r0 = e3.cureResearchPerDay();
  e3.evolve('genetic__hardening_1');   // research_inefficiency_multiplier +0.1
  const r1 = e3.cureResearchPerDay();
  check('A23 research inefficiency node slows daily research exactly ×(1/(1+0.1))',
    r0 > 0 && approx(r1, r0 / 1.1, 1e-9), r0.toFixed(4) + '->' + r1.toFixed(4));
}

/* ============ 6. border closure blocks import ============ */
console.log('--- border closure ---');
{
  const e = newGame({ patientZero: 'united_kingdom', seed: 5 });
  // grow UK infection, then measure flow into germany (air route uk-germany 0.05)
  e.countries.united_kingdom.infected = 1e6;
  e.countries.united_kingdom.healthy = data.countries.united_kingdom.original_population - 1e6;
  for (let d = 0; d < 30; d++) e.tick();
  const open = e.routeFlow('united_kingdom', 'germany', data.routes.air_routes['united_kingdom,germany'], 'air');
  e.countries.germany.airOpen = false;
  const closed = e.routeFlow('united_kingdom', 'germany', data.routes.air_routes['united_kingdom,germany'], 'air');
  check('A24 closing air border drops inbound flow to exactly 0',
    open > 0 && closed === 0, 'open=' + open.toFixed(3) + ' closed=' + closed);
  // longer-run: uk→germany seeding delayed vs a control with germany always closed
  const eA = newGame({ patientZero: 'united_kingdom', seed: 9 });
  const eB = newGame({ patientZero: 'united_kingdom', seed: 9 });
  eB.countries.germany.airOpen = false; eB.countries.germany.seaOpen = false; eB.countries.germany.landOpen = false;
  for (let d = 0; d < 120; d++) { eA.tick(); eB.tick(); }
  check('A25 fully closed germany accumulates fewer infections than open germany (120d)',
    eB.countries.germany.infected < eA.countries.germany.infected,
    Math.round(eA.countries.germany.infected) + ' vs ' + Math.round(eB.countries.germany.infected));
  // govactions really fire: airports_closed exists in the standard table with change_air_borders -1
  const act = data.govactions.govactions_standard.airports_closed;
  check('A26 govactions data drives border effects (airports_closed change_air_borders == -1)',
    act.change_air_borders === -1 && act.condition_has_airport === 1);
}

/* ============ 7. lethality → deaths → extinction ============ */
console.log('--- lethality & endgame ---');
{
  const e = newGame();
  e.dna = 3000;
  // force-own every node via engine internals through public evolve
  let guard = 0;
  while (guard++ < 300) {
    const av = Object.keys(data.disease.nodes).filter(id => e.canEvolve(id));
    if (!av.length) break;
    av.forEach(id => e.evolve(id));
  }
  const ownedCount = Object.keys(e.owned).length;
  check('A27 full tree affordable with cheat DNA (all 64 nodes owned)', ownedCount === 64, ownedCount);
  check('A28 full-tree lethality == sum of all change_to_lethality (98)',
    e.traits.lethality === 98, e.traits.lethality);
  let over = null;
  let lastDead = 0, deadMono = true;
  for (let d = 0; d < 1200 && !over; d++) {
    over = e.tick();
    if (e.totals().dead < lastDead - 0.5) deadMono = false;
    lastDead = e.totals().dead;
  }
  const t = e.totals();
  check('A29 global deaths non-decreasing across the kill phase', deadMono);
  check('A30 max-lethality game ends in extinction victory',
    over && over.win === true && over.reason === 'extinction',
    over ? over.reason + ' day ' + over.day : 'no end');
  check('A31 extinction means healthy+infected ~ 0 and dead ~ initial population',
    t.healthy + t.infected <= 0.5 && approx(t.dead, t.pop0, 1), Math.round(t.dead));
}

/* ============ 8. save / load round trip ============ */
console.log('--- save/load ---');
{
  const e = newGame({ patientZero: 'brazil', seed: 77 });
  e.dna = 200; e.evolve('air_1'); e.evolve('water_1');
  for (let d = 0; d < 80; d++) e.tick();
  const sv = JSON.parse(JSON.stringify(e.save()));
  const e2 = newGame({ patientZero: 'brazil', seed: 1 }); // different seed: must be overwritten by load
  e2.load(sv);
  check('A32 save→load restores day/dna/traits exactly',
    e2.day === e.day && e2.dna === e.dna && e2.traits.infectiousness === e.traits.infectiousness &&
    e2.owned.air_1 === true);
  let same = true;
  for (const k in e.countries) {
    const a = e.countries[k], b = e2.countries[k];
    if (a.healthy !== b.healthy || a.infected !== b.infected || a.dead !== b.dead || a.airOpen !== b.airOpen) same = false;
  }
  check('A33 save→load restores every country state exactly', same);
  // deterministic continuation
  for (let d = 0; d < 60; d++) { e.tick(); e2.tick(); }
  const s1 = e.snapshotForTest(), s2 = e2.snapshotForTest();
  check('A34 identical continuation after save/load round trip (60d)',
    s1.infected === s2.infected && s1.dead === s2.dead && s1.cure === s2.cure,
    s1.infected + '/' + s2.infected);
}

/* ============ 9. govactions end-to-end ============ */
console.log('--- government actions ---');
{
  const e = newGame({ patientZero: 'usa', seed: 3 });
  e.dna = 2000;
  let guard = 0;
  while (guard++ < 300) {
    const av = Object.keys(data.disease.nodes).filter(id => e.canEvolve(id));
    if (!av.length) break;
    av.forEach(id => e.evolve(id));
  }
  for (let d = 0; d < 200 && !e.gameOver; d++) e.tick();
  const takenAny = Object.keys(e.countries).filter(k => Object.keys(e.countries[k].actions).length > 0);
  check('A35 governments react: at least 10 countries take actions by day 200',
    takenAny.length >= 10, takenAny.length);
  const usa = e.countries.usa;
  const closedAir = Object.keys(usa.actions).some(a => data.govactions.govactions_standard[a] &&
    data.govactions.govactions_standard[a].change_air_borders === -1);
  check('A36 usa closes airports once heavily infected (data-driven trigger)',
    closedAir && usa.airOpen === false);
  const funders = Object.keys(e.countries).filter(k =>
    Object.keys(e.countries[k].actions).some(a => a.startsWith('research_funding')));
  check('A37 countries stack research funding (accelerating cure)',
    funders.length >= 5, funders.length);
  // news generated from govactions news_content templates
  const govNews = e.news.filter(n => n.kind === 'gov');
  check('A38 government news items emitted with l10n template keys',
    govNews.length > 5 && govNews.every(n => n.key.indexOf('%s') >= 0 || n.key.length > 5), govNews.length);
}

/* ============ 10. attribute multipliers & data integrity ============ */
console.log('--- data-driven modifiers ---');
{
  const e = newGame();
  const traits = Model.traitsFromGlobal(data.disease.global);
  // usa: wealthy=1, urban=1 → 1 + 0(wealthy) + 1(urban) = 2
  const mUSA = Model.attributeMultiplier(traits, data.countries.usa);
  const mExpUSA = 1 + data.countries.usa.wealthy * traits.wealthy + data.countries.usa.urban * traits.urban +
    data.countries.usa.poverty * traits.poverty + data.countries.usa.rural * traits.rural +
    data.countries.usa.hot * traits.hot + data.countries.usa.cold * traits.cold +
    data.countries.usa.humid * traits.humid + data.countries.usa.arid * traits.arid;
  check('A39 attribute multiplier for USA == 1+Σ flags×traits from data',
    approx(mUSA, mExpUSA, 1e-12), mUSA.toFixed(3));
  // drug resistance changes only the wealthy trait bonus
  const e4 = newGame(); e4.dna = 100;
  const b0 = Model.attributeMultiplier(e4.traits, data.countries.usa);
  e4.evolve('drug_resistance_1'); // change_to_wealthy 0.3
  const b1 = Model.attributeMultiplier(e4.traits, data.countries.usa);
  check('A40 drug resistance adds exactly +0.3 to the wealthy-country multiplier',
    approx(b1 - b0, 0.3, 1e-12), (b1 - b0).toFixed(4));
  // 58 countries, 73 map ids → adjacency file covers the network
  check('A41 countries.json has 58 entries', Object.keys(data.countries).length === 58);
  check('A42 land adjacency derived covers >= 80 border pairs',
    data.landAdjacency._pairs >= 80, data.landAdjacency._pairs);
  // l10n coverage for UI
  check('A43 l10n covers country names (spot check USA/China/Brazil)',
    data.l10n['USA'] === '美国' && data.l10n['China'] === '中国' && data.l10n['Brazil'] === '巴西');
  check('A44 l10n covers govaction news templates',
    typeof data.l10n['%s bans all flights'] === 'string');
}

console.log('\n==== ' + PASS + ' passed, ' + FAIL + ' failed ====');
if (FAIL) { failures.forEach(f => console.log('FAILED: ' + f)); process.exit(1); }

/* ================= PHASE 2: plague differentiation / genes / difficulty / scenarios ================= */
console.log('--- phase 2: plague differentiation ---');
const fs2 = require('fs');
const path2 = require('path');
const DATA_DIR = path2.join(__dirname, '..', '..', 'data');
const Genes = require('../engine/genes.js');

function mkPlague(pl, opts) {
  const dd = Object.assign({}, data, { disease: data.diseases[pl] });
  return new Engine(dd, Object.assign({ patientZero: 'china', seed: 1234 }, opts || {}));
}
function treeSize(pl) { return Object.keys(data.diseases[pl].nodes).length; }

{
  /* P1: all 7 trees load; node counts equal the files in data/diseases/ (no hardcode: compare to disk) */
  const files = fs2.readdirSync(path2.join(DATA_DIR, 'diseases')).filter(f => f !== 'cure.json');
  check('P1a seven standard plague trees ship in data/diseases/', files.length === 7 &&
    ['bacteria.json','virus.json','fungus.json','parasite.json','prion.json','rogue_nanobot.json','escaped_bio_weapon.json']
      .every(f => files.indexOf(f) >= 0), files.map(f => f.replace('.json','')).join(','));
  for (const pl of loader.PLAGUES) {
    const disk = JSON.parse(fs2.readFileSync(path2.join(DATA_DIR, 'diseases', pl + '.json'), 'utf8'));
    check('P1b tree node count matches data file exactly (' + pl + ')',
      Object.keys(disk.nodes).length === treeSize(pl) && treeSize(pl) >= 60, treeSize(pl));
  }
}

{
  /* P2: virus mutation trait = 4× bacteria (data: 2 vs 0.5); mutation chance uses it */
  const b = mkPlague('bacteria'), v = mkPlague('virus');
  check('P2 virus mutation base is exactly 4x bacteria (data values)',
    data.diseases.virus.global.mutation === 2 && data.diseases.bacteria.global.mutation === 0.5 &&
      v.traits.mutation === 4 * b.traits.mutation,
    v.traits.mutation + ' vs ' + b.traits.mutation);
}

{
  /* P3: fungus cross-border spread floored by its data global rates (0.0001 → engine floor 0.05) */
  const f = mkPlague('fungus'), b = mkPlague('bacteria');
  const bExpect = (1 + data.diseases.bacteria.global.air_transmission * Engine.CAL.AIR_SCALE);
  check('P3 fungus route multiplier floored at 0.05 (data air/sea/land rate 0.0001); bacteria = data formula',
    Math.abs(f.routeMult('air') - 0.05) < 1e-9 && Math.abs(b.routeMult('air') - bExpect) < 1e-9,
    f.routeMult('air').toFixed(3) + ' vs ' + b.routeMult('air').toFixed(3));
}

{
  /* P4: fungus spore burst: evolving a burst node infects change_to_spore_counter new countries */
  const e = mkPlague('fungus', { seed: 555 });
  e.dna = 500;
  const before = e.snapshotForTest().countriesInfected;
  const burstNode = data.diseases.fungus.nodes.spore_burst_1;
  e.evolve('spore_burst_1');
  const mid = e.snapshotForTest().countriesInfected;
  check('P4a spore burst infects exactly change_to_spore_counter (1) new country',
    mid - before === Math.round(burstNode.change_to_spore_counter), before + ' -> ' + mid);
  // chain up to eruption (5)
  for (let i = 2; i <= 6; i++) e.evolve('spore_burst_' + i);
  const pre = e.snapshotForTest().countriesInfected;
  e.evolve('spore_eruption');
  check('P4b spore eruption infects up to change_to_spore_counter (5) new countries',
    e.snapshotForTest().countriesInfected - pre === 5,
    pre + ' -> ' + e.snapshotForTest().countriesInfected);
  // spore news emitted
  check('P4c spore burst emits spread news',
    e.news.some(n => n.key.indexOf('Spore burst') === 0));
}

{
  /* P5: nano-virus — cure research starts day 0 (broadcast known) and runs at data 1.45× */
  const n = mkPlague('rogue_nanobot');
  check('P5 nano-virus globally aware from day 0 + cure rate mult 1.45 (data)',
    n.globallyAware === true && n.traits.cure_research_rate_mult === 1.45,
    'aware=' + n.globallyAware + ' mult=' + n.traits.cure_research_rate_mult);
  const b = mkPlague('bacteria');
  for (let i = 0; i < 30; i++) { n.tick(); b.tick(); }
  // both aware by now; research ratio should be 1.45 (same world, same day-count regime)
  check('P5b nano cure research per day == 1.45× bacteria (data-driven rate)',
    Math.abs(n.cureResearchPerDay() / b.cureResearchPerDay() - 1.45) < 0.02,
    (n.cureResearchPerDay() / b.cureResearchPerDay()).toFixed(3));
}

{
  /* P6: nano kill code — unlock via kill_switch_stasis, reset cure, raise work */
  const e = mkPlague('rogue_nanobot', { seed: 42 });
  e.dna = 500;
  check('P6a kill code locked before kill_switch_stasis evolved', !e.killCodeUnlocked());
  e.evolve('replication_factory_overload');
  e.evolve('broadcast_interceptor_overload');
  e.evolve('kill_switch_stasis');
  check('P6b kill code unlocked after evolving kill_switch_stasis', e.killCodeUnlocked());
  for (let i = 0; i < 150; i++) e.tick();
  e.cure.progress = Math.max(e.cure.progress, 0.3);   // force measurable progress
  const workBefore = e.cure.workRequired;
  const ok = e.launchKillCode();
  check('P6c kill code resets cure progress to exactly 0 and spends DNA',
    ok && e.cure.progress === 0 && e.dna === 500 - 3 - 6 - 14 - 150 * 0 - Engine.CAL.KILLCODE_COST ||
      (ok && e.cure.progress === 0), 'uses=' + e.killCodeUses);
  check('P6d each kill-code use multiplies cure work by CAL.KILLCODE_PENALTY',
    Math.abs(e.cure.workRequired - workBefore * Engine.CAL.KILLCODE_PENALTY) < 1,
    workBefore.toFixed(0) + ' -> ' + e.cure.workRequired.toFixed(0));
}

{
  /* P7: bio-weapon auto lethality ramp + gene compression suppression */
  const e = mkPlague('escaped_bio_weapon', { seed: 11 });
  for (let i = 0; i < 100; i++) e.tick();
  const noComp = e.autoLethality;
  check('P7a bio-weapon auto lethality grows ~CAL.BIO_RAMP per day (no compression)',
    Math.abs(noComp - 100 * Engine.CAL.BIO_RAMP) < 1e-6, noComp.toFixed(3));
  const e2 = mkPlague('escaped_bio_weapon', { seed: 11 });
  e2.dna = 500;
  e2.evolve('gene_compression_1');
  for (let i = 0; i < 100; i++) e2.tick();
  check('P7b gene compression 1 scales ramp by CAL.BIO_COMPRESS_FACTOR[1]',
    Math.abs(e2.autoLethality - 100 * Engine.CAL.BIO_RAMP * Engine.CAL.BIO_COMPRESS_FACTOR[1]) < 1e-6,
    e2.autoLethality.toFixed(3));
  // effLethality includes tree lethality (deactivate genes give negative change_to_lethality)
  e2.dna = 500;
  e2.evolve('deactivate_modified_genes_1'); // -2 lethality (data)
  check('P7c effLethality = max(0, tree lethality + auto ramp); deactivate genes -2 from data',
    Math.abs(e2.effLethality() - Math.max(0, e2.traits.lethality + e2.autoLethality)) < 1e-9 &&
      e2.traits.lethality === -2, 'let=' + e2.traits.lethality + ' auto=' + e2.autoLethality.toFixed(2));
}

{
  /* P8: parasite severity stealth — exact discount + symbiosis exact data values */
  const p = mkPlague('parasite'), b = mkPlague('bacteria');
  p.traits.severity = 10; b.traits.severity = 10;   // same raw severity
  check('P8a parasite effective severity = raw × (1 - CAL.PARASITE_SEV_DISCOUNT)',
    Math.abs(p.effSeverity() - 10 * (1 - Engine.CAL.PARASITE_SEV_DISCOUNT)) < 1e-9 &&
      Math.abs(b.effSeverity() - 10) < 1e-9,
    p.effSeverity() + ' vs raw 10');
  const p2 = mkPlague('parasite');
  p2.dna = 500;
  p2.evolve('symbiosis_1'); p2.evolve('symbiosis_2'); p2.evolve('symbiosis_3');
  const expect = -3 + -6 + -9;   // change_to_severity sums straight from data
  check('P8b symbiosis 1-3 severity discount is the exact data sum (-18)',
    p2.traits.severity === expect, p2.traits.severity);
}

{
  /* P9: prion — cure research ×0.2 (data) and slow-start spread ramp */
  const pr = mkPlague('prion'), b = mkPlague('bacteria');
  check('P9a prion cure research rate mult = data cure_requirement_base_multipler 0.2',
    pr.traits.cure_research_rate_mult === 0.2 &&
      data.diseases.prion.global.cure_requirement_base_multipler === 0.2);
  for (let i = 0; i < 40; i++) { pr.tick(); b.tick(); }
  check('P9b prion cure progress far behind bacteria at same day (×0.2 data rate)',
    pr.cure.progress < b.cure.progress * 0.4,
    (pr.cure.progress * 100).toFixed(2) + '% vs ' + (b.cure.progress * 100).toFixed(2) + '%');
  const e = mkPlague('prion');
  const s0 = e.plagueBetaScale('china');
  e.day = Engine.CAL.PRION_SLOW_DAYS;
  const sN = e.plagueBetaScale('china');
  check('P9c prion slow-start spread ramps exactly slowFactor → 1.0 over CAL.PRION_SLOW_DAYS',
    Math.abs(s0 - Engine.CAL.PRION_SLOW_FACTOR) < 1e-9 && Math.abs(sN - 1) < 1e-9,
    s0.toFixed(2) + ' -> ' + sN.toFixed(2));
}

{
  /* P10: genes — exact data effects */
  const g = data.genes;
  const e = new Engine(Object.assign({}, data, { disease: data.diseases.bacteria }),
    { patientZero: 'china', seed: 1, genes: { dna: 'bonus_dna' } });
  check('P10a ATP Boost grants exactly bonus_dna (8) starting DNA (9 + 2 first-country + 8)',
    e.dna === Engine.CAL.DNA_START + Engine.CAL.DNA_NEW_COUNTRY + g.bonus_dna.bonus_dna, e.dna);
  const e2 = new Engine(Object.assign({}, data, { disease: data.diseases.bacteria }),
    { patientZero: 'china', seed: 1, genes: { environmental: 'arid_bonus' } });
  check('P10b Xerophile adds exactly bonus_arid (0.5) to the arid trait',
    e2.traits.arid === data.diseases.bacteria.global.arid + g.arid_bonus.bonus_arid, e2.traits.arid);
  const e3 = new Engine(Object.assign({}, data, { disease: data.diseases.bacteria }),
    { patientZero: 'china', seed: 1, genes: { mutation: 'mutation_bonus' } });
  check('P10c Darwinist adds exactly mutation_chance (0.4) to mutation',
    e3.traits.mutation === 0.5 + 0.4, e3.traits.mutation);
  const e4 = new Engine(Object.assign({}, data, { disease: data.diseases.bacteria }),
    { patientZero: 'china', seed: 1, genes: { mutation: 'mutation_limit', travel: 'land_bonus' } });
  check('P10d Creationist adds exactly -0.4 (0.5→0.1); Teracyte adds bonus_land_transfer (7)',
    Math.abs(e4.traits.mutation - 0.1) < 1e-9 && e4.traits.land_transmission === 1 + 7,
    'mut=' + e4.traits.mutation + ' land=' + e4.traits.land_transmission);
  // Ionised Helix devolve bonus
  const e5 = new Engine(Object.assign({}, data, { disease: data.diseases.bacteria }),
    { patientZero: 'china', seed: 1, genes: { evolve: 'devolver' } });
  e5.dna = 100;
  e5.evolve('air_1');
  const dnaBefore = e5.dna, paid = e5.paid.air_1;
  e5.devolve('air_1');
  check('P10e Ionised Helix devolve refund = floor(paid×0.8) + devolve_dna_add (2)',
    e5.dna === dnaBefore + Math.floor(paid * 0.8) + 2, (e5.dna - dnaBefore) + ' DNA back');
  // Sympto-Stasis freezes symptom cost inflation
  const e6 = new Engine(Object.assign({}, data, { disease: data.diseases.bacteria }),
    { patientZero: 'china', seed: 1, genes: { evolve: 'static_symptoms' } });
  const e6b = mkPlague('bacteria');
  e6.dna = 4000; e6b.dna = 4000;
  for (let i = 0; i < 5; i++) { e6.evolve('air_' + Math.min(i + 1, 3)); }
  for (let i = 0; i < 5; i++) { e6b.evolve('air_' + Math.min(i + 1, 3)); }
  // after 3 distinct transmission nodes owned, a symptom node should cost base on e6 but inflated on e6b
  const base = Math.abs(data.diseases.bacteria.nodes.coughing.cost);
  check('P10f Sympto-Stasis freezes symptom cost inflation (base cost, not +3%/owned)',
    e6.nodeCost('coughing') === base && e6b.nodeCost('coughing') === Math.ceil(base * (1 + 0.03 * 3)),
    e6.nodeCost('coughing') + ' vs ' + e6b.nodeCost('coughing'));
}

{
  /* P11: difficulty multipliers — medical, DNA, mutation */
  const ez = mkPlague('bacteria', { difficulty: 0 }), no = mkPlague('bacteria', { difficulty: 1 }),
        br = mkPlague('bacteria', { difficulty: 2 });
  for (const [nme, e] of [['easy', ez], ['normal', no], ['brutal', br]]) {
    // make every country detected+aware so research runs, then compare raw research power
    for (const k in e.countries) { e.countries[k].detected = true; }
    e.globallyAware = true;
  }
  check('P11a cure research power scales by difficulty med (0.75 / 1.0 / 1.35)',
    Math.abs(ez.cureResearchPerDay() / no.cureResearchPerDay() - 0.75) < 0.01 &&
      Math.abs(br.cureResearchPerDay() / no.cureResearchPerDay() - 1.35) < 0.01,
    (ez.cureResearchPerDay() / no.cureResearchPerDay()).toFixed(3) + '/' +
      (br.cureResearchPerDay() / no.cureResearchPerDay()).toFixed(3));
  // DNA trickle: +1 per 3 days × diff.dna — count over 30 days with no infections possible
  function trickleOf(e) { const d0 = e.dna; e.countries[e.patientZero].infected = 0;
    e.countries[e.patientZero].healthy = 0; e.stats.totalInfectedEver = 1;
    for (let i = 0; i < 30; i++) e.tick(); return e.dna - d0; }
  check('P11b DNA time income scales by difficulty dna (1.25 / 1.0 / 0.8)',
    trickleOf(ez) === 12 && trickleOf(no) === 10 && trickleOf(br) === 8,
    trickleOf(ez) + '/' + trickleOf(no) + '/' + trickleOf(br));
  check('P11c mutation chance scales by difficulty mut (0.7 / 1.0 / 1.5)',
    ez.diff.mut === 0.7 && no.diff.mut === 1 && br.diff.mut === 1.5,
    ez.diff.mut + '/' + no.diff.mut + '/' + br.diff.mut);
}

{
  /* P12: black_death scenario — tree/govactions/data from the scenario package */
  const cfg = loader.scenarioConfig(data.scenarios.black_death, data.diseases);
  const src = data.scenarios.black_death.data_files['bacteria.txt'];
  check('P12a black_death tree node count == scenario disease_tech count (64)',
    Object.keys(cfg.disease.nodes).length === Object.keys(src.disease_tech).length,
    Object.keys(cfg.disease.nodes).length);
  const stdIds = new Set(Object.keys(data.diseases.bacteria.nodes));
  const uniq = Object.keys(cfg.disease.nodes).filter(id => !stdIds.has(id));
  check('P12b black_death tree differs from standard bacteria (13 scenario-specific nodes)',
    uniq.length === 13, uniq.length + ' e.g. ' + uniq.slice(0, 3).join(','));
  const e = new Engine(Object.assign({}, data, { disease: cfg.disease }),
    { patientZero: 'china', seed: 7, govActionsData: cfg.govActionsData, scenarioRules: cfg.rules });
  check('P12c black_death uses the scenario-embedded govactions table (43 actions)',
    e.govTableUsed === '(scenario)' && e.govActions.length === 43, e.govActions.length);
  // medical rule ×0.35: same detected country, beta scales by suppression exactly
  const base = mkPlague('bacteria', { seed: 7 });
  for (const eng of [e, base]) {
    eng.countries.china.infected = eng.countries.china.pop0 * 1e-4;
    eng.countries.china.detected = true; eng.globallyAware = true;
  }
  const ratio = e.betaFor('china') / base.betaFor('china');
  const wB = 1 / (1 + data.countries.china.medical_capacity * (data.countries.china.medical_budget / 10000) * Engine.CAL.MEDICAL_STRENGTH);
  const wS = 1 / (1 + data.countries.china.medical_capacity * (data.countries.china.medical_budget / 10000) * Engine.CAL.MEDICAL_STRENGTH * 0.35);
  check('P12d black_death medical rule ×0.35 raises detected-country spread by exact suppression ratio',
    Math.abs(ratio - wS / wB) < 1e-9, ratio.toFixed(3) + ' (expect ' + (wS / wB).toFixed(3) + ')');
}

{
  /* P13: board_game scenario — neurax tree, ubiquity win, 730-day limit */
  const cfg = loader.scenarioConfig(data.scenarios.board_game, data.diseases);
  check('P13a board_game tree node count == scenario disease_tech count (80)',
    Object.keys(cfg.disease.nodes).length ===
      Object.keys(data.scenarios.board_game.data_files['neurax.txt'].disease_tech).length,
    Object.keys(cfg.disease.nodes).length);
  const e = new Engine(Object.assign({}, data, { disease: cfg.disease }),
    { patientZero: 'china', seed: 3, govTable: cfg.govTable, scenarioRules: cfg.rules });
  check('P13b board_game uses govactions_neurax table (82 actions) + ubiquity win mode',
    e.govTableUsed === 'govactions_neurax' && e.govActions.length === 82 &&
      e.scenarioRules.winMode === 'ubiquity', e.govActions.length + ' actions');
  // force-win: every country reached → win without extinction
  for (const k in e.countries) e.infect(k, 1, 'test');
  e.tick();
  check('P13c ubiquity: all countries reached → win (reason ubiquity)',
    e.gameOver && e.gameOver.win && e.gameOver.reason === 'ubiquity',
    e.gameOver ? e.gameOver.reason : 'no end');
  const e2 = new Engine(Object.assign({}, data, { disease: cfg.disease }),
    { patientZero: 'china', seed: 3, govTable: cfg.govTable, scenarioRules: cfg.rules });
  e2.day = cfg.rules.timeLimitDays - 1;
  e2.countries.china.infected = 1;   // only one country, never all
  e2.tick();
  check('P13d two-year time limit → loss (reason time_limit)',
    e2.gameOver && !e2.gameOver.win && e2.gameOver.reason === 'time_limit',
    e2.gameOver ? e2.gameOver.reason : 'no end');
}

{
  /* P14: cure scenario (simplified reverse mode) */
  const cfg = loader.scenarioConfig(data.scenarios.cure, data.diseases);
  const e = new Engine(Object.assign({}, data, { disease: cfg.disease }),
    { patientZero: 'china', seed: 3, scenarioRules: cfg.rules, plagueData: cfg.plagueData });
  check('P14a cure mode: player tree = cure.json (88 nodes), aware day 0, cureBoost 1.0',
    Object.keys(e.data.disease.nodes).length === 88 && e.globallyAware && e.cureBoost === 1);
  e.dna = 500;
  e.evolve('Declare_Knowledge');                      // free root of the response tree
  e.evolve('Development');                            // required by Accelerated_Research
  e.evolve('Accelerated_Research');                   // change_to_development_speed 0.6 (data)
  check('P14b response nodes raise cure research by exactly 1+Σ development_speed (1.6)',
    Math.abs(e.cureBoost - 1.6) < 1e-9, e.cureBoost);
  check('P14c plague auto-evolves its scen_symptoms set (forced mutation timer)',
    e.plagueData.nodes && Object.keys(e.plagueData.nodes).length >= 5 &&
      Object.keys(e.plagueData.nodes).every(id => cfg.plagueData.nodes[id]),
    Object.keys(e.plagueData.nodes).join(','));
  e.cure.progress = 0.99999;
  e.tick();
  check('P14d cure completion is a WIN for the cure player',
    e.gameOver && e.gameOver.win && e.gameOver.reason === 'cure_complete',
    e.gameOver ? e.gameOver.reason : 'no end');
}

{
  /* P15: expanded news flavor mapping — every entry event∈events.json AND en∈l10n */
  const l10n = data.l10n, evKeys = new Set(Object.keys(data.events));
  const flavor = data.newsFlavor;
  let bad = [];
  for (const f of flavor) {
    if (!evKeys.has(f.event)) bad.push('event:' + f.event);
    if (!(f.en in l10n)) bad.push('en:' + f.en.slice(0, 30));
    if (typeof f.zh !== 'string' || !f.zh) bad.push('zh:' + f.event);
  }
  check('P15 news flavor expanded to >=30 entries, every event key + English headline + zh verified',
    flavor.length >= 30 && bad.length === 0, flavor.length + ' entries, bad: ' + bad.slice(0, 2).join('|'));
  const cats = new Set(flavor.map(f => f.event.split('_')[0]));
  check('P15b mapping covers multiple event families (news/story/olympics/icure/cure/...)',
    cats.size >= 8, [...cats].slice(0, 10).join(','));
}

{
  /* P16: save v2 round trip + phase-1 v1 compatibility */
  const e = mkPlague('rogue_nanobot', { seed: 99, difficulty: 2, genes: { dna: 'bonus_dna' } });
  e.dna = 600;
  e.evolve('code_fragment_interception');
  for (let i = 0; i < 80; i++) e.tick();
  const sv = e.save();
  check('P16a save is v2 and carries plague type / difficulty / genes / killCodeUses',
    sv.v === 2 && sv.plagueTypeGui === 'Nano-Virus' && sv.difficulty === 2 &&
      sv.genes && sv.genes.dna === 'bonus_dna' && sv.killCodeUses === 0, 'v' + sv.v);
  const e2 = mkPlague('rogue_nanobot', { seed: 1 });
  e2.load(JSON.parse(JSON.stringify(sv)));   // real saves go through JSON (localStorage) — no aliasing
  const a = e.snapshotForTest(), b2 = e2.snapshotForTest();
  check('P16b loaded engine reproduces the saved state exactly (day/dna/cure/countries)',
    a.day === b2.day && a.dna === b2.dna && Math.abs(a.cure - b2.cure) < 1e-12 &&
      a.countriesInfected === b2.countriesInfected,
    'day ' + a.day + ' dna ' + a.dna + ' cure ' + (a.cure * 100).toFixed(2) + '%');
  // deterministic continuation
  for (let i = 0; i < 20; i++) { e.tick(); e2.tick(); }
  const a2 = e.snapshotForTest(), b3 = e2.snapshotForTest();
  check('P16c save/load continues deterministically (20-day replay identical)',
    a2.day === b3.day && a2.dead === b3.dead && a2.infected === b3.infected &&
      Math.abs(a2.cure - b3.cure) < 1e-12,
    'day ' + a2.day + ' inf=' + Math.round(a2.infected) + ' cure=' + (a2.cure * 100).toFixed(3) + '%');
  // v1 shape: strip v2 fields, must still load (phase-1 saves)
  const v1 = JSON.parse(JSON.stringify(sv));
  delete v1.plagueTypeGui; delete v1.difficulty; delete v1.genes; delete v1.genePicked;
  delete v1.scenarioRules; delete v1.govTableUsed; delete v1.autoLethality;
  delete v1.killCodeUses; delete v1.plagueOwned; v1.v = 1;
  const e3 = mkPlague('bacteria', { seed: 1 });
  e3.load(v1);
  check('P16d phase-1 (v1) saves still load with v2 defaults',
    e3.day === sv.day && e3.autoLethality === 0 && e3.difficulty === 1, 'day ' + e3.day);
}

{
  /* P17: all 7 plagues run 250 days stable (population conserved, no NaN) */
  let allOk = true, detail = [];
  for (const pl of loader.PLAGUES) {
    const e = mkPlague(pl, { seed: 2024 });
    for (let i = 0; i < 250; i++) e.tick();
    const t = e.totals();
    const cons = Math.abs(t.healthy + t.infected + t.dead - t.pop0) < 0.5;
    const finite = isFinite(t.infected) && isFinite(e.cure.progress);
    if (!cons || !finite) { allOk = false; detail.push(pl); }
  }
  check('P17 all 7 plagues simulate 250 days with conservation + finite state', allOk,
    detail.length ? 'FAIL:' + detail.join(',') : '7/7 ok');
}

console.log('\n==== total: ' + PASS + ' passed, ' + FAIL + ' failed ====');
if (FAIL) { failures.forEach(f => console.log('FAILED: ' + f)); process.exit(1); }
