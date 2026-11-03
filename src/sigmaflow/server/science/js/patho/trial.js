/* ================= 虚拟病原体 · 试验台(P4) =================
 * 协议(多臂 × 时间表干预) → 每臂 N 次重复 → 指标分布 + bootstrap 区间 →
 * A/B 对比(差值要和噪声比) → 导出。每条重复 = 一个"新个体":
 * 种子抖动接种量/事件时点/耐药倍数 —— 引擎本身确定, 个体差异进场的唯一
 * 通道是这里(否则同臂方差为 0, 任何对比都是自欺)。
 *
 * 真值注册表: 每条重复记录 resFold / MIC / 行程终点等真值, 默认隐藏,
 * reveal_truth=true 才随报告输出 —— "评估模式"的意义就在这。
 *
 * 快照-恢复: 引擎模块是单实例, 试验在后台整体换装 PathoHost/PathoPop 状态,
 * 结束后原样归还; 页面正在看的场景与曲线不受试验污染。
 */
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const FOLD_POOL = [4, 8, 16, 32];

  function hash32(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  const KEY_METRICS = ['peak_load', 'auc', 'time_to_clearance', 'resistance_emergence', 'severe_outcomes', 'cost'];
  const DEFAULT_EXAMPLE = {
    name: '剂量-反应对照(E_coli × β-内酰胺)',
    arms: [
      { label: '足量', interventions: [{ t: 0, log10_dose: 5 }, { t: 0.5, drug: 'bl', mg: 800, interval_h: 12, days: 10 }] },
      { label: '欠量', interventions: [{ t: 0, log10_dose: 5 }, { t: 0.5, drug: 'bl', mg: 250, interval_h: 12, days: 10 }] },
      { label: '对照', interventions: [{ t: 0, log10_dose: 5 }] },
    ],
    replicates: 5,
    days: 30,
    metrics: ['time_to_clearance', 'peak_load', 'resistance_emergence'],
  };

  const T = {
    protocol: null,
    lastRun: null,

    /** 校验并固化协议; 返回文本回执(不执行)。 */
    define(args) {
      args = args || {};
      const p = {
        name: String(args.name || '').slice(0, 80) || ('协议 ' + new Date().toISOString().slice(11, 19)),
        pathogen: String(args.pathogen || ''),
        arms: [],
        replicates: clamp(Math.round(Number(args.replicates) || 3), 1, 200),
        days: clamp(Number(args.days) || 30, 2, 360),
        metrics: (Array.isArray(args.metrics) ? args.metrics : ['time_to_clearance', 'peak_load', 'resistance_emergence'])
          .filter(m => KEY_METRICS.includes(m)),
        baseSeed: clamp(Math.round(Number(args.baseSeed) || 20240601), 1, 2 ** 31 - 1),
      };
      const rawArms = Array.isArray(args.arms) ? args.arms : [];
      if (!rawArms.length) return { ok: false, text: '协议需要至少一个臂(arm): 每臂给 label 与时间表 interventions。示例:\n' + JSON.stringify(DEFAULT_EXAMPLE, null, 2).slice(0, 600) };
      const lines = [`# 协议已定义: ${p.name}`, `臂 ${rawArms.length} × 每臂重复 ${p.replicates} × ${p.days} 天 · 种子基 ${p.baseSeed}`];
      for (const a of rawArms.slice(0, 8)) {
        const arm = {
          label: String(a.label || ('臂' + (p.arms.length + 1))).slice(0, 30),
          pop: a.pop && typeof a.pop === 'object' ? { population: a.pop.population, regions: a.pop.regions, initial_cases: a.pop.initial_cases, mobility: a.pop.mobility } : null,
          events: [],
        };
        const ivs = Array.isArray(a.interventions) ? a.interventions : [];
        for (const ev of ivs.slice(0, 40)) {
          const t = clamp(Number(ev.t) || 0, 0, p.days);
          if (ev.drug) arm.events.push({ t, kind: 'dose', drug: String(ev.drug), mg: Number(ev.mg) || 500, interval_h: Number(ev.interval_h) || 12, days: Number(ev.days) || 5 });
          else if (ev.kind) arm.events.push({ t, kind: 'pop_intervene', kind2: String(ev.kind), strength: Number(ev.strength) || 0.5, coverage: Number(ev.coverage) || 0.7, end_day: Number(ev.end_day) || p.days });
          else if (ev.coverage !== undefined) arm.events.push({ t, kind: 'pop_vaccinate', coverage: Number(ev.coverage) || 0.6, efficacy: Number(ev.efficacy) || 0.85 });
          else if (ev.assay) arm.events.push({ t, kind: 'sample', assay: String(ev.assay) });
          else if (ev.log10_dose !== undefined) arm.events.push({ t, kind: 'inoculate', log10_dose: Number(ev.log10_dose) });
          else if (ev.immunity) arm.events.push({ t, kind: 'immunity', immunity: String(ev.immunity) });
          else arm.events.push({ t, kind: 'unknown', raw: ev });
        }
        arm.events.sort((x, y) => x.t - y.t);
        p.arms.push(arm);
        lines.push(`· 臂「${arm.label}」: ${arm.events.map(e => fmtEvent(e)).join(' → ') || '（空臂=对照）'}${arm.pop ? ' + 群体臂(' + arm.pop.population + ')' : ''}`);
      }
      if (!p.metrics.length) p.metrics = ['time_to_clearance', 'peak_load'];
      p.metrics = [...new Set(p.metrics)];
      lines.push(`指标: ${p.metrics.join('、')} · 注: 真值(种子抖动的耐药倍数/终点)默认隐藏, trial_run 需要时用 reveal_truth 揭示。`);
      this.protocol = p;
      this.lastRun = null;
      return { ok: true, text: lines.join('\n'), protocol: p };
    },

    /** 执行: 逐臂逐重复, 快照/恢复全局引擎状态。 */
    run(args) {
      const p = this.protocol;
      if (!p) return { ok: false, text: '先 pathogen_trial_define 定义协议。' };
      const reveal = !!(args && args.reveal_truth);
      const C = G.PathoCatalog, H = G.PathoHost, Pop = G.PathoPop;
      const entry = C.get(p.pathogen) || (G.PathoUI && G.PathoUI.currentSel ? C.get(G.PathoUI.currentSel()) : null) || (H.state() ? H.state().entry : null);
      if (!entry) return { ok: false, text: '没有可用的病原体: protocol.pathogen 或当前页面选择缺失。' };
      const saveHost = H._s, savePop = Pop._s;
      const results = { pathogen: entry.id, baseSeed: p.baseSeed, days: p.days, arms: [], truth: [] };
      let ti = 0;
      try {
        for (const arm of p.arms) {
          const armRes = { label: arm.label, replicates: [] };
          for (let rep = 0; rep < p.replicates; rep++) {
            const seed = (p.baseSeed + rep * 7919 + ti * 104729) >>> 0;
            const r = rng(hash32('trialseed::' + seed));
            // 个体差异: 接种量 ±20%, 事件时点 ±0.4d, 耐药倍数按池抽取
            const doseJit = 0.8 + r() * 0.4;
            const foldRoll = r();                    // 加权: 高倍数(ESBL/CRE)是少数
            const resFold = foldRoll < 0.45 ? 4 : foldRoll < 0.75 ? 8 : foldRoll < 0.92 ? 16 : 32;
            H.setup(entry.id, { seed, resFold });
            if (arm.pop) Pop.init(arm.pop);
            const rec = { arm: arm.label, rep: rep + 1, seed, truth: { resFold, entry: entry.id } };
            let rfracPeak = 0, drAfPeak = 0, cost = 0, events = [];
            let clearedAt = -1;
            for (let d = 0; d <= p.days; d++) {
              // 当日事件(时点抖动后落在这一天的)
              for (const ev of arm.events) {
                const jittered = ev.kind === 'dose' || ev.kind === 'inoculate' ? ev.t + (r() - 0.5) * 0.4 : ev.t;
                if (jittered > d - 1 && jittered <= d + 1e-9) {
                  if (ev.kind === 'dose') {
                    const o = H.dose(ev.drug, ev.mg, ev.interval_h, ev.days);
                    if (!o.error) { const nDoses = ev.interval_h > 0 ? Math.ceil(ev.days * 24 / ev.interval_h) : 1; cost += o.mg * nDoses * 0.01; rec.lastDrug = ev.drug; }
                    events.push(`t${jittered.toFixed(1)}:${ev.kind}:${ev.drug}(${ev.mg}mg)`);
                  }
                  else if (ev.kind === 'inoculate') { H.inoculate(ev.log10_dose * doseJit); events.push(`t${jittered.toFixed(1)}:inoculate:10^${(ev.log10_dose * doseJit).toFixed(1)}`); }
                  else if (ev.kind === 'immunity') { H.setup(entry.id, { immunity: ev.immunity, seed, resFold }); events.push(`t${jittered.toFixed(1)}:immunity:${ev.immunity}`); }
                  else if (ev.kind === 'pop_intervene' && arm.pop) { Pop.intervene({ kind: ev.kind2, strength: ev.strength, coverage: ev.coverage, start_day: jittered, end_day: ev.end_day }); cost += ev.strength * ev.coverage * (ev.end_day - jittered) * 0.5; events.push(`t${jittered.toFixed(1)}:pop:${ev.kind2}`); }
                  else if (ev.kind === 'pop_vaccinate' && arm.pop) { Pop.vaccinate({ coverage: ev.coverage, efficacy: ev.efficacy, start_day: jittered }); cost += ev.coverage * 0.6; events.push(`t${jittered.toFixed(1)}:vax:${ev.coverage}`); }
                  else if (ev.kind === 'sample') { rec.sampled = (rec.sampled || 0) + 1; }
                }
              }
              if (d < p.days) {
                H.advance(1);
                if (arm.pop) Pop.advance(1);
              }
              const st = H.state();
              if (st) {
                const tot = st.N + st.Nr;
                rfracPeak = Math.max(rfracPeak, tot > 1 ? st.Nr / tot : 0);
                for (const k in st.drAf) drAfPeak = Math.max(drAfPeak, st.drAf[k]);
                if (st.host.clearedAt > 0 && clearedAt < 0) clearedAt = st.host.clearedAt;
              }
            }
            const st = H.state();
            const sm = st.samples || [];
            let auc = 0;
            for (const s of sm) auc += Math.max(0, s.logL) * 0.05;
            rec.metrics = {
              peak_load: +Math.log10(Math.max(1e-2, st.peak)).toFixed(3),
              auc: +auc.toFixed(1),
              time_to_clearance: clearedAt > 0 ? +clearedAt.toFixed(2) : p.days + 1,
              resistance_emergence: +(st.isVirus ? Math.max(drAfPeak, 0) : rfracPeak).toFixed(4),
              severe_outcomes: st.host.severe ? 1 : 0,
              cost: +cost.toFixed(1),
            };
            rec.clearedWithoutResistance = clearedAt > 0 && rec.metrics.resistance_emergence < 0.5;
            rec.score_control = rec.clearedWithoutResistance ? 1 - Math.min(0.4, cost / 200) : 0;
            if (arm.pop) {
              const ps = Pop.state();
              if (ps && ps.sample.length) {
                const last = ps.sample[ps.sample.length - 1];
                rec.metrics.pop_peak = +Math.max(...ps.sample.map(x => x.I)).toFixed(0);
                rec.metrics.pop_attack = +(1 - last.Sfrac - (last.Imm || 0)).toFixed(4);
                rec.metrics.pop_deaths = last.D;
                rec.metrics.pop_vshare = +(Math.max(...ps.sample.map(x => x.fv))).toFixed(3);
              }
            }
            rec.events = events;
            armRes.replicates.push(rec);
          }
          results.arms.push(armRes);
          ti++;
        }
      } finally {
        H._s = saveHost;
        Pop._s = savePop;
        // 恢复 UI 引用的活状态(mol 依附于 state 对象, 一并还原)
        if (G.PathoUI && G.PathoUI.renderMolSamples) try { G.PathoUI.renderMolSamples(); } catch (e) { }
      }
      this.lastRun = results;
      return this.report(reveal);
    },

    /** 汇总输出(key 列表 + 每臂均值 ± bootstrap CI + 真值区)。 */
    report(reveal) {
      const R = this.lastRun;
      const p = this.protocol;
      if (!R) return { ok: false, text: '尚无运行结果。' };
      const M = p.metrics;
      const lines = [`# 试验报告: ${p.name} · ${R.pathogen} · ${R.days} 天 · ${p.replicates}×臂`];
      const stats = {};
      for (const arm of R.arms) {
        const n = arm.replicates.length;
        lines.push(`\n## 臂「${arm.label}」(n=${n})`);
        for (const m of M) {
          const xs = arm.replicates.map(x => x.metrics[m]);
          const mean = xs.reduce((a, b) => a + b, 0) / n;
          const ci = bootCI(xs);
          stats[arm.label + '#' + m] = { mean, ci, xs };
          lines.push(`· ${zhMetric(m)}: ${mean.toFixed(mean < 10 ? 3 : 1)} [95%CI ${ci[0].toFixed(2)} ~ ${ci[1].toFixed(2)}]${ci[0] === ci[1] ? '  (重复间无变异)' : ''}`);
        }
        const clearNoR = arm.replicates.filter(x => x.clearedWithoutResistance).length;
        const score = arm.replicates.reduce((a, x) => a + x.score_control, 0) / n;
        lines.push(`· 控制评分: ${clearNoR}/${n} 清除且未富集耐药; 标准分 ${(score * 100).toFixed(0)}(清除为前提, 再扣代价)`);
      }
      if (R.arms.length === 2) lines.push(this.compare({ arm_a: R.arms[0].label, arm_b: R.arms[1].label }).text);
      if (reveal) {
        lines.push('\n## 真值注册表(评估模式)');
        for (const arm of R.arms) {
          lines.push(`「${arm.label}」: ` + arm.replicates.map(x => `#${x.rep}种子${x.seed % 100000}/耐药fold=${x.truth.resFold}${x.truth.resFoldNote || ''}`).join(' · '));
        }
      } else {
        lines.push('\n(真值隐藏中 —— 评估/SSE 模式用 reveal_truth=true 揭示每条重复的种子与耐药倍数)');
      }
      lines.push('\n下一步: pathogen_trial_compare {arm_a, arm_b} 做任意两臂显著性对比; pathogen_trial_export 取 CSV/JSON。');
      return { ok: true, text: lines.join('\n') };
    },

    /** 两臂对比: bootstrap 差值区间 + 结论(差值 vs 噪声)。 */
    compare(args) {
      const R = this.lastRun;
      if (!R) return { ok: false, text: '先 pathogen_trial_run。' };
      const a = String(args.arm_a || (R.arms[0] && R.arms[0].label) || '');
      const b = String(args.arm_b || (R.arms[1] && R.arms[1].label) || '');
      const armA = R.arms.find(x => x.label === a), armB = R.arms.find(x => x.label === b);
      if (!armA || !armB) return { ok: false, text: `臂不存在: ${a}/${b}。已有: ${R.arms.map(x => x.label).join('、')}` };
      const metric = (this.protocol.metrics && this.protocol.metrics[0]) || 'time_to_clearance';
      const xs = armA.replicates.map(x => x.metrics[metric]);
      const ys = armB.replicates.map(x => x.metrics[metric]);
      const diff = xmean(xs) - xmean(ys);
      const boots = [];
      const rr = rng(R.baseSeed || 12345);
      for (let k = 0; k < 1000; k++) {
        boots.push(xmean(resample(xs, rr)) - xmean(resample(ys, rr)));
      }
      boots.sort((x, y) => x - y);
      const lo = boots[Math.floor(boots.length * 0.025)], hi = boots[Math.floor(boots.length * 0.975)];
      const lines = [
        `# A/B 对比 · 指标 ${zhMetric(metric)}`,
        `${a}: n=${xs.length} 均值 ${xmean(xs).toFixed(3)} · ${b}: n=${ys.length} 均值 ${xmean(ys).toFixed(3)}`,
        `差值( ${a} − ${b} ) = ${diff.toFixed(3)} [bootstrap 95%CI ${lo.toFixed(3)} ~ ${hi.toFixed(3)}]`,
        lo > 0 || hi < 0 ? `结论: <b>差异大于噪声(${lo > 0 ? a : b}${lo > 0 ? ' 更高' : ' 更高'})</b> —— 按指标语义判读方向。` : '结论: 差异未超过噪声 —— 增加重复数或拉开干预强度再试。',
      ];
      return { ok: true, text: lines.join('\n') };
    },

    /** 导出: CSV(每重复一行)/ JSON(带协议+种子头部, 可复算)。 */
    export(args) {
      const R = this.lastRun;
      if (!R) return { ok: false, text: '先 pathogen_trial_run。' };
      const fmt = String(args.format || 'csv');
      const metricKeys = collectKeys(R);
      if (fmt === 'json') {
        return { ok: true, text: JSON.stringify({ protocol: { name: this.protocol.name, replicates: this.protocol.replicates, days: this.protocol.days }, scenario: { pathogen: R.pathogen, baseSeed: R.baseSeed }, replicates: R.arms.flatMap(a => a.replicates.map(x => ({ arm: a.label, ...x.metrics, seed: x.seed, score_control: +x.score_control.toFixed(3) }))) }, null, 1) };
      }
      const rows = [['arm', 'rep', 'seed', ...metricKeys, 'cleared_no_res', 'score_control']];
      for (const arm of R.arms) for (const x of arm.replicates) {
        rows.push([arm.label, x.rep, x.seed, ...metricKeys.map(k => x.metrics[k]), x.clearedWithoutResistance ? 1 : 0, +x.score_control.toFixed(3)]);
      }
      return { ok: true, text: rows.map(r => r.join(',')).join('\n') };
    },

    DEFAULT_EXAMPLE,
  };

  function fmtEvent(e) {
    if (e.kind === 'dose') return `t${e.t}:dose ${e.drug} ${e.mg}mg q${e.interval_h}h ×${e.days}d`;
    if (e.kind === 'inoculate') return `t${e.t}:接种10^${e.log10_dose}`;
    if (e.kind === 'pop_intervene') return `t${e.t}:干预 ${e.kind2}`;
    if (e.kind === 'pop_vaccinate') return `t${e.t}:疫苗 ${e.coverage * 100}%`;
    if (e.kind === 'sample') return `t${e.t}:采样(${e.assay})`;
    if (e.kind === 'immunity') return `t${e.t}:免疫=${e.immunity}`;
    return `t${e.t}:?`;
  }
  function zhMetric(m) {
    return { peak_load: '峰值载量(log10)', auc: '载量AUC(log10·天)', time_to_clearance: '清除时间(天)', resistance_emergence: '耐药占比峰值', severe_outcomes: '重症(0/1)' }[m] || m;
  }
  const xmean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  function resample(xs, r) { const out = []; for (let i = 0; i < xs.length; i++) out.push(xs[Math.floor(r() * xs.length)]); return out; }
  function bootCI(xs) {
    if (xs.length < 2) return [xs[0] || 0, xs[0] || 0];
    const rr = rng(xs.length * 7717 + Math.round(xmean(xs) * 100));
    const bs = [];
    for (let k = 0; k < 500; k++) bs.push(xmean(resample(xs, rr)));
    bs.sort((a, b) => a - b);
    return [bs[Math.floor(bs.length * 0.025)], bs[Math.floor(bs.length * 0.975)]];
  }
  function collectKeys(R) {
    const keys = [];
    for (const arm of R.arms) for (const x of arm.replicates) for (const k in x.metrics) if (!keys.includes(k)) keys.push(k);
    return keys;
  }

  G.PathoTrial = T;
})();
