/* Evolution tree UI — 3 tabs (symptom / transmission / ability) from grid_type,
 * layered DAG layout from tech_requirement_and/or, icons from base_graphic,
 * zh names + costs + effect summaries from the disease data. */
(function (root) {
  'use strict';

  var TAB_DEFS = [
    { type: 'symptom', zh: '症状', en: 'Symptoms' },
    { type: 'transmission', zh: '传播方式', en: 'Transmission' },
    { type: 'ability', zh: '特殊能力', en: 'Abilities' }
  ];

  function EffectText() {} // built in main via L10N + node data

  function TreeView(opts) {
    this.container = opts.container;
    this.engine = opts.engine;
    this.l10n = opts.l10n;
    this.nodes = opts.engine.data.disease.nodes;
    this.icons = opts.icons || null;   // data/icons_manifest.json — skip missing files
    this.onChanged = opts.onChanged || function () {};
    this.activeTab = 'symptom';
    this._layout = {};
    this._build();
  }

  TreeView.prototype.iconFor = function (nd) {
    var g = nd.base_graphic;
    if (!g) return null;
    if (!this.icons) return 'assets/icons/' + g + '.png';
    if (this.icons.indexOf(g + '.png') >= 0) return 'assets/icons/' + g + '.png';
    if (this.icons.indexOf(g + '@2x.png') >= 0) return 'assets/icons/' + g + '@2x.png';
    return null;
  };

  TreeView.prototype.effectsOf = function (nd) {
    var out = [];
    var map = [
      ['change_to_infectiousness', '传染性+'], ['change_to_severity', '严重度+'], ['change_to_lethality', '致命性+'],
      ['change_to_wealthy', '富裕加成+'], ['change_to_poverty', '贫困加成+'], ['change_to_urban', '城市加成+'],
      ['change_to_rural', '农村加成+'], ['change_to_hot', '炎热加成+'], ['change_to_cold', '寒冷加成+'],
      ['change_to_humid', '潮湿加成+'], ['change_to_arid', '干旱加成+'],
      ['change_to_air_transmission', '空路+'], ['change_to_sea_transmission', '海路+'],
      ['change_to_land_transmission', '陆路+'], ['change_to_cure_base_multiplier', '解药需求+'],
      ['change_to_research_inefficiency_multiplier', '研究低效+'], ['change_to_mutation', '突变+']
    ];
    for (var i = 0; i < map.length; i++) {
      var v = nd[map[i][0]];
      if (typeof v === 'number' && v) out.push(map[i][1] + (Math.round(v * 100) / 100));
    }
    return out;
  };

  TreeView.prototype.reqText = function (nd) {
    var Model = root.PlagueEng.Model;
    var and = Model.reqList(nd.tech_requirement_and), or = Model.reqList(nd.tech_requirement_or);
    var nameOf = function (id) {
      var n = this.nodes[id];
      return n ? this.l10n.plain(n.name) : id;
    }.bind(this);
    var parts = [];
    if (and.length) parts.push(and.map(nameOf).join(' + '));
    if (or.length) parts.push(or.map(nameOf).join(' / '));
    return parts.join(' 且 ');
  };

  /* depth in the requirement DAG within the tab (requirements across tabs count as roots) */
  TreeView.prototype.depthOf = function (id, memo) {
    memo = memo || {};
    if (memo[id] !== undefined) return memo[id];
    memo[id] = 0;
    var nd = this.nodes[id];
    var Model = root.PlagueEng.Model;
    var reqs = Model.reqList(nd.tech_requirement_and).concat(Model.reqList(nd.tech_requirement_or));
    var d = 0;
    for (var i = 0; i < reqs.length; i++) {
      var r = reqs[i];
      if (this.nodes[r] && this.nodes[r].grid_type === nd.grid_type) {
        d = Math.max(d, this.depthOf(r, memo) + 1);
      }
    }
    memo[id] = d;
    return d;
  };

  TreeView.prototype._build = function () {
    var self = this;
    this.container.innerHTML = '';
    var tabs = document.createElement('div');
    tabs.className = 'tree-tabs';
    TAB_DEFS.forEach(function (td) {
      var b = document.createElement('button');
      b.className = 'tree-tab';
      b.dataset.type = td.type;
      b.textContent = td.zh + ' ' + td.en;
      b.addEventListener('click', function () {
        self.activeTab = td.type;
        self.render();
      });
      tabs.appendChild(b);
    });
    this.container.appendChild(tabs);
    this.body = document.createElement('div');
    this.body.className = 'tree-body';
    this.container.appendChild(this.body);
    this.render();
  };

  TreeView.prototype.render = function () {
    var self = this;
    var tabs = this.container.querySelectorAll('.tree-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.type === this.activeTab);
    }
    var nodes = this.nodes, eng = this.engine;
    var ids = Object.keys(nodes).filter(function (id) { return nodes[id].grid_type === self.activeTab; });
    var memo = {};
    var byDepth = {};
    ids.forEach(function (id) {
      var d = self.depthOf(id, memo);
      (byDepth[d] = byDepth[d] || []).push(id);
    });
    this.body.innerHTML = '';
    Object.keys(byDepth).sort(function (a, b) { return a - b; }).forEach(function (d) {
      byDepth[d].sort(function (a, b) { return (nodes[a].grid_position || 0) - (nodes[b].grid_position || 0); });
      var col = document.createElement('div');
      col.className = 'tree-col';
      byDepth[d].forEach(function (id) { col.appendChild(self._nodeCard(id)); });
      self.body.appendChild(col);
    });
  };

  TreeView.prototype._nodeCard = function (id) {
    var self = this, nd = this.nodes[id], eng = this.engine;
    var Model = root.PlagueEng.Model;
    var card = document.createElement('div');
    var owned = !!eng.owned[id];
    var available = Model.nodeAvailable(nd, eng.owned);
    var cost = eng.nodeCost(id);
    var mutated = !!eng.mutated[id];
    card.className = 'tree-node' + (owned ? ' owned' : '') + (available ? '' : ' locked') +
      (eng.dna >= cost && available && !owned ? ' affordable' : '') +
      (mutated ? ' mutated' : '');
    card.dataset.node = id;
    card.dataset.name = nd.name;
    card.dataset.cost = String(cost);
    card.dataset.infectiousness = String(nd.change_to_infectiousness || 0);

    var icon = document.createElement('img');
    icon.className = 'tn-icon';
    var src = this.iconFor(nd);
    if (src) { icon.src = src; icon.onerror = function () { this.style.visibility = 'hidden'; }; }
    else icon.style.visibility = 'hidden';
    card.appendChild(icon);

    var main = document.createElement('div');
    main.className = 'tn-main';
    var nm = document.createElement('div');
    nm.className = 'tn-name';
    nm.textContent = this.l10n.plain(nd.name);
    var meta = document.createElement('div');
    meta.className = 'tn-meta';
    meta.textContent = owned ? (mutated ? '已进化 · 自然变异' : '已进化') : (cost + ' DNA');
    main.appendChild(nm); main.appendChild(meta);

    var effs = this.effectsOf(nd);
    if (effs.length) {
      var ef = document.createElement('div');
      ef.className = 'tn-effects';
      ef.textContent = effs.join(' · ');
      main.appendChild(ef);
    }
    var rq = this.reqText(nd);
    if (rq && !owned) {
      var r = document.createElement('div');
      r.className = 'tn-req';
      r.textContent = '前置: ' + rq;
      main.appendChild(r);
    }
    card.appendChild(main);

    var tip = document.createElement('div');
    tip.className = 'tn-tip';
    var zhDesc = this.l10n.t(nd.description || '');
    tip.innerHTML = '<b>' + this.l10n.plain(nd.name) + '</b><br>' + zhDesc +
      (rq ? '<br><i>前置: ' + rq + '</i>' : '');
    card.appendChild(tip);

    card.addEventListener('click', function (ev) {
      if (owned) {
        if (ev.shiftKey) {
          if (eng.devolve(id)) { self.onChanged('devolve', id); self.render(); }
        }
        return;
      }
      if (eng.evolve(id)) { self.onChanged('evolve', id); self.render(); }
    });
    return card;
  };

  root.TreeView = TreeView;
})(typeof self !== 'undefined' ? self : this);
