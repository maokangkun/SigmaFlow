/* ================= 虚拟病原体 · 页面控制器(P0: 目录浏览 + 尺度面板骨架) =================
 * 与虚拟患者页同构: V.pathogen 渲染静态壳 #pathogen-root, app.js 在重渲染时
 * 把活的 DOM 原样搬回; 本文件挂载后负责目录浏览/详情/事件记录, 各尺度引擎
 * (宿主内动力学/测序/群体/试验台)在后续迭代里挂进同一壳, 不换布局。
 * 全局函数 + inline onclick(无 CSP 限制), DOM 只认 getElementById。
 */
(() => {
  const esc = s => CS.escape(String(s ?? ''));
  const P2 = { sel: 'InfluenzaA', scale: 'host', kind: 'any', q: '', logN: 0 };

  const KINDS = [
    ['virus', '病毒'], ['bacterium', '细菌'], ['fungus', '真菌'],
    ['protozoan', '原虫'], ['helminth', '蠕虫'], ['prion', '朊粒'],
  ];
  const SCALES = [
    ['molecular', '分子/基因'],
    ['host', '宿主内'],
    ['diag', '诊断读数'],
    ['pop', '群体动态'],
    ['trial', '试验台'],
  ];
  const SCALE_DESC = {
    molecular: '伪基因组 · 变异检出 · 耐药注释 · 抗原逃逸 · 演化预测 · 药物匹配 · 疫苗设计 · 系统发生 · 宿主溯源',
    host: '载量动力学 · 固有/适应性免疫 · 药代/药效(MIC/选择窗) · 耐药亚群竞争 · 传染性曲线',
    diag: 'qPCR Ct · 抗原 · 培养/CFU · 血清学(IgM/IgG) · MIC 面板 · 测序读数与病原识别 —— 所有观测都有检出限与假阴',
    pop: '元种群 SEIR · 变异株频率 · 疫苗/隔离/检测干预 · 基因组监测采样 · 溢出预警评分',
    trial: '协议定义 · 多臂多重复 · 指标与置信区间 · A/B 对比 · 真值评分 · CSV 导出',
  };

  function log(html, cls) {
    const box = document.getElementById('p2Log');
    if (!box) return;
    P2.logN++;
    const row = document.createElement('div');
    row.className = 'p2-ev ' + (cls || '');
    row.innerHTML = `<span class="p2-t">${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</span> ` + rich(html);
    box.prepend(row);
    while (box.children.length > 200) box.lastChild.remove();
  }
  // 简化版 rich: 保护 <b>, 其余转义 —— 大块内容走 innerHTML 的唯一入口
  function rich(s) {
    return esc(s).replace(/&lt;(\/?b)&gt;/g, '<$1>');
  }

  function tierBadge(t) {
    const zh = { A: '精调', B: '原型校准', C: '目录级' }[t] || t;
    return `<span class="p2-tier t${t}" title="保真度层级 ${t}: ${zh}参数">${t}</span>`;
  }

  function fmtDays(e) {
    const f = x => (x >= 30 ? Math.round(x) : x >= 1 ? (Math.round(x * 10) / 10) : Math.round(x * 24) + 'h');
    if (e.incMax - e.incMin < 0.01) return f(e.incMin);
    return `${f(e.incMin)}–${f(e.incMax)}`;
  }

  function render() {
    const root = document.getElementById('pathogen-root');
    if (!root || !window.PathoCatalog) return;
    const C = window.PathoCatalog;
    const list = C.search(P2.q, P2.kind);
    const e = C.get(P2.sel) || list[0] || C.all()[0];
    if (e) P2.sel = e.id;
    const kindsBox = document.getElementById('p2Kinds');
    if (kindsBox) kindsBox.innerHTML = KINDS.map(([k, zh]) => {
      const n = C.byKind(k).length;
      const on = P2.kind === k;
      return `<button type="button" class="p2-chip ${on ? 'on' : ''}" onclick="PathoUI.setKind('${k}')">${zh}<i>${n}</i></button>`;
    }).join('') + `<button type="button" class="p2-chip ${P2.kind === 'any' ? 'on' : ''}" onclick="PathoUI.setKind('any')">全部<i>${C.all().length}</i></button>`;
    const listBox = document.getElementById('p2List');
    if (listBox) {
      const html = list.map(it => `
        <button type="button" class="p2-row ${it.id === P2.sel ? 'sel' : ''}" onclick="PathoUI.pick('${esc(it.id)}')">
          <span class="p2-name">${esc(it.zh)}${tierBadge(it.tier)}</span>
          <span class="p2-sub">${esc(it.id)} · ${esc(it.genomeType)}${it.r0 ? ` · R0 ${it.r0.lo}–${it.r0.hi}` : ''}${it.vaccine ? ' · 疫苗' : ''}</span>
        </button>`).join('');
      listBox.innerHTML = html || '<div class="p2-empty">没有匹配的病原体</div>';
    }
    const info = document.getElementById('p2Info');
    if (info && e) {
      const rows = [
        ['分类', `${({ virus: '病毒', bacterium: '细菌', fungus: '真菌', protozoan: '原虫', helminth: '蠕虫', prion: '朊粒' })[e.kind] || e.kind} · 原型 ${e.arch}`],
        ['基因组', e.genomeType || '—'],
        ['潜伏期', fmtDays(e)],
        ['传播途径', e.tx.join(' / ') || '—'],
        ['基本再生数', e.r0 ? `${e.r0.lo} – ${e.r0.hi}` : '不适用 / 未知'],
        ['动物/环境储存', e.reservoir || '—'],
        ['媒介', e.vector || '—'],
        ['生物安全等级', 'BSL-' + e.bsl],
       ['病原体治疗类', e.rxCls().length ? e.rxZh(e.rxCls()).join('、') : '支持治疗为主'],
        ['注释', e.rxNotes().join('；') || '—'],
        ['疫苗', e.vaccine || '无上市疫苗'],
        ['严重度(1-5)', String(e.sev)],
      ];
      info.innerHTML = `
        <div class="p2-title">${esc(e.zh)} ${tierBadge(e.tier)}</div>
        <div class="p2-id">${esc(e.id)}${e.kind === 'prion' ? '' : ` · 突变供给 μ≈${e.mu.toExponential(0)} · 宿主内复制率 r≈${e.rHost}/天`}</div>
        ${rows.map(([k, v]) => `<div class="p2-field"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}`;
    }
  }

  window.PathoUI = {
    pick(id) { P2.sel = id; const C = window.PathoCatalog; const e = C && C.get(id); if (e) { log(`🦠 选定 <b>${e.zh}</b>（${e.id}, tier ${e.tier}）—— 原型 ${e.arch}`); render(); } },
    setKind(k) { P2.kind = k; render(); },
    setScale(s) { P2.scale = s; const t = document.getElementById('p2ScaleDesc'); if (t) t.textContent = SCALE_DESC[s] + '。引擎接线进行中, 下一步进入本尺度时激活。'; for (const b of document.querySelectorAll('.p2-scale')) b.classList.toggle('on', b.dataset.s === s); },
    search(v) { P2.q = v; render(); },
  };

  // ---- 挂载(P0): 数据就位 + 首渲染 + 记录 ----
  window.mountPathogenPage = function () {
    const root = document.getElementById('pathogen-root');
    if (!root) return;
    if (!window.PathoCatalog) {
      CS.ensureLazy('catalog').then(ok => { if (ok) window.mountPathogenPage(); });
      return;
    }
    if (root.dataset.mounted) { render(); return; }
    root.dataset.mounted = '1';
    // 高度适配与患者页同款: CSS 的 height:100% 不感知 body zoom, 也不保证
    // .main-cols 提供父高, 用可视余量精确兜底, 否则目录列表会把页顶到数万 px。
    const fit = () => {
      const el = document.getElementById('pathogen-root');
      if (!el) return;
      if (window.matchMedia('(max-width:1000px)').matches) { el.style.height = ''; return; }
      const zoom = parseFloat(document.body.style.zoom) || 1;
      const top = el.getBoundingClientRect().top;
      el.style.height = Math.max(560, (window.innerHeight - top) / zoom) + 'px';
    };
    window.PathoFit = fit;
    fit();
    if (!window.PathoFitBound) {
      window.PathoFitBound = true;
      window.addEventListener('resize', () => { if (document.getElementById('pathogen-root') && window.PathoFit) window.PathoFit(); });
    }
    const counts = window.PathoCatalog.kinds();
    log(`<b>虚拟病原体环境就绪</b> —— 目录 ${window.PathoCatalog.all().length} 个条目（${Object.entries(counts).map(([k, v]) => `${({ virus: '病毒', bacterium: '细菌', fungus: '真菌', protozoan: '原虫', helminth: '蠕虫', prion: '朊粒' })[k]}${v}`).join(' / ')}）, 原型 ${Object.keys(window.PathoCatalog.arch).length} 组。`);
    log('本环境为<b>教学/训练沙盒</b>：参数为教科书量级, 用于相对比较与机制理解, 不作为临床或流行病学预测依据。');
    render();
  };
})();
