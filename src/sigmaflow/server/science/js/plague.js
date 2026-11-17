/* =============================================================================
 * SigmaFlow Science · 虚拟疫情(瘟疫公司网页移植)原生 UI
 * 引擎与数据零改动, 全部来自 /plague/ 静态子应用(引擎 js + data + 图标/地图)。
 * 本文件只做表现层: 开局配置 → 地图/面板/新闻流 → 进化树 → 终局,
 * 布局与设计语言对齐虚拟患者页(pat-topbar/长条卡/内凹控件)。
 * 生命周期: window.PlagueUI.mount(root) 由 CS.mountPlaguePage() 调用;
 * 引擎态存 JS(路由切换不丢), 存档 localStorage(sf_plague_save)。
 * ============================================================================= */
(function (root) {
  'use strict';
  var M = function () { return location.pathname.match(/^(.*)\/science\//); };
  var PL = ((M() || [])[1] || '') + '/plague/';
  var SAVE_KEY = 'sf_plague_save';

  /* ---------- l10n(ui/l10n.js 同逻辑: 键=英文原文, 值=zh) ---------- */
  var L = {
    table: {},
    t: function (key, params) {
      var s = this.table[key]; if (s === undefined || s === null || s === '') s = key;
      if (params) for (var p in params) s = s.split('%' + p).join(params[p]);
      return s;
    },
    plain: function (n) { var z = this.table[n]; return (z && z !== n) ? z : n; },
    country: function (n) { var z = this.table[n]; return (z && z !== n) ? z : n; }
  };

  var SPEEDS = [{ label: '⏸', ticks: 0 }, { label: '1×', ticks: 2 }, { label: '2×', ticks: 4 }, { label: '3×', ticks: 6 }];
  var PLAGUE_CARDS = [
    { id: 'bacteria', gui: 'Bacteria', zh: '细菌', desc: '均衡 · 无特殊短板' },
    { id: 'virus', gui: 'Virus', zh: '病毒', desc: '高突变率, 症状常自行变异' },
    { id: 'fungus', gui: 'Fungus', zh: '真菌', desc: '跨国传播极低, 靠孢子爆发扩散' },
    { id: 'parasite', gui: 'Parasite', zh: '寄生虫', desc: '症状隐蔽, 共生降严重度' },
    { id: 'prion', gui: 'Prion', zh: '朊病毒', desc: '慢热起速, 解药研究×0.2' },
    { id: 'rogue_nanobot', gui: 'Nano-Virus', zh: '纳米病毒', desc: '解药第 0 天启动, 解锁终止码' },
    { id: 'escaped_bio_weapon', gui: 'Bioweapon', zh: '生物武器', desc: '致命性随时间自增' }
  ];
  var SCEN_CARDS = [
    { id: null, zh: '标准模式', desc: '7 种标准瘟疫 · 自由配置基因' },
    { id: 'black_death', zh: '黑死病', desc: '中世纪耶尔森菌 · 医疗效率×0.35' },
    { id: 'board_game', zh: '极致桌游', desc: '两年内风靡全球=胜利(简化规则)' },
    { id: 'cure', zh: '解药方 · 拯救世界', desc: '反向玩法: 指挥全球抗疫(简化)' }
  ];
  var DIFFS = [{ zh: '简单', d: 0, t: '医疗效率×0.8 · DNA×1.2' }, { zh: '普通', d: 1, t: '标准' }, { zh: '困难', d: 2, t: '医疗效率×1.35 · DNA×0.8 · 突变×1.5' }];
  var CONTINENT = { Africa: '非洲', Asia: '亚洲', Europe: '欧洲', North_America: '北美洲', South_America: '南美洲' };
  var TREE_TABS = [{ type: 'symptom', zh: '症状' }, { type: 'transmission', zh: '传播方式' }, { type: 'ability', zh: '特殊能力' }];

  function fmtI(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- 模块态 ---------- */
  var App = {
    el: null, engine: null, data: null, scenario: null,
    speedIdx: 1, tickAcc: 0, lastFrame: 0, running: false, raf: 0,
    selPlague: 'bacteria', selDifficulty: 1, selScenario: null, selGenes: {},
    selected: null, lastNewsLen: 0, treeOpen: false, treeTab: 'symptom', _tmax: null
  };

  /* ---------- 引擎脚本与数据装载 ---------- */
  var ENGINE_FILES = ['rng', 'model', 'genes', 'engine', 'loader'].map(f => PL + 'js/engine/' + f + '.js');
  function loadScript(src) {
    return new Promise((res, rej) => {
      var s = document.createElement('script'); s.src = src;
      s.onload = () => res(); s.onerror = () => rej(new Error('脚本加载失败: ' + src));
      document.head.appendChild(s);
    });
  }
  var _engineReady = null;
  function ensureEngine() {
    if (root.PlagueEng && root.PlagueEng.Engine && root.PlagueEng.Scenarios) return Promise.resolve();
    if (_engineReady) return _engineReady;
    _engineReady = ENGINE_FILES.reduce((p, f) => p.then(() => loadScript(f)), Promise.resolve())
      .catch(e => { _engineReady = null; throw e; });
    return _engineReady;
  }
  // 数据清单与 loader.browser() 一致, 但从绝对路径 /plague/data/ 取(页面在 /science/ 下)
  function loadData() {
    var PLAGUES = ['bacteria', 'virus', 'fungus', 'parasite', 'prion', 'rogue_nanobot', 'escaped_bio_weapon'];
    var SCEN = ['black_death', 'board_game', 'cure'];
    var names = ['countries.json'].concat(PLAGUES.map(p => 'diseases/' + p + '.json'), ['diseases/cure.json'],
      SCEN.map(s => 'scenarios/' + s + '.json'),
      ['routes.json', 'govactions.json', 'events.json', 'genes.json', 'l10n_zh.json', 'land_adjacency.json', 'news_flavor.json', 'icons_manifest.json']);
    return Promise.all(names.map(n => fetch(PL + 'data/' + n).then(r => { if (!r.ok) throw new Error('data/' + n + ' ' + r.status); return r.json(); }))).then(rs => {
      var diseases = {}; PLAGUES.forEach((p, i) => diseases[p] = rs[1 + i]);
      diseases.cure_tree = rs[1 + PLAGUES.length];
      var scenarios = {}; SCEN.forEach((s, i) => scenarios[s] = rs[2 + PLAGUES.length + i]);
      return {
        countries: rs[0], disease: diseases.bacteria, diseases: diseases, scenarios: scenarios,
        routes: rs[2 + PLAGUES.length + SCEN.length], govactions: rs[3 + PLAGUES.length + SCEN.length],
        events: rs[4 + PLAGUES.length + SCEN.length], genes: rs[5 + PLAGUES.length + SCEN.length],
        l10n: rs[6 + PLAGUES.length + SCEN.length], landAdjacency: rs[7 + PLAGUES.length + SCEN.length],
        newsFlavor: rs[8 + PLAGUES.length + SCEN.length], icons: rs[9 + PLAGUES.length + SCEN.length]
      };
    });
  }

  /* ---------- 挂载入口 ---------- */
  function mount(el) {
    if (!el || el.dataset.plMounted) return;
    el.dataset.plMounted = '1';
    App.el = el;
    el.innerHTML = '<div class="pl-loading">正在加载疫情引擎与数据……</div>';
    var ready = () => { if (!resumeSave()) renderStart(); };
    if (App.data) return ready();   // 数据已缓存(曾进入过本页), 免重取
    ensureEngine().then(() => loadData()).then(data => {
      App.data = data; L.table = data.l10n || {};
      ready();
    }).catch(err => {
      el.innerHTML = '<div class="pl-error panel"><h3>虚拟疫情加载失败</h3><p class="muted">' + esc(err.message) + '</p>' +
        '<button type="button" class="btn primary" data-action="plague-retry">重试</button></div>';
      delete el.dataset.plMounted;
    });
  }

  /* ---------- 开局配置 ---------- */
  function renderStart() {
    var el = App.el, d = App.data;
    var scenHide = App.selScenario !== null && App.selScenario !== undefined && App.selScenario !== '';
    var scen = App.selScenario || null;
    if (scen) scenHide = false; // 场景模式仍显示瘟疫区(黑死病等固定, 仅隐藏基因)
    var hideGenes = !!scen && scen !== null; // 场景模式隐藏基因(解药方等)
    var keys = Object.keys(d.countries).sort((a, b) => L.country(d.countries[a].name).localeCompare(L.country(d.countries[b].name), 'zh'));
    var scenCards = SCEN_CARDS.map(s => '<button type="button" class="pl-card ' + (scen === s.id ? 'on' : '') + '" data-pl-scen="' + (s.id || '') + '"><b>' + s.zh + '</b><span>' + s.desc + '</span></button>').join('');
    var plagueCards = PLAGUE_CARDS.map(p => '<button type="button" class="pl-card ' + (App.selPlague === p.id && !scen ? 'on' : '') + '" data-pl-plague="' + p.id + '"><b>' + p.zh + '</b><span>' + p.desc + '</span></button>').join('');
    var diffChips = DIFFS.map((dv, i) => '<button type="button" class="pl-chip ' + (App.selDifficulty === i ? 'on' : '') + '" data-pl-diff="' + i + '" title="' + esc(dv.t) + '">' + dv.zh + '</button>').join('');
    var geneRows = root.PlagueEng.Genes.SLOTS.map(slot => {
      var opts = Object.keys(d.genes).filter(g => d.genes[g].gene_category === slot)
        .map(g => '<option value="' + g + '">' + esc(L.plain(d.genes[g].gene_name)) + '</option>').join('');
      return '<label class="pl-gene"><span>' + slot + '</span><select data-pl-gene="' + slot + '">' + opts + '</select></label>';
    }).join('');
    var p0opts = keys.map(k => '<option value="' + k + '">' + esc(L.country(d.countries[k].name)) + '</option>').join('');
    el.innerHTML =
      '<div class="pl-start"><div class="panel pl-start-card">' +
      '<h2>虚拟疫情 <span class="pl-sub">瘟疫公司机制 · 引擎原版</span></h2>' +
      '<label class="pl-lab">模式</label><div class="pl-cards">' + scenCards + '</div>' +
      '<label class="pl-lab">瘟疫类型</label><div class="pl-cards">' + plagueCards + '</div>' +
      '<label class="pl-lab">难度</label><div class="pl-chips">' + diffChips + '</div>' +
      '<div class="pl-genes" style="' + (scen ? 'display:none' : '') + '"><label class="pl-lab">开局基因(5 槽)</label><div class="pl-gene-grid">' + geneRows + '</div></div>' +
      '<label class="pl-lab">起始国家(患者零号)</label><select class="pl-p0" data-pl-p0>' + p0opts + '</select>' +
      '<div class="pl-startbtns"><button type="button" class="btn primary" data-pl-start>开始游戏</button>' +
      (localStorage.getItem(SAVE_KEY) ? '<button type="button" class="btn" data-pl-resume>继续存档</button>' : '') + '</div>' +
      '</div></div>';
    el.querySelectorAll('[data-pl-scen]').forEach(b => b.onclick = () => {
      App.selScenario = b.dataset.plScen || null;
      if (App.selScenario === 'black_death') App.selPlague = 'bacteria';
      renderStart();
    });
    el.querySelectorAll('[data-pl-plague]').forEach(b => b.onclick = () => { App.selPlague = b.dataset.plPlague; App.selScenario = null; renderStart(); });
    el.querySelectorAll('[data-pl-diff]').forEach(b => b.onclick = () => { App.selDifficulty = +b.dataset.plDiff; renderStart(); });
    el.querySelectorAll('[data-pl-gene]').forEach(s => { s.value = App.selGenes[s.dataset.plGene] || s.value; s.onchange = () => { App.selGenes[s.dataset.plGene] = s.value; }; });
    var st = el.querySelector('[data-pl-start]'); if (st) st.onclick = () => startGame(el.querySelector('[data-pl-p0]').value);
    var rs = el.querySelector('[data-pl-resume]'); if (rs) rs.onclick = () => resumeSave();
  }

  /* ---------- 开局(与 ui/main.js 同构: 场景/标准两路组装 data+opts) ---------- */
  function startGame(patientZero) {
    var opts = { patientZero: patientZero, seed: (Date.now() & 0xffff) | 1, difficulty: App.selDifficulty, genes: App.selScenario ? null : App.selGenes };
    var data = App.data;
    App.scenario = null;
    if (App.selScenario) {
      var cfg = root.PlagueEng.Scenarios.scenarioConfig(data.scenarios[App.selScenario], data.diseases);
      data = Object.assign({}, data, { disease: cfg.disease });
      opts.scenarioRules = cfg.rules;
      if (cfg.govActionsData) opts.govActionsData = cfg.govActionsData;
      if (cfg.govTable) opts.govTable = cfg.govTable;
      if (cfg.plagueData) opts.plagueData = cfg.plagueData;
      App.scenario = { id: App.selScenario, rules: cfg.rules };
    } else {
      data = Object.assign({}, data, { disease: data.diseases[App.selPlague] });
    }
    App.engine = new root.PlagueEng.Engine(data, opts);
    App.selected = null; App.lastNewsLen = 0; App._tmax = null;
    buildGame();
  }

  function resumeSave() {
    var raw; try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var sv = JSON.parse(raw), esv = sv.engine || {};
      var opts = { patientZero: sv.patientZero, seed: 1, difficulty: esv.difficulty };
      var data = App.data;
      if (esv.scenarioRules && esv.scenarioRules.cureMode) {
        var c = root.PlagueEng.Scenarios.scenarioConfig(data.scenarios.cure, data.diseases);
        data = Object.assign({}, data, { disease: c.disease });
        opts.scenarioRules = c.rules; opts.plagueData = c.plagueData; opts.govTable = c.govTable;
      } else if (sv.selScenario && data.scenarios[sv.selScenario]) {
        var cfg = root.PlagueEng.Scenarios.scenarioConfig(data.scenarios[sv.selScenario], data.diseases);
        data = Object.assign({}, data, { disease: cfg.disease });
        opts.scenarioRules = cfg.rules;
        if (cfg.govActionsData) opts.govActionsData = cfg.govActionsData;
        if (cfg.govTable) opts.govTable = cfg.govTable;
      } else {
        data = Object.assign({}, data, { disease: data.diseases[sv.selPlague || 'bacteria'] });
        opts.genes = esv.genes;
      }
      App.selScenario = sv.selScenario || null; App.selPlague = sv.selPlague || 'bacteria'; App.scenario = sv.scenario || null;
      App.engine = new root.PlagueEng.Engine(data, opts);
      App.engine.load(esv);
      App.selected = null; App.lastNewsLen = 0; App._tmax = null;
      buildGame();
      App.speedIdx = sv.speedIdx || 1;
      return true;
    } catch (e) { console.warn('[plague] 存档读取失败', e); return false; }
  }

  /* ---------- 对局界面 ---------- */
  function buildGame() {
    var el = App.el;
    el.innerHTML =
      '<div class="pl-topbar">' +
        '<div class="pl-id"><div id="plName"></div><div id="plTag"></div></div>' +
        '<div class="pl-banner" id="plBanner">潜伏中</div>' +
        '<div class="pl-clock" id="plDay">第 0 天</div>' +
        '<div class="pl-dna" id="plDna">🧬 0 DNA</div>' +
        '<div class="pl-topbtns">' +
          '<button type="button" data-pl-speed="0">⏸</button><button type="button" data-pl-speed="1">1×</button><button type="button" data-pl-speed="2">2×</button><button type="button" data-pl-speed="3">3×</button>' +
          '<button type="button" data-pl-tree>进化树</button><button type="button" data-pl-save>存档</button><button type="button" data-pl-restart>重开</button>' +
        '</div>' +
      '</div>' +
      '<div class="pl-main">' +
        '<div class="panel pl-map-card"><div class="pl-map" id="plMap"><div class="pl-map-loading">地图加载中…</div></div><div class="pl-map-tip" id="plTip"></div></div>' +
        '<div class="pl-aside">' +
          '<div class="panel pl-card"><h3>疫情概况</h3><div class="pl-stats" id="plStats"></div><div class="pl-cure" id="plCure"></div></div>' +
          '<div class="panel pl-card" id="plCountry" style="display:none"></div>' +
          '<div class="panel pl-card" id="plSpecial" style="display:none"></div>' +
        '</div>' +
      '</div>' +
      '<div class="panel pl-log-card"><h3>新闻流</h3><div class="pl-news" id="plNews"></div></div>' +
      '<div class="pl-overlay" id="plTree" style="display:none"></div>' +
      '<div class="pl-overlay" id="plEnd" style="display:none"></div>';
    el.querySelectorAll('[data-pl-speed]').forEach(b => b.onclick = () => setSpeed(+b.dataset.plSpeed));
    el.querySelector('[data-pl-tree]').onclick = () => { App.treeOpen = true; renderTree(); };
    el.querySelector('[data-pl-save]').onclick = saveGame;
    el.querySelector('[data-pl-restart]').onclick = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} stopLoop(); renderStart(); };
    var gui = App.engine.plagueTypeGui;
    el.querySelector('#plName').textContent = L.plain(gui) + (App.scenario ? ' · ' + (App.scenario.rules.label || App.scenario.id) : '');
    el.querySelector('#plTag').textContent = 'SIM-PLAGUE · ' + DIFFS[App.engine.difficulty || App.selDifficulty || 1].zh;
    buildMap();
    setSpeed(App.speedIdx || 1);
    refresh();
    startLoop();
  }

  function setSpeed(i) {
    App.speedIdx = i;
    if (!App.el) return;
    App.el.querySelectorAll('[data-pl-speed]').forEach(b => b.classList.toggle('on', +b.dataset.plSpeed === i));
  }
  function startLoop() {
    stopLoop();
    App.tickAcc = 0; App.lastFrame = performance.now(); App.running = true;
    var frame = function (now) {
      App.raf = requestAnimationFrame(frame);
      var dt = (now - App.lastFrame) / 1000; App.lastFrame = now;
      if (!App.running || !App.engine) return;
      // 路由不在疫情页时轻空转(保活 DOM 不销毁, 引擎暂停)
      if (!root.CS || CS.ui.route !== 'plague') return;
      if (App.engine.gameOver) { refresh(); return; }
      var tps = SPEEDS[App.speedIdx].ticks;
      App.tickAcc += tps * dt;
      var guard = 0;
      while (App.tickAcc >= 1 && guard < 12) { App.engine.tick(); App.tickAcc -= 1; guard++; if (App.engine.gameOver) break; }
      refresh();
    };
    App.raf = requestAnimationFrame(frame);
  }
  function stopLoop() { App.running = false; if (App.raf) cancelAnimationFrame(App.raf); App.raf = 0; }

  /* ---------- 地图(realmap.svg 几何, science 配色) ---------- */
  var mapBuilt = false, mapParts = [];
  function buildMap() {
    var host = App.el.querySelector('#plMap');
    fetch(PL + 'assets/map/realmap.svg').then(r => r.text()).then(txt => {
      var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      var detail = null, gs = doc.querySelectorAll('svg > g');
      for (var i = 0; i < gs.length; i++) if (gs[i].getAttribute('inkscape:label') === 'detail') { detail = gs[i]; break; }
      if (!detail) for (var j = 0; j < gs.length; j++) if (gs[j].querySelector('path[id]')) { detail = gs[j]; break; }
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 960 632'); svg.setAttribute('class', 'pl-worldmap');
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', 'translate(0,-420.36218)');
      var paths = detail.querySelectorAll('path[id]'); mapParts = [];
      for (var p = 0; p < paths.length; p++) {
        var base = paths[p].getAttribute('id').replace(/\d+$/, '');
        var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('d', paths[p].getAttribute('d'));
        el.setAttribute('class', 'pl-country');
        el.dataset.c = base;
        el.addEventListener('mouseenter', function () { tip(this.dataset.c, true); });
        el.addEventListener('mouseleave', function () { tip(null); });
        el.addEventListener('click', function () { App.selected = this.dataset.c; refresh(); });
        g.appendChild(el); mapParts.push(el);
      }
      svg.appendChild(g);
      host.innerHTML = ''; host.appendChild(svg);
      mapBuilt = true; refresh();
    }).catch(() => { host.innerHTML = '<div class="pl-map-loading">地图加载失败</div>'; });
  }
  function tip(key, show) {
    var t = App.el && App.el.querySelector('#plTip'); if (!t) return;
    if (!key || !show) { t.style.display = 'none'; return; }
    var c = App.data.countries[key]; if (!c) { t.style.display = 'none'; return; }
    var st = App.engine && App.engine.countries[key];
    t.style.display = 'block';
    t.innerHTML = '<b>' + esc(L.country(c.name)) + '</b>' + (st && st.infected > 0 ? '<span>感染 ' + fmtI(st.infected) + '</span>' : '');
  }
  function mix(a, b, t) { // hex 插值
    var pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function paintMap() {
    if (!mapBuilt || !App.engine) return;
    for (var i = 0; i < mapParts.length; i++) {
      var el = mapParts[i], st = App.engine.countries[el.dataset.c];
      var fill = 'var(--line-soft)';
      if (st) {
        var N = st.pop0 || 1, ip = Math.min(st.infected / N, 1), dp = Math.min(st.dead / N, 1);
        fill = dp > 0.02 ? mix('#8b93a7', '#3a3f4d', Math.min(dp * 1.6, 1)) : (ip > 0 ? mix('#a8bfd8', '#c62828', Math.pow(ip, 0.45)) : fill);
      }
      el.style.fill = fill;
      el.classList.toggle('det', !!(st && st.detected));
      el.classList.toggle('sel', App.selected === el.dataset.c);
    }
  }

  /* ---------- 刷新(HUD/概况/国家/新闻/特作/终局) ---------- */
  function refresh() {
    var e = App.engine; if (!e || !App.el) return;
    var el = App.el;
    el.querySelector('#plDay').textContent = '第 ' + e.day + ' 天';
    el.querySelector('#plDna').textContent = '🧬 ' + Math.floor(e.dna) + ' DNA';
    var t = e.totals();
    var infRate = t.infected / (t.pop0 || 1), deadRate = t.dead / (t.pop0 || 1);
    var banner = el.querySelector('#plBanner');
    if (!e.gameOver) {
      var b = !e.globallyAware ? ['潜伏中', ''] : (infRate > 0.25 || deadRate > 0.05 ? ['全球大流行', 'crit'] : ['已检出 · 扩散中', 'warn']);
      banner.textContent = b[0]; banner.className = 'pl-banner ' + b[1];
    }
    var sums = traitMax();
    bar = (v, m) => Math.max(0, Math.min(100, v / m * 100));
    el.querySelector('#plStats').innerHTML =
      statRow('健康', t.healthy, 'ok') + statRow('感染', t.infected, 'bad') + statRow('死亡', t.dead, 'dead') +
      '<div class="pl-trait"><span>传染性</span><div class="pl-track"><i style="width:' + bar(e.traits.infectiousness, sums.inf) + '%"></i></div><b>' + Math.round(e.traits.infectiousness) + '</b></div>' +
      '<div class="pl-trait"><span>严重度</span><div class="pl-track"><i class="sev" style="width:' + bar(e.effSeverity(), sums.sev) + '%"></i></div><b>' + Math.round(e.effSeverity()) + '</b></div>' +
      '<div class="pl-trait"><span>致命性</span><div class="pl-track"><i class="let" style="width:' + bar(e.effLethality(), sums.let) + '%"></i></div><b>' + Math.round(e.effLethality()) + '</b></div>';
    var cureP = (e.cure.progress * 100);
    el.querySelector('#plCure').innerHTML =
      '<div class="pl-trait"><span>解药研发</span><div class="pl-track"><i class="cure" style="width:' + Math.min(cureP, 100) + '%"></i></div><b>' + cureP.toFixed(1) + '%</b></div>';
    paintMap(); renderCountry(); renderNews(); renderSpecial();
    if (e.gameOver) showEnd(e.gameOver);
  }
  var bar; // refresh 内赋值
  function statRow(name, v, cls) { return '<div class="pl-stat ' + cls + '"><span>' + name + '</span><b>' + fmtI(v) + '</b></div>'; }
  function traitMax() {
    if (App._tmax) return App._tmax;
    var s = { inf: 1, sev: 1, let: 1 }, nodes = App.engine.data.disease.nodes;
    for (var id in nodes) {
      s.inf += Math.abs(nodes[id].change_to_infectiousness || 0);
      s.sev += Math.abs(nodes[id].change_to_severity || 0);
      s.let += Math.abs(nodes[id].change_to_lethality || 0);
    }
    App._tmax = s; return s;
  }
  function renderCountry() {
    var host = App.el.querySelector('#plCountry'), key = App.selected;
    if (!key || !App.data.countries[key]) { host.style.display = 'none'; return; }
    var c = App.data.countries[key], st = App.engine.countries[key];
    var N = st.pop0 || 1, ip = st.infected / N * 100, dp = st.dead / N * 100;
    var tag = (zh, on) => '<span class="pl-tag' + (on ? ' on' : '') + '">' + zh + '</span>';
    var acts = Object.keys(st.actions).map(a => { var g = App.data.govactions.govactions_standard[a]; return g ? L.plain(g.action_name) : a; });
    host.style.display = '';
    host.innerHTML = '<h3>' + esc(L.country(c.name)) + '</h3>' +
      '<div class="pl-kv"><span>人口</span><b>' + fmtI(c.original_population) + '</b></div>' +
      '<div class="pl-kv"><span>大陆</span><b>' + (CONTINENT[c.continent] || c.continent) + '</b></div>' +
      '<div class="pl-tags">' + tag('富裕', c.wealthy) + tag('贫困', c.poverty) + tag('城市', c.urban) + tag('农村', c.rural) + tag('炎热', c.hot) + tag('寒冷', c.cold) + tag('潮湿', c.humid) + tag('干旱', c.arid) + tag('机场', c.airport) + tag('港口', c.port) + '</div>' +
      '<div class="pl-kv"><span>医疗预算/能力</span><b>$' + c.medical_budget + ' · ' + c.medical_capacity + '</b></div>' +
      '<div class="pl-trait"><span>健康</span><div class="pl-track"><i class="ok" style="width:' + Math.max(0, 100 - ip - dp) + '%"></i></div><b>' + fmtI(st.healthy) + '</b></div>' +
      '<div class="pl-trait"><span>感染</span><div class="pl-track"><i style="width:' + ip + '%"></i></div><b>' + fmtI(st.infected) + '</b></div>' +
      '<div class="pl-trait"><span>死亡</span><div class="pl-track"><i class="dead" style="width:' + dp + '%"></i></div><b>' + fmtI(st.dead) + '</b></div>' +
      '<div class="pl-kv"><span>已检出</span><b>' + (st.detected ? '是 · 第' + st.firstInfectedDay + '天起' : '否') + '</b></div>' +
      '<div class="pl-kv"><span>边境</span><b>' + (st.airOpen ? '空✓ ' : '空✕ ') + (st.seaOpen ? '海✓ ' : '海✕ ') + (st.landOpen ? '陆✓' : '陆✕') + '</b></div>' +
      (acts.length ? '<div class="pl-tags">' + acts.map(a => '<span class="pl-tag on">' + esc(a) + '</span>').join('') + '</div>' : '');
  }
  function renderNews() {
    var host = App.el.querySelector('#plNews'), e = App.engine;
    var out = [], start = Math.max(0, e.news.length - 40);
    for (var i = e.news.length - 1; i >= start; i--) {
      var n = e.news[i], params = {};
      if (n.params) for (var p in n.params) params[p] = L.plain(n.params[p]);
      out.push('<div class="pl-news-item k-' + n.kind + '"><span class="pl-news-day">D' + n.day + '</span>' + esc(L.t(n.key, params)) + '</div>');
    }
    host.innerHTML = out.join('') || '<div class="pl-news-item">尚无消息。</div>';
    // 突变提示走 science toast
    if (e.news.length > App.lastNewsLen) {
      for (var j = App.lastNewsLen; j < e.news.length; j++) {
        if (e.news[j].kind === 'mutation' && root.CS && CS.toast) {
          CS.toast('⚠ ' + L.t(e.news[j].key, { s: e.plagueName, s2: L.plain((e.news[j].params || {}).s2 || '') }), 'info');
        }
      }
    }
    App.lastNewsLen = e.news.length;
  }
  function renderSpecial() {
    var host = App.el.querySelector('#plSpecial'), e = App.engine;
    var acts = e.specialActions ? e.specialActions() : [];
    if (!acts.length) { host.style.display = 'none'; return; }
    host.style.display = '';
    host.innerHTML = '<h3>特殊行动</h3>' + acts.map(a =>
      '<button type="button" class="pl-spbtn" data-pl-sp="' + a.id + '"' + (e.dna < a.cost ? ' disabled' : '') + '><b>' + esc(a.label) + '</b><span>' + a.cost + ' DNA · ' + esc(a.hint) + '</span></button>').join('');
    host.querySelectorAll('[data-pl-sp]').forEach(b => b.onclick = function () {
      var a = acts.filter(x => x.id === this.dataset.plSp)[0]; if (!a) return;
      if (a.kind === 'spore') { if (App.engine.evolve(a.node)) CS.toast('孢子爆发! 感染了新的国家'); }
      else if (a.kind === 'killcode' && App.engine.launchKillCode()) CS.toast('终止码广播成功 — 解药进度已清零');
      refresh();
    });
  }
  function showEnd(go) {
    var ov = App.el.querySelector('#plEnd');
    if (ov.style.display === 'flex') return;
    ov.style.display = 'flex';
    var t = App.engine.totals();
    var curePlayer = !!(App.scenario && App.scenario.rules.cureMode);
    var title = go.win ? (curePlayer ? '🌍 世界得救' : '人类灭绝') : '游戏失败';
    var reason = go.reason === 'cure_complete' ? (curePlayer ? '解药研发完成，你拯救了世界' : '解药研发完成，人类获救') :
      go.reason === 'eradicated' ? '病原体被彻底消灭' :
      go.reason === 'ubiquity' ? '游戏风靡全球，所有国家都能买到' :
      go.reason === 'time_limit' ? '两年期限已到，投资人撤资' : go.reason;
    ov.innerHTML = '<div class="panel pl-end-card"><h2 class="' + (go.win ? 'ok' : 'bad') + '">' + title + '</h2>' +
      '<p class="muted">' + esc(reason) + ' · 第 ' + go.day + ' 天 · 死亡 ' + fmtI(t.dead) + ' / ' + fmtI(t.pop0) + '</p>' +
      '<button type="button" class="btn primary" data-pl-again>再来一局</button></div>';
    ov.querySelector('[data-pl-again]').onclick = () => { ov.style.display = 'none'; stopLoop(); renderStart(); };
    App.running = false;
  }

  /* ---------- 进化树(类别页签 + 节点卡) ---------- */
  function nodeEffects(nd) {
    var map = [
      ['change_to_infectiousness', '传染+'], ['change_to_severity', '严重+'], ['change_to_lethality', '致命+'],
      ['change_to_wealthy', '富裕+'], ['change_to_poverty', '贫困+'], ['change_to_urban', '城市+'], ['change_to_rural', '农村+'],
      ['change_to_hot', '炎热+'], ['change_to_cold', '寒冷+'], ['change_to_humid', '潮湿+'], ['change_to_arid', '干旱+'],
      ['change_to_air_transmission', '空传+'], ['change_to_water_transmission', '水传+'], ['change_to_land_transmission', '陆传+'],
      ['change_to_cure_base_multiplier', '解药工作量+'], ['change_to_research_inefficiency_multiplier', '研究低效+']
    ];
    var out = [];
    map.forEach(function (m) { var v = nd[m[0]]; if (v) out.push(m[1] + Math.abs(v)); });
    return out.join(' · ');
  }
  function iconFor(nd) {
    var g = nd.base_graphic; if (!g) return null;
    var ic = App.data.icons || [];
    if (ic.indexOf(g + '.png') >= 0) return PL + 'assets/icons/' + g + '.png';
    if (ic.indexOf(g + '@2x.png') >= 0) return PL + 'assets/icons/' + g + '@2x.png';
    return null;
  }
  function renderTree() {
    var ov = App.el.querySelector('#plTree'), e = App.engine;
    ov.style.display = 'flex';
    var nodes = e.data.disease.nodes;
    var renderTab = function () {
      var list = Object.keys(nodes).filter(id => nodes[id].grid_type === App.treeTab)
        .sort((a, b) => (nodes[a].tech_level || 0) - (nodes[b].tech_level || 0) || e.nodeCost(a) - e.nodeCost(b));
      var cards = list.map(id => {
        var nd = nodes[id], owned = !!e.owned[id];
        var can = !owned && e.canEvolve(id), cost = e.nodeCost(id);
        var afford = can && Math.floor(e.dna) >= cost;
        var icon = iconFor(nd);
        var dev = owned && e.canDevolve(id);
        return '<div class="pl-node ' + (owned ? 'owned' : can ? (afford ? 'can' : 'lack') : 'lock') + '" data-pl-node="' + id + '">' +
          (icon ? '<img src="' + icon + '" alt="" loading="lazy">' : '<span class="pl-node-dot"></span>') +
          '<div class="pl-node-body"><b>' + esc(L.plain(nd.name)) + '</b>' +
          '<span class="pl-node-eff">' + esc(nodeEffects(nd) || nd.description &&L.plain(nd.description) || '') + '</span></div>' +
          '<div class="pl-node-side">' + (owned
            ? (dev ? '<button type="button" class="pl-evolve dev" data-pl-devolve="' + id + '">退化</button>' : '<span class="pl-tag on">已进化</span>')
            : '<span class="pl-node-cost">' + cost + ' DNA</span>' + (can ? '<button type="button" class="pl-evolve"' + (afford ? '' : ' disabled') + ' data-pl-evolve="' + id + '">进化</button>' : '')) +
          '</div></div>';
      }).join('');
      ov.innerHTML = '<div class="panel pl-tree-card">' +
        '<div class="pl-tree-head"><h2>进化树 · 🧬 ' + Math.floor(e.dna) + ' DNA</h2>' +
        '<div class="pl-tabs">' + TREE_TABS.map(t => '<button type="button" class="' + (App.treeTab === t.type ? 'on' : '') + '" data-pl-tab="' + t.type + '">' + t.zh + '</button>').join('') + '</div>' +
        '<button type="button" class="icon-btn" data-pl-close>✕</button></div>' +
        '<div class="pl-tree-list">' + (cards || '<p class="muted">此类别没有节点。</p>') + '</div></div>';
      ov.querySelectorAll('[data-pl-tab]').forEach(b => b.onclick = () => { App.treeTab = b.dataset.plTab; renderTab(); });
      ov.querySelector('[data-pl-close]').onclick = () => { ov.style.display = 'none'; App.treeOpen = false; };
      ov.querySelectorAll('[data-pl-evolve]').forEach(b => b.onclick = function () {
        var id = this.dataset.plEvolve;
        if (App.engine.evolve(id)) { CS.toast('进化: ' + L.plain(nodes[id].name)); renderTab(); refresh(); }
      });
      ov.querySelectorAll('[data-pl-devolve]').forEach(b => b.onclick = function () {
        var id = this.dataset.plDevolve;
        if (App.engine.devolve(id)) { CS.toast('退化: ' + L.plain(nodes[id].name)); renderTab(); refresh(); }
      });
    };
    renderTab();
  }

  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        engine: App.engine.save(), patientZero: App.engine.patientZero, speedIdx: App.speedIdx,
        selPlague: App.selPlague, selScenario: App.selScenario, scenario: App.scenario
      }));
      if (root.CS && CS.toast) CS.toast('已保存存档');
    } catch (err) { if (root.CS && CS.toast) CS.toast('保存失败: ' + err.message, 'error'); }
  }

  root.PlagueUI = { mount: mount, app: App };
})(typeof self !== 'undefined' ? self : this);
