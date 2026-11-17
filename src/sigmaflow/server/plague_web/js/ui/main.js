/* Main game loop + UI wiring (browser). Engine core is node-testable; this file only
 * renders and forwards player actions. */
(function (root) {
  'use strict';
  var PlagueEng = root.PlagueEng;
  var SPEEDS = [{ label: '⏸', ticks: 0 }, { label: '1×', ticks: 2 }, { label: '2×', ticks: 4 }, { label: '3×', ticks: 6 }];
  // ticks per real second — CALIBRATION of pacing only

  /* plague cards: file id, icon, zh name (l10n keys are the English type names), one-line
   * mechanic summary. The summaries describe engine mechanics — numbers live in the data. */
  var PLAGUE_CARDS = [
    { id: 'bacteria', icon: 'disease_sel_bacteria', gui: 'Bacteria', zh: '细菌', desc: '均衡 · 无特殊短板' },
    { id: 'virus', icon: 'disease_sel_virus', gui: 'Virus', zh: '病毒', desc: '高突变率(数据 mutation 2 vs 0.5), 症状常自行变异' },
    { id: 'fungus', icon: 'disease_sel_fungus', gui: 'Fungus', zh: '真菌', desc: '跨国传播极低(数据 0.0001), 靠孢子爆发扩散' },
    { id: 'parasite', icon: 'disease_sel_parasite', gui: 'Parasite', zh: '寄生虫', desc: '症状隐蔽(严重度×0.85 近似), 共生降严重度' },
    { id: 'prion', icon: 'disease_sel_prion', gui: 'Prion', zh: '朊病毒', desc: '慢热起速, 解药研究×0.2(数据), 神经萎缩延缓解药' },
    { id: 'rogue_nanobot', icon: 'disease_sel_nanobot', gui: 'Nano-Virus', zh: '纳米病毒', desc: '解药第 0 天启动且×1.45(数据), 解锁终止码广播' },
    { id: 'escaped_bio_weapon', icon: 'disease_sel_bio', gui: 'Bioweapon', zh: '生物武器', desc: '致命性随时间自增, 基因压缩/失活基因缓释' }
  ];
  var SCEN_CARDS = [
    { id: null, zh: '标准模式', desc: '7 种标准瘟疫 · 自由配置基因' },
    { id: 'black_death', zh: '黑死病', desc: '中世纪耶尔森菌 · 场景专属树/政府表 · 医疗效率×0.35(近似)' },
    { id: 'board_game', zh: '极致桌游', desc: '桌游主题树 · 两年内风靡全球=胜利(简化规则)' },
    { id: 'cure', zh: '解药方 · 拯救世界', desc: '反向玩法简化版: 指挥全球抗疫, 解药完成=胜利(简化)' }
  ];

  var App = {
    engine: null, data: null, map: null, tree: null,
    speedIdx: 1, tickAcc: 0, lastFrame: 0, running: false,
    patientZero: null, selected: null,
    selPlague: 'bacteria', selDifficulty: 1, selScenario: null, selGenes: {},
    lastNewsLen: 0,

    boot: function () {
      var self = this;
      PlagueEng.loadData.browser().then(function (data) {
        self.data = data;
        root.L10N.init(data.l10n);
        self.buildStartScreen();
        window.dispatchEvent(new CustomEvent('plague:ready'));
      }).catch(function (e) {
        document.getElementById('loading').textContent = '数据加载失败: ' + e;
      });
    },

    /* ---------- start screen ---------- */
    buildStartScreen: function () {
      var self = this;
      var ov = document.getElementById('start-screen');
      ov.style.display = 'flex';
      var pick = document.getElementById('p0-pick');
      var label = document.getElementById('p0-label');
      pick.innerHTML = '';
      var keys = Object.keys(this.data.countries);
      keys.sort(function (a, b) {
        return self.data.countries[a].name.localeCompare(self.data.countries[b].name);
      });
      keys.forEach(function (k) {
        var o = document.createElement('option');
        o.value = k;
        o.textContent = L10N.plain(self.data.countries[k].name);
        pick.appendChild(o);
      });
      function upd() { label.textContent = L10N.plain(self.data.countries[pick.value].name); }
      pick.addEventListener('change', upd);
      upd();

      /* --- scenario cards --- */
      var scenHost = document.getElementById('scen-pick');
      scenHost.innerHTML = '';
      SCEN_CARDS.forEach(function (sc) {
        var card = document.createElement('div');
        card.className = 'sel-card';
        card.dataset.scen = sc.id === null ? '' : sc.id;
        card.innerHTML = '<b>' + sc.zh + '</b><span>' + sc.desc + '</span>';
        card.addEventListener('click', function () {
          self.selScenario = sc.id;
          self.refreshStartOptions();
        });
        scenHost.appendChild(card);
      });

      /* --- plague cards --- */
      var plHost = document.getElementById('plague-pick');
      plHost.innerHTML = '';
      PLAGUE_CARDS.forEach(function (pc) {
        var card = document.createElement('div');
        card.className = 'sel-card plague-card';
        card.dataset.plague = pc.id;
        card.innerHTML = '<img src="assets/icons/' + pc.icon + '.png" alt="">' +
          '<b>' + L10N.plain(pc.gui) + '</b><span>' + pc.desc + '</span>';
        card.addEventListener('click', function () {
          self.selPlague = pc.id;
          self.refreshStartOptions();
        });
        plHost.appendChild(card);
      });

      /* --- difficulty chips --- */
      var dHost = document.getElementById('diff-pick');
      dHost.innerHTML = '';
      [{ zh: '简单', d: 0, t: '医疗效率×0.75 · DNA×1.25 · 突变×0.7' },
       { zh: '普通', d: 1, t: '阶段1 校准原样' },
       { zh: '困难', d: 2, t: '医疗效率×1.35 · DNA×0.8 · 突变×1.5' }].forEach(function (dv) {
        var chip = document.createElement('button');
        chip.className = 'chip';
        chip.dataset.diff = String(dv.d);
        chip.title = dv.t;
        chip.textContent = dv.zh;
        chip.addEventListener('click', function () {
          self.selDifficulty = dv.d;
          self.refreshStartOptions();
        });
        dHost.appendChild(chip);
      });

      /* --- gene slots (5 standard categories from genes.json via engine Genes.SLOTS) --- */
      var gHost = document.getElementById('gene-pick');
      gHost.innerHTML = '';
      var genes = this.data.genes;
      PlagueEng.Genes.SLOTS.forEach(function (slot) {
        var row = document.createElement('div');
        row.className = 'gene-row';
        var lab = document.createElement('span');
        lab.className = 'gene-slot';
        lab.textContent = { dna: 'DNA 基因', evolve: '进化基因', mutation: '突变基因',
          travel: '传播基因', environmental: '环境基因' }[slot];
        var sel = document.createElement('select');
        sel.dataset.slot = slot;
        var none = document.createElement('option');
        none.value = '';
        none.textContent = '(无)';
        sel.appendChild(none);
        Object.keys(genes).forEach(function (gid) {
          var g = genes[gid];
          if (g.gene_category !== slot) return;
          var o = document.createElement('option');
          o.value = gid;
          o.textContent = L10N.plain(g.gene_name) + ' · ' + L10N.plain(g.gene_description || '');
          o.title = g.gene_description || '';
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          if (sel.value) self.selGenes[slot] = sel.value;
          else delete self.selGenes[slot];
        });
        row.appendChild(lab); row.appendChild(sel);
        gHost.appendChild(row);
      });

      this.refreshStartOptions();
      document.getElementById('p0-start').addEventListener('click', function () {
        ov.style.display = 'none';
        self.startGame(pick.value);
      });
      document.getElementById('p0-load').addEventListener('click', function () {
        if (self.loadSave()) ov.style.display = 'none';
        else alert('没有找到存档');
      });
    },

    /* reflect selection state onto the cards; scenario locks (black_death/board_game fix the
     * plague; cure hides plague + genes) come from the scenario's own data (scen_plague_type) */
    refreshStartOptions: function () {
      var self = this;
      var scenId = this.selScenario;
      var scen = null;
      if (scenId) {
        var cfg = PlagueEng.loadData.scenarioConfig ?
          null : null; // config computed at start; card rules hardcoded from scenario data
      }
      var lockPlague = null, hideGenes = false, note = '';
      if (scenId === 'black_death') { lockPlague = 'bacteria'; note = '黑死病: 场景专属细菌树(64 节点, 13 场景专有) · 场景政府表 · 医疗效率×0.35(近似"无现代医疗")'; }
      if (scenId === 'board_game') { lockPlague = 'neurax'; note = '极致桌游: 场景 neurax 树 80 节点 · 胜利=两年内所有国家可买到(简化) · 政府表 govactions_neurax'; }
      if (scenId === 'cure') { lockPlague = 'cure'; hideGenes = true; note = '解药方(简化反向玩法): 你是全球抗疫指挥 · 研发解药树(diseases/cure.json 88 节点) · 解药完成=胜利 · 瘟疫由场景 scen_symptoms 驱动自动进化'; }

      document.querySelectorAll('#scen-pick .sel-card').forEach(function (el) {
        el.classList.toggle('active', (el.dataset.scen || null) === scenId);
      });
      var plagueHost = document.getElementById('plague-pick');
      var plagueLabel = document.getElementById('plague-label');
      if (lockPlague) {
        plagueHost.style.display = 'none';
        plagueLabel.style.display = 'none';
      } else {
        plagueHost.style.display = '';
        plagueLabel.style.display = '';
        document.querySelectorAll('#plague-pick .sel-card').forEach(function (el) {
          el.classList.toggle('active', el.dataset.plague === self.selPlague);
        });
      }
      document.getElementById('gene-pick').style.display = hideGenes ? 'none' : '';
      document.querySelectorAll('#diff-pick .chip').forEach(function (el) {
        el.classList.toggle('active', Number(el.dataset.diff) === self.selDifficulty);
      });
      document.getElementById('scen-note').textContent = note;
    },

    startGame: function (patientZero) { try{SFX.play('start_pop')}catch(e){} 
      var self = this;
      this.patientZero = patientZero;
      document.body.classList.add('playing');
      var opts = {
        patientZero: patientZero, seed: (Date.now() & 0xffff) | 1,
        difficulty: this.selDifficulty,
        genes: this.selScenario === 'cure' ? null : this.selGenes
      };
      var data = this.data;
      this.scenario = null;
      if (this.selScenario) {
        var cfg = PlagueEng.Scenarios.scenarioConfig(data.scenarios[this.selScenario], data.diseases);
        data = Object.assign({}, data, { disease: cfg.disease });
        opts.scenarioRules = cfg.rules;
        if (cfg.govActionsData) opts.govActionsData = cfg.govActionsData;
        if (cfg.govTable) opts.govTable = cfg.govTable;
        if (cfg.plagueData) opts.plagueData = cfg.plagueData;
        this.scenario = { id: this.selScenario, rules: cfg.rules, info: cfg.info };
      } else {
        data = Object.assign({}, data, { disease: data.diseases[this.selPlague] });
      }
      this.engine = new PlagueEng.Engine(data, opts);
      this.setupUI();
    },

    /* ---------- game UI ---------- */
    setupUI: function () {
      var self = this;
      if (this.map) { this.map.wrap.parentNode.removeChild(this.map.wrap); this.map = null; }
      this.map = new root.MapView({
        container: document.getElementById('map-host'),
        countries: this.data.countries,
        onHover: function (k) { self.hover(k); },
        onClick: function (k) { self.select(k); }
      });
      this.map.onFrame = function (dt) {
        if (self.engine && self.speedTicks() > 0) self.map.updateParticles(self.engine, dt);
      };

      this.tree = new root.TreeView({
        container: document.getElementById('tree-host'),
        engine: this.engine,
        l10n: root.L10N,
        icons: this.data.icons,
        onChanged: function (what, id) { try{SFX.play(what==='bought'?'aasuccess':what==='devolved'?'buttonclose':'buttonclick')}catch(e){} self.refresh(what, id); }
      });

      var sp = document.getElementById('speed-ctl');
      sp.innerHTML = '';
      SPEEDS.forEach(function (s, i) {
        var b = document.createElement('button');
        b.className = 'speed-btn';
        b.textContent = s.label;
        b.addEventListener('click', function () { self.setSpeed(i); });
        sp.appendChild(b);
      });
      this.setSpeed(1);

      document.getElementById('btn-save').onclick = function () { self.saveGame(); };
      document.getElementById('btn-restart').onclick = function () { location.reload(); };

      this.selected = null;
      // HUD plague name + scenario banner
      var gui = this.engine.plagueTypeGui;
      document.getElementById('hud-plague').textContent =
        L10N.plain(gui) + (this.scenario ? ' · ' + (this.scenario.rules.label || this.scenario.id) : '');
      if (this.scenario && this.scenario.rules.label) this.flash(this.scenario.rules.label);
      this.renderSpecialActions();
      this.running = true;
      this.lastFrame = performance.now();
      requestAnimationFrame(function frame(now) {
        var dt = (now - self.lastFrame) / 1000;
        self.lastFrame = now;
        if (self.running && self.engine && !self.engine.gameOver) {
          var tps = self.speedTicks();
          self.tickAcc += tps * dt;
          var guard = 0;
          while (self.tickAcc >= 1 && guard < 12) {
            self.engine.tick();
            self.tickAcc -= 1;
            guard++;
            if (self.engine.gameOver) break;
          }
        }
        self.refresh();
        requestAnimationFrame(frame);
      });
      this.refresh();
    },

    speedTicks: function () { return SPEEDS[this.speedIdx].ticks; },
    setSpeed: function (i) {
      this.speedIdx = i;
      var btns = document.querySelectorAll('.speed-btn');
      for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('active', j === i);
    },

    hover: function (key) {
      var el = document.getElementById('hover-tip');
      if (!key) { el.style.display = 'none'; return; }
      var c = this.data.countries[key];
      if (!c) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      var st = this.engine ? this.engine.countries[key] : null;
      el.innerHTML = '<b>' + L10N.country(c.name) + '</b>' +
        (st && st.infected > 0 ? '<br>感染 ' + fmtI(st.infected) : '');
    },

    select: function (key) {
      this.selected = key;
      this.renderCountryPanel();
    },

    renderCountryPanel: function () {
      var self = this;
      var host = document.getElementById('country-panel');
      var key = this.selected;
      if (!key || !this.data.countries[key]) { host.style.display = 'none'; return; }
      var c = this.data.countries[key], st = this.engine.countries[key];
      var l = root.L10N;
      function tag(zh, on) { return on ? '<span class="tag on">' + zh + '</span>' : '<span class="tag">' + zh + '</span>'; }
      var N = st.pop0 || 1;
      var infP = (st.infected / N * 100), deadP = (st.dead / N * 100);
      var actions = Object.keys(st.actions).map(function (aid) {
        var a = self.data.govactions.govactions_standard[aid];
        return a ? l.plain(a.action_name) : aid;
      });
      host.style.display = 'block';
      host.innerHTML =
        '<div class="cp-head"><b>' + l.country(c.name) + '</b>' +
        '<button class="cp-close" onclick="document.getElementById(\'country-panel\').style.display=\'none\'">×</button></div>' +
        '<div class="cp-row"><span>人口</span><b>' + fmtI(c.original_population) + '</b></div>' +
        '<div class="cp-row"><span>大陆</span><b>' + zhContinent(c.continent) + '</b></div>' +
        '<div class="cp-tags">' + tag('富裕', c.wealthy) + tag('贫困', c.poverty) + tag('城市', c.urban) +
          tag('农村', c.rural) + tag('炎热', c.hot) + tag('寒冷', c.cold) + tag('潮湿', c.humid) + tag('干旱', c.arid) +
          tag('机场', c.airport) + tag('港口', c.port) + '</div>' +
        '<div class="cp-row"><span>医疗预算</span><b>$' + c.medical_budget + '</b></div>' +
        '<div class="cp-row"><span>医疗能力</span><b>' + c.medical_capacity + '</b></div>' +
        '<div class="cp-bar"><span>健康</span><div class="bar"><i style="width:' + (100 - infP - deadP).toFixed(2) + '%;background:#5a8f6e"></i></div><b>' + fmtI(st.healthy) + '</b></div>' +
        '<div class="cp-bar"><span>感染</span><div class="bar"><i style="width:' + infP.toFixed(2) + '%;background:#c62828"></i></div><b>' + fmtI(st.infected) + '</b></div>' +
        '<div class="cp-bar"><span>死亡</span><div class="bar"><i style="width:' + deadP.toFixed(2) + '%;background:#333"></i></div><b>' + fmtI(st.dead) + '</b></div>' +
        '<div class="cp-row"><span>疫情已发现</span><b>' + (st.detected ? '是' : '否') + '</b></div>' +
        '<div class="cp-row"><span>边境</span><b>' + (st.airOpen ? '空✈ ' : '空✖ ') + (st.seaOpen ? '海🚢 ' : '海✖ ') + (st.landOpen ? '陆🚶' : '陆✖') + '</b></div>' +
        (actions.length ? '<div class="cp-actions"><span>政府措施</span><div>' + actions.map(function (a) { return '<span class="tag on">' + a + '</span>'; }).join('') + '</div></div>' : '');
    },

    refresh: function (what, id) {
      var e = this.engine;
      if (!e) return;
      var t = e.totals();
      document.getElementById('hud-day').textContent = '第 ' + e.day + ' 天';
      document.getElementById('hud-dna').textContent = Math.floor(e.dna);
      document.getElementById('stat-healthy').textContent = fmtI(t.healthy);
      document.getElementById('stat-infected').textContent = fmtI(t.infected);
      document.getElementById('stat-dead').textContent = fmtI(t.dead);
      var cureP = (e.cure.progress * 100);
      document.getElementById('cure-bar').style.width = cureP.toFixed(2) + '%';
      document.getElementById('cure-pct').textContent = cureP.toFixed(1) + '%';
      // trait bars (points vs max sum over all nodes — data-driven scale)
      var sums = this.traitMax();
      bar('bar-inf', e.traits.infectiousness, sums.inf);
      bar('bar-sev', e.effSeverity(), sums.sev);
      bar('bar-let', e.effLethality(), sums.let);
      document.getElementById('val-inf').textContent = Math.round(e.traits.infectiousness);
      document.getElementById('val-sev').textContent = Math.round(e.effSeverity()) +
        (e.effSeverity() !== e.traits.severity ? ' (' + Math.round(e.traits.severity) + ')' : '');
      document.getElementById('val-let').textContent = Math.round(e.effLethality()) +
        (e.autoLethality >= 0.05 ? ' (自动+' + e.autoLethality.toFixed(1) + ')' : '');
      this.map.paint(e.countries);
      this.renderCountryPanel();
      this.renderNews();
      this.watchMutationNews();
      this.renderSpecialActions();
      if (e.gameOver) this.showEnd(e.gameOver);
      if (what === 'evolve' || what === 'devolve') {
        this.flash(e.owned[id] ? '进化: ' + L10N.plain(e.data.disease.nodes[id].name) :
          '退化: ' + L10N.plain(e.data.disease.nodes[id].name));
      }
    },

    traitMax: function () {
      if (this._tmax) return this._tmax;
      var s = { inf: 1, sev: 1, let: 1 };
      var nodes = this.data.disease.nodes;
      for (var id in nodes) {
        s.inf += Math.abs(nodes[id].change_to_infectiousness || 0);
        s.sev += Math.abs(nodes[id].change_to_severity || 0);
        s.let += Math.abs(nodes[id].change_to_lethality || 0);
      }
      this._tmax = s;
      return s;
    },

    renderNews: function () {
      var host = document.getElementById('news-list');
      var e = this.engine;
      var start = Math.max(0, e.news.length - 30);
      var html = [];
      for (var i = e.news.length - 1; i >= start; i--) {
        var n = e.news[i];
        var params = {};
        if (n.params) {
          Object.keys(n.params).forEach(function (p) {
            params[p] = L10N.plain(n.params[p]);   // country/symptom names → zh
          });
        }
        html.push('<div class="news-item k-' + n.kind + '"><span class="news-day">第' + n.day + '天</span> ' +
          L10N.t(n.key, params) + '</div>');
      }
      host.innerHTML = html.join('');
    },

    /* flash a toast when the plague mutates on its own (virus feels alive) */
    watchMutationNews: function () {
      var e = this.engine;
        try{SFX.play('aapickup')}catch(e){}
      if (e.news.length > this.lastNewsLen) {
        for (var i = this.lastNewsLen; i < e.news.length; i++) {
            try{SFX.play('siren')}catch(e){}
          if (e.news[i].kind === 'mutation') {
            this.flash('⚠ ' + L10N.t(e.news[i].key, { s: e.plagueName, s2: L10N.plain(e.news[i].params.s2 || '') }));
          }
        }
      }
      this.lastNewsLen = e.news.length;
    },

    /* plague-specific action buttons (engine.specialActions drives what exists) */
    renderSpecialActions: function () {
      var self = this;
      var host = document.getElementById('special-actions');
      if (!host || !this.engine) return;
      var acts = this.engine.specialActions();
      host.innerHTML = '';
      acts.forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'special-btn';
        b.dataset.action = a.id;
        b.innerHTML = '<b>' + a.label + '</b><span>' + a.cost + ' DNA · ' + a.hint + '</span>';
        b.disabled = self.engine.dna < a.cost;
        b.addEventListener('click', function () {
          if (a.kind === 'spore') { if (self.engine.evolve(a.node)) self.flash('孢子爆发! 感染了新的国家'); }
          else if (a.kind === 'killcode') {
            if (self.engine.launchKillCode()) self.flash('终止码广播成功 — 解药进度已清零');
          }
          self.refresh();
        });
        host.appendChild(b);
      });
    },

    showEnd: function (go) { try{SFX.play(go.win?'lastbreath':'aafail')}catch(e){} 
      var ov = document.getElementById('end-screen');
      if (ov.style.display === 'flex') return;
      ov.style.display = 'flex';
      var t = this.engine.totals();
      var curePlayer = !!(this.scenario && this.scenario.rules.cureMode);
      var title = go.win ? (curePlayer ? '🌍 世界得救' : '🏆 人类灭绝') : '💀 游戏失败';
      var reason = go.reason === 'cure_complete' ? (curePlayer ? '解药研发完成，你拯救了世界' : '解药研发完成，人类获救') :
        go.reason === 'eradicated' ? '病原体被彻底消灭' :
        go.reason === 'ubiquity' ? '游戏风靡全球，所有国家都能买到' :
        go.reason === 'time_limit' ? '两年期限已到，投资人撤资' : go.reason;
      document.getElementById('end-title').textContent = title;
      document.getElementById('end-sub').textContent =
        reason + ' · 第 ' + go.day + ' 天 · 死亡 ' + fmtI(t.dead) + ' / ' + fmtI(t.pop0);
      this.running = false;
    },

    flash: function (msg) {
      var f = document.getElementById('flash');
      f.textContent = msg;
      f.classList.add('show');
      setTimeout(function () { f.classList.remove('show'); }, 1400);
    },

    /* ---------- save / load ---------- */
    saveGame: function () {
      try {
        localStorage.setItem('plague_web_save', JSON.stringify({
          engine: this.engine.save(), patientZero: this.patientZero, speedIdx: this.speedIdx,
          selPlague: this.selPlague, selScenario: this.selScenario, scenario: this.scenario
        }));
        this.flash('已保存存档');
      } catch (err) { this.flash('保存失败: ' + err); }
    },

    loadSave: function () {
      var raw = localStorage.getItem('plague_web_save');
      if (!raw) return false;
      var sv = JSON.parse(raw);
      this.patientZero = sv.patientZero;
      document.body.classList.add('playing');
      // rebuild the same disease/scenario context the save was made with
      var esv = sv.engine || {};
      var opts = { patientZero: sv.patientZero, seed: 1, difficulty: esv.difficulty };
      var data = this.data;
      if (esv.scenarioRules && esv.scenarioRules.cureMode) {
        var cfgC = PlagueEng.Scenarios.scenarioConfig(data.scenarios.cure, data.diseases);
        data = Object.assign({}, data, { disease: cfgC.disease });
        opts.scenarioRules = cfgC.rules; opts.plagueData = cfgC.plagueData;
        opts.govTable = cfgC.govTable;
      } else if (sv.selScenario && data.scenarios[sv.selScenario]) {
        var cfg = PlagueEng.Scenarios.scenarioConfig(data.scenarios[sv.selScenario], data.diseases);
        data = Object.assign({}, data, { disease: cfg.disease });
        opts.scenarioRules = cfg.rules;
        if (cfg.govActionsData) opts.govActionsData = cfg.govActionsData;
        if (cfg.govTable) opts.govTable = cfg.govTable;
      } else {
        data = Object.assign({}, data, { disease: data.diseases[sv.selPlague || 'bacteria'] });
        opts.genes = esv.genes;
      }
      this.selScenario = sv.selScenario || null;
      this.selPlague = sv.selPlague || 'bacteria';
      this.scenario = sv.scenario || null;
      this.engine = new PlagueEng.Engine(data, opts);
      this.engine.load(esv);
      this.setupUI();
      this.setSpeed(sv.speedIdx || 1);
      return true;
    },

    /* ---------- test hooks (browser assertions) ---------- */
    testAPI: function () {
      var self = this;
      return {
        engine: function () { return self.engine; },
        state: function () { return self.engine.snapshotForTest(); },
        ff: function (days) {   // cheat fast-forward
          var last = null;
          for (var i = 0; i < days; i++) last = self.engine.tick();
          self.refresh();
          return { over: last, state: self.engine.snapshotForTest() };
        },
        giveDna: function (n) { self.engine.dna += n; },
        buyNode: function (id) { return self.engine.evolve(id); },
        nodeInfo: function (id) { var nd = self.engine.data.disease.nodes[id]; return { name: nd.name, zh: L10N.plain(nd.name), cost: self.engine.nodeCost(id), inf: nd.change_to_infectiousness || 0 }; },
        countryCount: function () { return self.map ? self.map.countryCount : 0; },
        mapReady: function () { return !!(self.map && self.map.countryCount); },
        hoverName: function (key) { var c = self.data.countries[key]; return c ? L10N.country(c.name) : null; },
        countryPanel: function (key) {
          var c = self.data.countries[key], st = self.engine.countries[key];
          return { pop: c.original_population, healthy: st.healthy, infected: st.infected, dead: st.dead, name: c.name, zh: L10N.plain(c.name) };
        },
        select: function (key) { self.select(key); return true; },
        cureProgress: function () { return self.engine.cure.progress; },
        gameOver: function () { return self.engine.gameOver; },
        /* ---- phase-2 hooks ---- */
        gameInfo: function () {
          return { plagueType: self.engine.plagueTypeGui, difficulty: self.engine.difficulty,
            scenario: self.selScenario, govTable: self.engine.govTableUsed,
            genes: self.engine.gm.picked, winMode: self.engine.scenarioRules.winMode || null,
            cureMode: !!self.engine.cureMode };
        },
        treeCounts: function () {
          var nodes = self.engine.data.disease.nodes, t = {};
          for (var id in nodes) { var g = nodes[id].grid_type; t[g] = (t[g] || 0) + 1; }
          t.total = Object.keys(nodes).length;
          return t;
        },
        specialActions: function () { return self.engine.specialActions(); },
        killCode: function () { return self.engine.launchKillCode(); },
        killCodeUnlocked: function () { return self.engine.killCodeUnlocked(); },
        effSeverity: function () { return self.engine.effSeverity(); },
        autoLethality: function () { return self.engine.autoLethality; },
        mutationCount: function () {
          return self.engine.news.filter(function (n) { return n.kind === 'mutation'; }).length;
        },
        selectStart: function (opts) {
          self.selPlague = opts.plague || 'bacteria';
          self.selDifficulty = (opts.difficulty === undefined) ? 1 : opts.difficulty;
          self.selScenario = opts.scenario === undefined ? null : opts.scenario;
          self.selGenes = opts.genes || {};
          return true;
        },
        startNew: function (country) {
          document.getElementById('start-screen').style.display = 'none';
          self.startGame(country || 'china');
          return true;
        },
        specialButtons: function () {
          return Array.prototype.map.call(document.querySelectorAll('#special-actions .special-btn'), function (b) {
            return { action: b.dataset.action, disabled: b.disabled, text: b.textContent };
          });
        }
      };
    }
  };

  function bar(id, v, max) {
    var el = document.getElementById(id);
    el.style.width = Math.min(100, (v / max) * 100).toFixed(2) + '%';
  }
  function fmtI(x) {
    if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
    if (x >= 1e3) return (x / 1e3).toFixed(1) + 'K';
    return String(Math.round(x));
  }
  function zhContinent(en) {
    return { 'North_America': '北美洲', 'South_America': '南美洲', 'Europe': '欧洲', 'Africa': '非洲', 'Asia': '亚洲', 'Oceania': '大洋洲' }[en] || en;
  }

  root.App = App;
  document.addEventListener('DOMContentLoaded', function () {
    App.boot();
    // expose test API as soon as a game exists
    Object.defineProperty(root, '__PLAGUE__', {
      get: function () { return App.engine ? App.testAPI() : null; }
    });
  });
})(typeof self !== 'undefined' ? self : this);
