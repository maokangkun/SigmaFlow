/* ================= 虚拟病原体 · 页面控制器(P1) =================
 * 与虚拟患者页同构: V.pathogen 渲染静态壳 #pathogen-root, app.js 在重渲染时
 * 把活的 DOM 原样搬回。本文件负责: 目录浏览/宿主内控制台/四联图/诊断面板/
 * 事件记录, 以及环境桥(让智能体的 pathogen_* 工具直接开这台引擎)。
 * 全局函数 + inline onclick(生产服务无 CSP 限制), DOM 只认 getElementById。
 */
(() => {
  const esc = s => CS.escape(String(s ?? ''));
  const P2 = { sel: 'InfluenzaA', scale: 'host', kind: 'any', q: '', logN: 0, ready: false, timer: 0 };

  const KINDS = [
    ['virus', '病毒'], ['bacterium', '细菌'], ['fungus', '真菌'],
    ['protozoan', '原虫'], ['helminth', '蠕虫'], ['prion', '朊粒'],
  ];
  const KIND_ZH = { virus: '病毒', bacterium: '细菌', fungus: '真菌', protozoan: '原虫', helminth: '蠕虫', prion: '朊粒' };
  const RX_MG = { bl: 500, blsi: 500, car: 1000, gly: 1000, oxa: 600, mac: 500, tet: 100, ag: 5, fq: 500, sul: 800, chl: 500, linc: 600, dap: 6, str: 7.5, col: 125, mnz: 500, rif: 600, inh: 300, pza: 1500, emb: 1200, tgc: 100, nai: 75, rdrp: 200, pol: 400, rt: 300, pi: 600, inst: 50, ifn: 180, ns5: 400, rib: 1000, mab: 300, azole: 200, ampho: 350, echino: 100, art: 80, cq: 600, mfq: 250, pq: 30, atov: 500, parom: 500, pent: 4, eflor: 400, suram: 1000, melar: 3.6, nifurt: 15, nitaz: 500, bzd: 400, praz: 40, iver: 12, pyr: 500, dec: 400, tcbz: 250, sb: 850 };

  // ---------------- 事件记录(受控 innerHTML 唯一入口) ----------------
  function rich(s) { return esc(s).replace(/&lt;(\/?b)&gt;/g, '<$1>'); }
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

  function tierBadge(t) {
    const zh = { A: '精调', B: '原型校准', C: '目录级' }[t] || t;
    return `<span class="p2-tier t${t}" title="保真度 ${t}: ${zh}参数">${t}</span>`;
  }
  const fmtDays = e => {
    const f = x => (x >= 30 ? Math.round(x) : x >= 1 ? Math.round(x * 10) / 10 : Math.round(x * 24) + 'h');
    return e.incMax - e.incMin < 0.01 ? f(e.incMin) : `${f(e.incMin)}–${f(e.incMax)}`;
  };
  const cur = () => window.PathoCatalog ? window.PathoCatalog.get(P2.sel) : null;
  const host = () => window.PathoHost || null;

  // ---------------- 渲染: 目录 + 详情 ----------------
  function render() {
    const root = document.getElementById('pathogen-root');
    if (!root || !window.PathoCatalog) return;
    const C = window.PathoCatalog;
    const list = C.search(P2.q, P2.kind);
    const e = C.get(P2.sel) || list[0] || C.all()[0];
    if (e) P2.sel = e.id;
    const kindsBox = document.getElementById('p2Kinds');
    if (kindsBox) kindsBox.innerHTML = KINDS.map(([k, zh]) =>
      `<button type="button" class="p2-chip ${P2.kind === k ? 'on' : ''}" onclick="PathoUI.setKind('${k}')">${zh}<i>${C.byKind(k).length}</i></button>`
    ).join('') + `<button type="button" class="p2-chip ${P2.kind === 'any' ? 'on' : ''}" onclick="PathoUI.setKind('any')">全部<i>${C.all().length}</i></button>`;
    const listBox = document.getElementById('p2List');
    if (listBox) listBox.innerHTML = list.map(it => `
      <button type="button" class="p2-row ${it.id === P2.sel ? 'sel' : ''}" onclick="PathoUI.pick('${esc(it.id)}')">
        <span class="p2-name">${esc(it.zh)}${tierBadge(it.tier)}</span>
        <span class="p2-sub">${esc(it.id)} · ${esc(it.genomeType)}${it.r0 ? ` · R0 ${it.r0.lo}–${it.r0.hi}` : ''}${it.vaccine ? ' · 疫苗' : ''}</span>
      </button>`).join('') || '<div class="p2-empty">没有匹配的病原体</div>';
    const info = document.getElementById('p2Info');
    if (info && e) {
      const rows = [
        ['分类', `${KIND_ZH[e.kind] || e.kind} · 原型 ${e.arch}`],
        ['基因组', e.genomeType || '—'],
        ['潜伏期', fmtDays(e)],
        ['传播途径', e.tx.join(' / ') || '—'],
        ['基本再生数', e.r0 ? `${e.r0.lo} – ${e.r0.hi}` : '不适用 / 未知'],
        ['动物/环境储存', e.reservoir || '—'],
        ['媒介', e.vector || '—'],
        ['生物安全等级', 'BSL-' + e.bsl],
        ['治疗类别', e.rxCls().length ? e.rxZh(e.rxCls()).join('、') : '支持治疗为主'],
        ['注释', e.rxNotes().join('；') || '—'],
        ['疫苗', e.vaccine || '无上市疫苗'],
        ['严重度(1-5)', String(e.sev)],
      ];
      info.innerHTML = `
        <div class="p2-title">${esc(e.zh)} ${tierBadge(e.tier)}</div>
        <div class="p2-id">${esc(e.id)}${e.kind === 'prion' ? '' : ` · μ≈${e.mu.toExponential(0)} · r≈${e.rHost}/天`}</div>
        ${rows.map(([k, v]) => `<div class="p2-field"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}`;
    }
    renderRxSelect();
    drawCharts();
    renderStrip();
    if (typeof PathoUI !== 'undefined' && PathoUI.renderMolSamples) PathoUI.renderMolSamples();
    // 患者页联动: #/pathogen?entry=X 带参进入时预选目标病原体。
    // 一次性守卫: render 每帧都可能回来, 无守卫的 log() 会在这里引爆渲染
    // 风暴(log → render → log)。
    try {
      const q = location.hash.match(/#\/pathogen\?entry=([A-Za-z0-9_]+)/);
      if (q && !P2.deepLinked) {
        P2.deepLinked = true;                 // 先立旗再做事
        if (window.PathoCatalog && window.PathoUI && window.PathoCatalog.get(q[1])) {
          window.PathoUI.pick(q[1]);
          log(`🧭 由患者页带入: <b>${esc(q[1])}</b> —— 沙盒是独立教学环境, 与原病人无连续性(机制/用药/疫苗实验在此做)。`);
        }
      }
    } catch (e) { /* 带参失效不阻断 */ }
    const ta = document.getElementById('p2TrialProto');
    if (ta && !ta.value && window.PathoTrial) {
      const ex = JSON.parse(JSON.stringify(window.PathoTrial.DEFAULT_EXAMPLE));
      ex.pathogen = P2.sel;
      ta.value = JSON.stringify(ex, null, 2);
    }
  }

  function renderRxSelect() {
    const sel = document.getElementById('p2Rx');
    const e = cur();
    if (!sel || !e || !host()) return;
    const cls = e.rxCls().filter(k => host().DRUGS[k]);
    sel.innerHTML = cls.length
      ? cls.map(k => `<option value="${k}">${esc(host().DRUGS[k].zh)}（${k}）</option>`).join('')
      : '<option value="">（目录无治疗类）</option>';
    const mg = document.getElementById('p2Mg');
    if (cls.length && mg) mg.value = RX_MG[cls[0]] || 500;
  }

  function renderStrip() {
    const strip = document.getElementById('p2Strip');
    const H = host();
    const s = H && H.state();
    if (!strip) return;
    if (!s) { strip.innerHTML = '<span class="muted">尚未载入 —— 选择病原体后点「接种」。</span>'; return; }
    const L = Math.log10(Math.max(1e-2, H.load()));
    strip.innerHTML = [
      `⏱ ${s.t.toFixed(1)}d`,
      `载量 10^${L.toFixed(1)}`,
      `峰值 10^${Math.log10(Math.max(1e-2, s.peak)).toFixed(1)}`,
      `体温 ${s.host.temp.toFixed(1)}°C`,
      `传染指数 ${s.samples.length ? s.samples[s.samples.length - 1].inf.toFixed(2) : '0'}`,
      s.isVirus ? `IFN ${s.imm.ifn.toFixed(1)} · CD8 ${s.imm.cd8.toFixed(2)} · Ab ${s.imm.ab.toFixed(2)}` : `耐药占比 ${s.N + s.Nr > 1 ? (s.Nr / (s.N + s.Nr) * 100).toFixed(2) + '%' : '0%'}`,
      s.host.severe ? '<b class="p2-warn">⚠ 严重进程</b>' : '',
      s.host.clearedAt > 0 ? `<b class="p2-ok">✔ 已清除(第 ${s.host.clearedAt.toFixed(0)} 天)</b>` : '',
      s.entry.tier === 'C' ? '<span class="p2-warn">tier C 目录级仿真</span>' : '',
    ].filter(Boolean).map(x => `<span>${x}</span>`).join(' ');
  }

  // ---------------- 四联图(canvas, 无依赖) ----------------
  function lane(title, draw) {
    const box = document.getElementById('p2Charts');
    if (!box) return null;
    let cv = box.querySelector(`canvas[data-lane="${title}"]`);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.dataset.lane = title;
      box.appendChild(cv);
    }
    const w = Math.max(240, box.clientWidth - 2), h = 108, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '10px ui-monospace, monospace';
  g.fillStyle = '#8a90a2';
    g.fillText(title, 6, 11);
    draw(g, w, h);
    return cv;
  }
  const X = (samples, w) => t => {
    const tMax = Math.max(1, samples.length ? samples[samples.length - 1].t : 1);
    return 40 + (t / tMax) * (w - 48);
  };
  function poly(g, samples, y, x0) {
    g.beginPath();
    let started = false;
    for (const p of samples) {
      const px = x0(p.t), py = y(p);
      if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
    }
    g.stroke();
  }
  function drawCharts() {
    const H = host();
    const box = document.getElementById('p2Charts');
    if (!box || !H) return;
    const s = H.state();
    if (!s) return;
    const sm = s.samples;
    if (!sm.length) return;
    const x0 = X(sm, Math.max(240, box.clientWidth - 2));

    // 1 载量 log10
    lane('载量 log10 (LoD=2)', (g, w, h) => {
      g.strokeStyle = '#d8dce8'; g.beginPath(); g.moveTo(40, h - 18); g.lineTo(w - 8, h - 18); g.stroke();
      g.fillStyle = '#9aa0b2'; g.fillText('0', 30, h - 15); g.fillText('9', 30, 16);
      g.strokeStyle = '#e2a049'; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(40, 16 + (1 - 2 / 9) * (h - 34)); g.lineTo(w - 8, 16 + (1 - 2 / 9) * (h - 34)); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#b78a3c'; g.fillText('LoD', 44, 16 + (1 - 2 / 9) * (h - 34) - 2);
      g.strokeStyle = '#d5484f';
      poly(g, sm, p => 16 + (1 - Math.max(0, Math.min(9, p.logL)) / 9) * (h - 34), x0);
    });
    // 2 免疫效应
    lane('免疫效应 IFN/CD8/Ab (0-1)', (g, w, h) => {
      g.strokeStyle = '#d8dce8'; g.beginPath(); g.moveTo(40, h - 18); g.lineTo(w - 8, h - 18); g.stroke();
      const mk = (key, col) => { g.strokeStyle = col; poly(g, sm, p => 16 + (1 - Math.min(1.2, p[key] / 1) / 1.2) * (h - 34), x0); };
      mk('ifn', '#e2a049'); mk('cd8', '#4f7fd5'); mk('ab', '#37a06a');
      g.fillStyle = '#9aa0b2'; g.fillText('IFN', 44, 22); g.fillStyle = '#4f7fd5'; g.fillText('CD8', 74, 22); g.fillStyle = '#37a06a'; g.fillText('Ab', 102, 22);
    });
    // 3 血药浓度 vs MIC
    lane('血药浓度 mg/L vs MIC', (g, w, h) => {
      const clss = [...new Set(s.drugs.map(d => d.cls))];
      g.strokeStyle = '#d8dce8'; g.beginPath(); g.moveTo(40, h - 18); g.lineTo(w - 8, h - 18); g.stroke();
      if (!clss.length) { g.fillStyle = '#a6abb8'; g.fillText('（未给药）', 46, 30); return; }
      const cMax = Math.max(1, ...sm.flatMap(p => Object.values(p.conc || {})), ...s.drugs.map(d => d.micRes * 1.2));
      const yC = v => 16 + (1 - Math.min(v, cMax) / (cMax * 1.15)) * (h - 34);
      const PAL = ['#4f7fd5', '#8a5fd5', '#d5484f', '#37a06a'];
      clss.forEach((k, i) => {
        g.strokeStyle = PAL[i % PAL.length];
        poly(g, sm, p => yC((p.conc || {})[k] || 0), x0);
        const d = s.drugs.find(dd => dd.cls === k);
        g.setLineDash([3, 3]); g.strokeStyle = '#b78a3c';
        g.beginPath(); g.moveTo(40, yC(d.micWt)); g.lineTo(w - 8, yC(d.micWt)); g.stroke();
        g.setLineDash([]);
        g.fillStyle = PAL[i % PAL.length];
        g.fillText(`${k} MIC ${d.micWt}`, 44 + i * 74, h - 22);
      });
    });
    // 4 耐药占比(负荷分支) / 变异池提示(病毒分支)
    lane(s.isVirus ? '变异池(分子层 P2 提供)' : '耐药亚群占比', (g, w, h) => {
      if (s.isVirus) { g.fillStyle = '#a6abb8'; g.fillText('病毒耐药以"变异检出"形式由测序层给出(下一阶段)', 46, 30); return; }
      g.strokeStyle = '#d8dce8'; g.beginPath(); g.moveTo(40, h - 18); g.lineTo(w - 8, h - 18); g.stroke();
      g.strokeStyle = '#8a5fd5';
      g.beginPath();
      let prev = null;
      for (const p of sm) {
        const px = x0(p.t), py = 16 + (1 - Math.min(1, p.rfrac)) * (h - 34);
        if (prev) g.lineTo(px, py); else g.moveTo(px, py);
        prev = p;
      }
      if (prev) {
        g.lineTo(x0(sm[sm.length - 1].t), h - 18);
        g.lineTo(x0(sm[0].t), h - 18);
        g.closePath();
        g.fillStyle = 'rgba(138, 95, 213, 0.18)'; g.fill();
      }
      g.stroke();
      g.fillStyle = '#9aa0b2'; g.fillText('1%', 30, 22);
    });
  }

  // ---------------- 群体流行曲线(单 lane canvas) ----------------
  function drawPopChart() {
    const box = document.getElementById('p2PopChart');
    const P = window.PathoPop;
    if (!box || !P || !P.state()) { return; }
    const sm = P.state().sample;
    if (!sm || sm.length < 2) return;
    let cv = box.querySelector('canvas');
    if (!cv) { cv = document.createElement('canvas'); box.appendChild(cv); }
    const w = Math.max(280, box.clientWidth - 2), h = 150, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '10px ui-monospace, monospace';
    g.fillStyle = '#8a90a2';
    g.fillText('群体流行曲线: 活跃感染(红) · 累计死亡(灰) · 变异株占比(紫×100)', 6, 11);
    const tMax = sm[sm.length - 1].t || 1;
    const imax = Math.max(1, ...sm.map(p => p.I));
    const dmax = Math.max(1, ...sm.map(p => p.D));
    const x0 = v => 40 + v / tMax * (w - 48);
    g.strokeStyle = '#d8dce8'; g.beginPath(); g.moveTo(40, h - 18); g.lineTo(w - 8, h - 18); g.stroke();
    g.strokeStyle = '#d5484f';
    g.beginPath();
    sm.forEach((p2, i) => { const y = 16 + (1 - p2.I / imax) * (h - 36); i ? g.lineTo(x0(p2.t), y) : g.moveTo(x0(p2.t), y); });
    g.stroke();
    g.strokeStyle = '#9aa0b2';
    g.beginPath();
    sm.forEach((p2, i) => { const y = 16 + (1 - p2.D / dmax) * (h - 36); i ? g.lineTo(x0(p2.t), y) : g.moveTo(x0(p2.t), y); });
    g.stroke();
    g.strokeStyle = '#8a5fd5';
    g.beginPath();
    sm.forEach((p2, i) => { const y = 16 + (1 - Math.min(1, p2.fv)) * (h - 36); i ? g.lineTo(x0(p2.t), y) : g.moveTo(x0(p2.t), y); });
    g.stroke();
    g.fillStyle = '#9aa0b2'; g.fillText('t=0', 40, h - 6); g.fillText('t=' + tMax, w - 46, h - 6);
  }

  // ---------------- 智能体工具执行器(环境桥 EXEC) ----------------
  const WIRE = {
    pop: '群体层(P3 接线中): 元种群 SEIR/变异株/干预/疫苗接种/监测/溢出预警。',
    trial: '试验台(P4 接线中): 协议定义/多臂重复运行/A-B 对比/真值评分/导出。',
  };
  const EXEC = {
    pathogen_catalog(args) {
      const C = window.PathoCatalog;
      const list = C.search(args.query || '', args.kind || 'any').slice(0, Number(args.limit) || 40);
      const lines = [`# 病原体目录: ${list.length} 条(共 ${C.all().length})`];
      for (const e of list) {
        lines.push(`· ${e.id} ${e.zh} [${KIND_ZH[e.kind]} tier ${e.tier}] 基因组${e.genomeType} 潜伏${fmtDays(e)}d${e.r0 ? ` R0 ${e.r0.lo}-${e.r0.hi}` : ''}${e.vaccine ? ' 疫苗✓' : ''}`);
      }
      lines.push('注: tier A 精调 / B 原型校准 / C 目录级; 动力学继承原型, 字段为教科书量级。');
      return { ok: true, text: lines.join('\n') };
    },
    pathogen_setup(args) {
      const id = String(args.pathogen || '');
      const e = window.PathoCatalog.get(id);
      if (!e) return { ok: false, text: `目录中没有 ${id} —— 先用 pathogen_catalog 查。` };
      const st = host().setup(id, { immunity: args.immunity, seed: args.seed });
      P2.sel = id;
      log(`⚙ 场景就绪: <b>${e.zh}</b>（tier ${e.tier}）${args.immunity ? ' · 免疫背景 ' + args.immunity : ''}`);
      render(); drawCharts();
      return { ok: true, text: [`# 场景已载入: ${e.zh}（${id}, tier ${e.tier}）原型 ${e.arch} ${e.genomeType}`,
        `免疫背景: ${args.immunity || 'naive（无既往）'} · 时间归零`,
        `可用治疗类: ${e.rxCls().length ? e.rxZh(e.rxCls()).join('、') : '支持治疗为主'}`,
        `下一步: pathogen_inoculate 接种 → pathogen_advance 推进 → pathogen_host_observe 观测。`].join('\n') };
    },
    pathogen_inoculate(args) {
      if (!host().state()) EXEC.pathogen_setup({ pathogen: P2.sel });
      const dose = Number(args.log10_dose);
      const s = host().inoculate(Number.isFinite(dose) ? dose : 3);
      const e = window.PathoCatalog.get(s.entry.id);
      log(`🦠 接种 <b>${e.zh}</b> 10^${dose} 等效单位`);
      drawCharts();
      return { ok: true, text: `已接种 ${e.zh}：初始载量 10^${dose} 等效单位（≈ ${Math.pow(10, dose).toExponential(1)} 等效单位）。宿主内动力学与免疫计时开始。` };
    },
    pathogen_dose(args) {
      const s = host().state();
      if (!s) return { ok: false, text: '尚未设置场景: 先 pathogen_setup。' };
      const d = host().dose(args.drug, args.mg, args.interval_h, args.days);
      if (d.error) return { ok: false, text: d.error };
      log(`💊 给药 <b>${d.drug.zh}</b> ${d.mg}mg q${d.intervalH}h ×${(d.end - s.t).toFixed(1)}d（MIC ${d.micWt} / 耐药 ${d.fold}×）`);
      drawCharts();
      return { ok: true, text: `已给药 ${d.drug.zh}(${d.cls}) ${d.mg}mg, 间隔 ${d.intervalH}h, 疗程 ${(d.end - s.t).toFixed(2)}天。本品针对该株 MIC≈${d.micWt} mg/L；目录耐药株 fold ${d.fold}×（是否已存在要看耐药占比/测序）。` };
    },
    pathogen_host_vaccinate(args) {
      const out = window.PathoHost.vaccinate(args || {});
      if (out && out.ok) log(`💉 <b>${esc(out.s.entry.zh)} 疫苗接种</b>: 有效保护力 ${((out.s.imm.vaxEff) * 100).toFixed(0)}% —— ${args && args.escape_sites ? `${args.escape_sites} 个逃逸位点已折扣` : '无逃逸位点折扣'}`);
      return out;
    },
    pathogen_pop_serology(args) {
      const out = window.PathoPop.serology(args || {});
      if (out && out.ok) log(`🩸 血清学调查完成(每地区 ${args && args.sample_per_region ? args.sample_per_region : 500} 份) —— 带噪观测详见输出面板`);
      return out;
    },
    pathogen_host_immune(args) {
      const s = host().state();
      if (!s) return { ok: false, text: '尚未设置场景: 先 pathogen_setup。' };
      host().setImmune(args);
      renderStrip();
      return { ok: true, text: `宿主免疫状态已调整: ${Object.entries(args).map(([k, v]) => k + '=' + v).join(', ')}。观测(pathogen_host_observe)确认后继续。` };
    },
    pathogen_host_observe(args) { return { ok: true, text: host().observe(args && args.series) }; },
    pathogen_advance(args) {
      const s = host().state();
      if (!s) return { ok: false, text: '尚未设置场景: 先 pathogen_setup。' };
      const before = host().load();
      const days = Number(args.days) || 1;
      host().advance(days);
      // 单轴语义: 推进时间 = 推进所有已初始化的层(宿主内 + 群体), 面板与工具一致
      if (window.PathoPop && window.PathoPop.state()) { const o = window.PathoPop.advance(days); if (o.ok) log('🌍 群体同步推进: ' + esc(o.text.split('\n')[0].slice(0, 100))); }
      renderStrip(); drawCharts(); drawPopChart();
      const L = host().load();
      return { ok: true, text: `已推进 ${days} 天 → t=${s.t.toFixed(2)}d。载量 ${before >= 1 ? before.toExponential(1) : before.toFixed(2)} → ${L >= 1 ? L.toExponential(1) : L.toFixed(2)}（比值 ${(L / Math.max(1e-9, before)).toFixed(2)}×）。` + (s.host.clearedAt > 0 ? ` 病原已被清除(第 ${s.host.clearedAt.toFixed(1)} 天)。` : '') };
    },
    pathogen_diagnose(args) {
      const out = window.PathoDiag.run(args.assay, args);
      log(`🧪 ${args.assay || 'pcr'} → ${esc(String(out.text).split('\n')[1] || '').slice(0, 90)}`);
      const box = document.getElementById('p2DiagOut');
      if (box) box.innerHTML = rich(out.text).replace(/\n/g, '<br>');
      return out;
    },
    pathogen_log(args) {
      const box = document.getElementById('p2Log');
      if (!box) return { ok: true, text: '（无事件记录）' };
      const rows = [...box.children].slice(0, Number(args.limit) || 20).map(r => r.textContent.trim());
      rows.reverse();
      return { ok: true, text: rows.join('\n') || '（空）' };
    },
    pathogen_reset() {
      host().setup(P2.sel, { immunity: undefined });
      log('↺ 已复位到场景初始');
      renderStrip(); drawCharts();
      return { ok: true, text: '已复位: 载量清零、免疫状态与计时归零（目录选择保留）。' };
    },
    // ---- 分子/基因组层 + 病原识别(diag 组) ----
    pathogen_sequence(args) {
      const out = window.PathoMol.sequence(args || {});
      if (out.ok) { drawCharts(); PathoUI.refreshMol(); }
      return out;
    },
    pathogen_identify(args) { return window.PathoMol.identify(args || {}); },
    pathogen_genome() {
      const s = host() && host().state();
      if (!s) return { ok: false, text: '尚未设置场景: 先 pathogen_setup。' };
      const loci = s.mol ? s.mol.loci : window.PathoMol.lociFor(s.entry);
      const lines = [`# 基因组图式 · ${s.entry.zh}（${s.entry.id}）· ${s.entry.genomeType} · tier ${s.entry.tier}`];
      lines.push(`基因座 ${loci.length} 个(图式代表, 基因组 ${s.entry.genomeType}):`);
      for (const l of loci) lines.push(`· ${l.name}  len≈${l.len}bp${l.epi ? ' · 表位区 ' + l.epi : ''}`);
      lines.push(`注: 序列由 (${s.entry.id}, 基因) 哈希确定性生成, 不落库; 真值 = 谱系变异 + 耐药决定簇, 只能经测序读数看到。`);
      return { ok: true, text: lines.join('\n') };
    },
    pathogen_variants(args) { return window.PathoMol.variants(args || {}); },
    pathogen_resistance(args) { return window.PathoMol.resistance(args || {}); },
    pathogen_escape(args) { return window.PathoPredict.escape(args || {}); },
    pathogen_forecast(args) { return window.PathoPredict.forecast(args || {}); },
    pathogen_drug_match(args) { return window.PathoPredict.drug_match(args || {}); },
    pathogen_vaccine_design(args) { return window.PathoPredict.vaccine_design(args || {}); },
    pathogen_phylo(args) { return window.PathoPredict.phylo(args || {}); },
    pathogen_trace(args) { return window.PathoPredict.trace(args || {}); },
    // ---- 群体层 ----
    pathogen_pop_init(args) {
      const out = window.PathoPop.init(args || {});
      if (out.ok) { log(`🌍 群体模型就绪: ${out.text.split('\n')[0].replace(/^# /, '')}`); drawPopChart(); }
      return out;
    },
    pathogen_intervene(args) {
      const out = window.PathoPop.intervene(args || {});
      if (out.ok) log(`🏛 干预排程: ${esc(out.text.split('\n')[0])}`);
      return out;
    },
    pathogen_vaccinate(args) {
      const out = window.PathoPop.vaccinate(args || {});
      if (out.ok) log(`💉 疫苗计划: 覆盖 ${(args.coverage * 100).toFixed(0)}% × 保护力 ${(args.efficacy * 100 || 85).toFixed(0)}%`);
      return out;
    },
    pathogen_surveillance(args) {
      const out = window.PathoPop.surveillance(args || {});
      if (out.ok) log(`📡 监测报告(t=${(window.PathoPop.state() || {}).t?.toFixed(0) || '?'}d)已生成`);
      return out;
    },
    pathogen_spillover(args) {
      const out = window.PathoPop.spillover(args || {});
      if (out.ok) log(`🦠 溢出预警${args && args.what_if ? '(what-if)' : ''}: watchlist 已生成`);
      return out;
    },
    pathogen_pop_observe(args) {
      const out = window.PathoPop.observe(args || {});
      if (out.ok) drawPopChart();
      return out;
    },
    pathogen_trial_define(args) {
      const out = window.PathoTrial.define(args || {});
      if (out.ok) log(`🧪 协议已定义: ${esc(out.protocol.name)}(${out.protocol.arms.length} 臂 × ${out.protocol.replicates} 重复 × ${out.protocol.days} 天)`);
      return out;
    },
    pathogen_trial_run(args) {
      const out = window.PathoTrial.run(args || {});
      if (out.ok) log(`🧪 试验完成${args && args.reveal_truth ? '(真值已揭示)' : ''} —— 每臂指标分布与控制评分见试验台输出`);
      return out;
    },
    pathogen_trial_compare(args) { return window.PathoTrial.compare(args || {}); },
    pathogen_trial_export(args) {
      const out = window.PathoTrial.export(args || {});
      if (out.ok) log(`📤 试验数据已导出(${(args && args.format) || 'csv'})`);
      return out;
    },
  };

  // ---------------- 环境桥(页面 = 环境宿主) ----------------
  const Bridge = { sessionId: '', stopped: false };
  async function bridgeStart() {
    if (!CS.api) return;
    Bridge.stopped = false;
    try {
      const r = await fetch(CS.api.url('/pathenv/session'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: '' }),
      });
      const d = await r.json();
      Bridge.sessionId = d.sessionId || '';
      if (Bridge.sessionId) { bridgeLoop(); markBridge(true); }
    } catch (e) { setTimeout(bridgeStart, 4000); }
  }
  async function bridgeLoop() {
    while (!Bridge.stopped && Bridge.sessionId && document.getElementById('pathogen-root')) {
      try {
        const r = await fetch(CS.api.url(`/pathenv/poll?sessionId=${encodeURIComponent(Bridge.sessionId)}&wait=20`), { credentials: 'include' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (data && data.call) await bridgeCall(data.call);
      } catch (err) {
        if (Bridge.stopped) return;
        markBridge(false);
        await new Promise(res => setTimeout(res, 3000));
      }
    }
    markBridge(false);
  }
  async function bridgeCall(call) {
    const fn = EXEC[call.tool];
    let out;
    if (!fn) out = { ok: false, text: `未知工具 ${call.tool}` };
    else {
      try { out = fn(call.args || {}) || { ok: true, text: '' }; }
      catch (err) { out = { ok: false, text: '执行异常: ' + (err && err.message ? err.message : err) }; }
    }
    log(`🤖 <b>${esc(call.tool.replace(/^pathogen_/, ''))}</b> ${esc(String(out.text || '').split('\n')[0] || '').slice(0, 110)}`, out.ok ? '' : 'crit');
    markBridge(true);
    try {
      await fetch(CS.api.url('/pathenv/result'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: Bridge.sessionId, id: call.id, ok: !!out.ok, text: String(out.text || '') }),
      });
    } catch (e) { /* 回传失败: 服务端 120s 超时兜底 */ }
  }
  function markBridge(ok) {
    const dot = document.getElementById('p2BridgeDot');
    if (dot) dot.classList.toggle('on', !!ok);
  }
  window.__PathoBridge = Bridge;

  // ---------------- UI 动作 ----------------
  window.PathoUI = Object.assign(window.PathoUI || {}, {
    pick(id) {
      const e = window.PathoCatalog.get(id);
      if (!e) return;
      P2.sel = id;
      if (host() && host().state()) host().setup(id, {});
      log(`🦠 选定 <b>${e.zh}</b>（${e.id}, tier ${e.tier}）—— 原型 ${e.arch}`);
      render();
    },
    setKind(k) { P2.kind = k; render(); },
    setScale(s) {
      P2.scale = s;
      for (const b of document.querySelectorAll('.p2-scale')) b.classList.toggle('on', b.dataset.s === s);
      for (const pane of document.querySelectorAll('.p2-pane')) pane.hidden = pane.dataset.pane !== s;
      if (s === 'host') drawCharts();
    },
    search(v) { P2.q = v; render(); },
    inoculate() {
      if (!host().state()) host().setup(P2.sel, {});
      const v = Number(document.getElementById('p2Dose').value) || 3;
      const s = host().inoculate(v);
      const e = window.PathoCatalog.get(s.entry.id);
      log(`🦠 接种 <b>${e.zh}</b> 10^${v} 等效单位（原型 ${e.arch}, tier ${e.tier}）`);
      renderStrip(); drawCharts();
    },
    dose() {
      const k = document.getElementById('p2Rx').value;
      if (!host().state() || !k) { log('需要先选定病原体（含治疗类的）—— 预防性给药也要有场景。', 'crit'); return; }
      const mg = Number(document.getElementById('p2Mg').value) || 500;
      const iv = Number(document.getElementById('p2Iv').value) || 0;
      const days = Number(document.getElementById('p2Days').value) || 1;
      const d = host().dose(k, mg, iv, days);
      if (d.error) { log('给药失败: ' + esc(d.error), 'crit'); return; }
      log(`💊 给药 <b>${d.drug.zh}</b> ${mg}mg q${iv}h ×${days}d（本株 MIC ${d.micWt} mg/L, 耐药 fold ${d.fold}×）`);
      renderStrip(); drawCharts();
    },
    advance() {
      const days = Number(document.getElementById('p2Adv').value) || 1;
      const s = host().state();
      if (!s) { log('尚未载入: 先选病原体 → 接种。', 'crit'); return; }
      host().advance(days);
      log(`⏩ 推进 ${days} 天 → t=${s.t.toFixed(1)}d${s.host.clearedAt > 0 ? ' · 已清除' : ''}`);
      // 群体模型与宿主内同轴: 推进时间也推动流行(若已初始化)
      if (window.PathoPop && window.PathoPop.state()) { const o = window.PathoPop.advance(days); if (o.ok) log('🌍 群体 同步推进: ' + esc(o.text.split('\n')[0].slice(0, 90))); }
      renderStrip(); drawCharts(); drawPopChart();
    },
    play() {
      const btn = document.getElementById('p2Play');
      if (P2.timer) { clearInterval(P2.timer); P2.timer = 0; btn.textContent = '▶ 播放'; return; }
      btn.textContent = '⏸ 暂停';
      P2.timer = setInterval(() => {
        const s = host() && host().state();
        if (!s || s.t >= host().HORIZON || s.host.extinguished) { clearInterval(P2.timer); P2.timer = 0; document.getElementById('p2Play').textContent = '▶ 播放'; return; }
        host().advance(0.25);
        renderStrip(); drawCharts();
      }, 400);
    },
    reset() {
      host().setup(P2.sel, {});
      log('↺ 复位: 载量/免疫/计时归零');
      renderStrip(); drawCharts();
    },
    diag(assay) {
      const out = window.PathoDiag.run(assay, {});
      log(`🧪 ${assay} → ${esc(String(out.text).split('\n')[1] || '').slice(0, 90)}`);
      const box = document.getElementById('p2DiagOut');
      if (box) box.innerHTML = rich(out.text).replace(/\n/g, '<br>');
      renderStrip();
    },
    currentSel() { return P2.sel; },
    molRun(tool, args) {
      // 分子面板按钮与 MCP 工具同一条通道: EXEC[pathogen_<tool>]
      const fn = window.PathoMol && EXEC['pathogen_' + tool];
      if (!fn) { log('分子工具未就绪。', 'crit'); return; }
      const out = fn(args || {});
      const box = document.getElementById('p2MolOut');
      if (box) box.innerHTML = rich(out.text || '').replace(/\n/g, '<br>');
      log(`🧬 ${tool} → ${esc(String(out.text || '').split('\n')[1] || out.text || '').slice(0, 90)}`);
    },
    refreshMol() { PathoUI.renderMolSamples(); },
    open3D() {
      const id = (window.PathoHost && PathoHost.state() && PathoHost.state().entry.id) || P2.sel;
      window.Patho3D.open(id);
    },
    vaccinateUI() {
      const raw = window.prompt('疫苗接种参数 JSON:\n{coverage: 0-1 设计覆盖率, escape_sites: 逃逸位点数}', '{"coverage": 0.9, "escape_sites": 0}');
      if (!raw) return;
      let o;
      try { o = JSON.parse(raw); } catch (e) { log('疫苗参数 JSON 解析失败: ' + esc(e.message), 'crit'); return; }
      EXEC.pathogen_host_vaccinate(o);
      renderStrip(); drawCharts();
    },
    trialRun(mode) {
      const T = window.PathoTrial;
      if (!T) { log('试验台未就绪。', 'crit'); return; }
      const box = document.getElementById('p2TrialOut');
      let proto;
      try { proto = JSON.parse(document.getElementById('p2TrialProto').value); } catch (e) { log('协议 JSON 解析失败: ' + esc(e.message), 'crit'); return; }
      if (!proto.pathogen) proto.pathogen = P2.sel;
      const d = T.define(proto);
      if (!d.ok) { if (box) box.textContent = d.text; return; }
      const out = T.run({ reveal_truth: mode === 'reveal' });
      if (box) box.innerHTML = rich(out.text || '').replace(/\n/g, '<br>');
      log(`🧪 试验完成: ${esc(proto.name)}(${mode === 'reveal' ? '含真值' : '真值隐藏'})`);
    },
    trialCompare() {
      const T = window.PathoTrial;
      const R = T && T.lastRun;
      if (!R) { log('先运行一次试验再对比。', 'crit'); return; }
      const out = T.compare({ arm_a: R.arms[0].label, arm_b: R.arms[R.arms.length - 1].label });
      const box = document.getElementById('p2TrialOut');
      if (box) box.innerHTML = rich(out.text || '').replace(/\n/g, '<br>');
    },
    trialExport(fmt) {
      const T = window.PathoTrial;
      const out = T.export({ format: fmt });
      const box = document.getElementById('p2TrialOut');
      if (box) box.textContent = out.text || out;
      log(`📤 导出 ${fmt.toUpperCase()}(${String(out.text || '').length} 字符)`);
    },
    popRun(tool, args) {
      const out = window.PathoPop[tool] ? window.PathoPop[tool](args || {}) : { ok: false, text: '未知' + tool };
      const box = document.getElementById('p2PopOut');
      if (box) box.innerHTML = rich(out.text || '').replace(/\n/g, '<br>');
      log(`🌍 ${tool} → ${esc(String(out.text || '').split('\n')[1] || out.text || '').slice(0, 90)}`);
      drawPopChart();
      renderStrip();
    },
    renderMolSamples() {
      const box = document.getElementById('p2MolSamples');
      if (!box) return;
      const s = host() && host().state();
      const list = s && s.mol ? s.mol.samples : [];
      box.innerHTML = list.length
        ? list.map(x => `<button type="button" class="p2-chip" onclick="PathoUI.molSelected='${esc(x.id)}';PathoUI.molRun('variants',{sample:'${esc(x.id)}'})">${esc(x.id)} <i>${Math.round(x.t)}d · ${x.depth}×</i></button>`).join('')
        : '<span class="muted small">尚无样本: 点击「测序」生成。</span>';
    },
    molSelected: '',
  });

  // ---------------- 挂载 ----------------
  window.mountPathogenPage = function () {
    const root = document.getElementById('pathogen-root');
    if (!root) return;
    if (!window.PathoCatalog || !window.PathoHost || !window.PathoDiag || !window.PathoMol || !window.PathoPredict) {
      CS.ensureLazy('catalog', 'host', 'diag', 'genome', 'predict', 'pop', 'trial', 'patho3d').then(() => {
        if (window.PathoCatalog) window.mountPathogenPage();
      });
      return;
    }
    if (!root.dataset.mounted) {
      root.dataset.mounted = '1';
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
      const C = window.PathoCatalog;
      log(`<b>虚拟病原体环境就绪</b> —— 目录 ${C.all().length} 条 / 原型 ${Object.keys(C.arch).length} 组; 本环境为教学沙盒: 参数为教科书量级, 只做机制与相对比较。`);
      if (!Bridge.sessionId) bridgeStart();
    }
    render();
  };
})();
