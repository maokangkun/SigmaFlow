/* ================= 虚拟病原体 · 推断与设计层(P2) =================
 * 逃逸评估 / 演化预测 / 基因型药物匹配 / 疫苗设计 / 系统发生 / 宿主溯源。
 * 全部建立在"样本(读数) + 表位/决定簇图式"上, 输出必须带不确定性与 tier;
 * 溯源与预测的真值由场景种子锁定, 因此可评分(F1 / 区间覆盖)。
 */
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const M = () => G.PathoMol;
  const stateOf = () => G.PathoHost && G.PathoHost.state();
  const fmtPct = x => (x * 100).toFixed(1) + '%';

  function lastSample(sampleArg) {
    const s = stateOf();
    if (!s || !s.mol || !s.mol.samples.length) return null;
    return s.mol.samples.find(x => x.id === String(sampleArg || '')) || s.mol.samples[s.mol.samples.length - 1];
  }

  // 表位集合: 与真值同一事实源(genome.js), 保证谱系变异与表位判定一致
  const epitopes = (entry, loci) => M().epitopes(entry, loci);

  // ---------------- 抗原逃逸 ----------------
  function escape(args) {
    const s = stateOf();
    const sample = lastSample(args && args.sample);
    if (!sample) return { ok: false, text: '没有可用样本: 先 pathogen_sequence。' };
    const profile = String((args && args.profile) || 'convalescent');
    const eps = epitopes(s.entry, s.mol.loci);
    if (!eps.length) return { ok: false, text: `${s.entry.zh}的图式没有明确表面表位(tier ${s.entry.tier} 简化), 无法做抗原逃逸分析。` };
    const mism = [];
    for (const v of sample.truth.lineage) {
      if (!v.inEpitope) continue;
      const ep = eps.find(e => e.gene === v.gene && v.pos >= e.start && v.pos <= e.start + e.width);
      if (ep) mism.push(v);
    }
    // 基准滴度按档案: convalescent 320 / vaccinated 640 / hybrid 960 / naive 40
    const base = { convalescent: 320, vaccinated: 640, hybrid: 960, naive: 40 }[profile] || 320;
    // 每个被击中的表位折减 0.45(滴度几何平均), T 细胞表位另算(这里并入同一折减)
    const fold = Math.max(1, Math.round(Math.pow(1 / 0.45, mism.length)));
    const titer = Math.max(5, Math.round(base / fold));
    const lines = [`# 抗原逃逸分析 · 样本 ${sample.id} · 档案 ${profile}`];
    lines.push(`表位图式: ${eps.length} 个表面表位(来自 ${s.entry.zh} ${s.mol.loci.filter(l => l.epi).length} 个表面基因)`);
    lines.push(`被击中表位: ${mism.length} 个${mism.length ? ' —— ' + mism.map(v => `${v.gene} p.${v.pos} ${v.ref}>${v.alt}`).join('、') : '（与参考谱系一致, 无逃逸证据）'}`);
    lines.push(`预测${s.entry.kind === 'virus' ? '中和滴度' : '抗血清滴度'}: ${base} → <b>${titer}</b>（下降 ${fold}×）`);
    lines.push(`T 细胞表位覆盖: ${mism.length > 2 ? '部分丢失(清除效率预计↓)' : '基本保留'} · 免疫清除溢出成本参见宿主内层`);
    if (mism.length) lines.push(`正选择位点提示: ${mism.map(v => v.gene + ':' + v.pos).join(', ')} —— 疫苗设计时应避开或纳入多价表位。`);
    lines.push(`注: 滴度为合成当量(tier ${s.entry.tier}), 相对比较有意义(如"下降4×"), 绝对值不可与 HI/PRMT 实测对表。`);
    return { ok: true, text: lines.join('\n') };
  }

  // ---------------- 演化预测 ----------------
  function forecast(args) {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未设置场景。' };
    const h = Math.max(7, Math.min(720, Number(args.days) || 60));
    const vp = Math.max(0, Math.min(1, Number(args.vaccine_pressure ?? args.vaccine_coverage) || 0));
    const sel = Math.max(0, Math.min(1, Number(args.drug_pressure) || 0));
    const adv = Number(args.transmission_advantage) || 0;
    const lines = [`# 演化预测 · ${s.entry.zh} · 前瞻 ${h} 天(tier ${s.entry.tier}, 情景推演非预测)`];
    const logistic = (af0, sc, days) => {
      if (af0 <= 0) return 0;
      const z = Math.log(af0 / (1 - af0));
      return 1 / (1 + Math.exp(-(z + sc * days)));
    };
    // 耐药决定簇: 现实选择压来自"正在给药"的药, 否则只有适应度代价
    for (const d of s.drugs) {
      const drug = G.PathoHost.DRUGS[d.cls];
      if (!drug) continue;
      const af0 = s.isVirus ? (s.drAf[d.cls] || 0) : (s.N + s.Nr > 1 ? s.Nr / (s.N + s.Nr) : 0);
      if (af0 <= 0) continue;
      let sc;
      if (s.isVirus) sc = sel * 0.55 - 0.02;
      else sc = sel * 0.5 - 0.12;   // 耐药代价约 0.12/d
      if (d.end <= s.t) sc = s.isVirus ? -0.02 : -0.12;   // 已停药
      const f30 = logistic(af0, sc, 30), fH = logistic(af0, sc, h);
      lines.push(`· ${d.cls} 耐药决定簇: 当前 AF ${fmtPct(af0)} → 30天 ${fmtPct(f30)} → ${h}天 <b>${fmtPct(fH)}</b>${fH > 0.5 ? '（预计成为优势群）' : ''}`);
    }
    if (!s.drugs.length) lines.push('（当前无药物压力; 突变只有适应度代价在压）');
    // 疫苗压力下的表位逃逸: 只有存在表位变异体时才有频率可推
    if (vp > 0) {
      const mol = s.mol && s.mol.samples.length ? s.mol : null;
      const epVar = mol ? mol.samples[0].truth.lineage.filter(v => v.inEpitope) : [];
      if (epVar.length) {
        const sc = 0.06 + 0.12 * vp + 0.1 * adv;
        const af0 = 0.08;
        const fH = logistic(af0, sc, h);
        lines.push(`· 疫苗压力(覆盖 ${fmtPct(vp)}): 表位变体 ${epVar.map(v => v.gene + ':' + v.pos).join(', ')} 当前按 8% 假设 → ${h}天 <b>${fmtPct(fH)}</b>（选择系数 ≈ ${sc.toFixed(2)}/天）`);
      } else {
        lines.push(`· 疫苗压力(覆盖 ${fmtPct(vp)}): 当前没有表位变异体可推 —— 对参考谱系疫苗有效; 起一个带表位突变的谱系可以推它的扩张。`);
      }
    }
    if (Math.abs(adv) > 0.001) lines.push(`· 传播优势输入 ${adv >= 0 ? '+' : ''}${adv}: 优势谱系频率按 logistic 扩展; 缺省竞争系数见群体层(P3)。`);
    lines.push('触达 50% 的时间与最终频率对选择系数敏感; 建议给两档压力各推一遍再下结论。');
    return { ok: true, text: lines.join('\n') };
  }

  // ---------------- 基因型药物匹配 ----------------
  const CROSS = {
    bl: ['blsi', 'car'], blsi: ['bl', 'car'], car: ['bl', 'blsi'],
    sul: ['dap2'], dap2: ['sul'], azole: ['azole(其他代际)'], fq: ['fq(同类)'], mac: ['linc'], linc: ['mac'],
  };
  function drug_match(args) {
    const s = stateOf();
    const sample = lastSample(args && args.sample);
    if (!sample) return { ok: false, text: '没有可用样本: 先 pathogen_sequence。' };
    const hostKind = String((args && args.host) || 'adult');
    const wanted = (args.drugs && args.drugs.length ? args.drugs : s.entry.rxCls()).map(String);
    const lines = [`# 基因型药物匹配 · 样本 ${sample.id} · 患者 ${hostKind} · ${s.entry.zh}`];
    const usable = [];
    for (const cls of wanted) {
      const d = G.PathoHost.DRUGS[cls];
      if (!d || d.emax <= 0) continue;
      const det = sample.truth.dets.find(x => x.cls === cls);
      const af = det ? det.af : 0;
      const mic = G.PathoHost.micOf(s.entry.id, cls, s.resFold);
      const phen = af < 0.01 ? 'S' : af < 0.5 ? 'I(混合)' : 'R';
      const barrier = af < 0.5 ? 1 : 0;
      lines.push(`· <b>${cls}</b> ${d.zh} → ${phen} · 现测 AF ${fmtPct(af)} · 抗性屏障 ${barrier <= 0 ? '已失守' : '单步(注意选择窗)'}`);
      if (phen !== 'R') usable.push({ cls, af, family: CROSS[cls] ? CROSS[cls][0] : cls });
    }
    if (usable.length) {
      // 组合推荐: 不同家族、当前 AF 最低的两个类
      usable.sort((a, b) => a.af - b.af);
      const a = usable[0];
      const b = usable.find(u => !CROSS[u.cls]?.includes(a.cls) && u.cls !== a.cls) || usable[1];
      lines.push(`推荐方案: ${a.cls}${b && b !== a ? ' + ' + b.cls : ''}（不同靶点家族, 抑制单步逃逸）; 剂量按诊断层折点, 疗程要覆盖宿主内清除(见宿主内曲线)。`);
      lines.push(`交叉耐药提醒: ${JSON.stringify(Object.fromEntries(wanted.filter(c => CROSS[c]).map(c => [c, CROSS[c]])))} 同族药物不宜互为备用。`);
    } else {
      lines.push('目录内全部类别的决定簇频率都已过半 —— 本表按"只看基因型"给的结论是: 无可用类, 需回退到支持治疗/感染控制或改用试验台评估组合方案。');
    }
    lines.push(`注: 表型为基因型推断(tier ${s.entry.tier}); MIC 数值以类基准合成, 不是真实药敏数据。`);
    return { ok: true, text: lines.join('\n') };
  }

  // ---------------- 疫苗设计 ----------------
  function vaccine_design(args) {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未设置场景。' };
    const platform = String(args.platform || 'subunit');
    const doses = Math.max(1, Math.min(3, Number(args.doses) || 2));
    const strategy = String(args.strategy || 'conserved');
    const eps = epitopes(s.entry, (s.mol && s.mol.loci) || M().lociFor(s.entry));
    if (!eps.length) return { ok: false, text: `${s.entry.zh}没有可用的表面表位图式, 疫苗设计不适用(tier ${s.entry.tier})。` };
    const TITER = { mrna: { t: 1280, peak: 14, half: 90 }, subunit: { t: 320, peak: 21, half: 120 }, inactivated: { t: 160, peak: 28, half: 100 }, vector: { t: 240, peak: 25, half: 110 }, live_attenuated: { t: 640, peak: 14, half: 540 } };
    const P = TITER[platform] || TITER.subunit;
    // 三种策略的表位选择: conserved 取随机可保守位, matched 取当前样本表位, cocktail 全覆盖
    const r = M().rng(M().hash32('vax-cloud::' + s.entry.id + '::' + (s.mol ? s.mol.samples.length : 0)));  // 云团与策略无关, 覆盖率才可跨策略比较
    const sample = s.mol && s.mol.samples.length ? s.mol.samples[s.mol.samples.length - 1] : null;
    const epVar = sample ? sample.truth.lineage.filter(v => v.inEpitope) : [];
    // 云团: 当前谱系 + 单点逃逸突变样本(m=40)
    const cloud = [];
    for (let i = 0; i < 40; i++) {
      const ep = eps[Math.floor(r() * eps.length)];
      cloud.push({ gene: ep.gene, pos: ep.start + Math.floor(r() * ep.width), strategy: 'cloud' });
    }
    // 覆盖率: 每个云团变体若命中"疫苗表位集的重叠窗口"则计覆盖
    const vaccineEps = strategy === 'conserved'
      ? eps.slice(0, Math.max(2, Math.floor(eps.length * 0.6)))          // 保守集: 表位图式前 60%(确定性排序)
      : strategy === 'matched'
        ? (epVar.length ? eps.filter(e => epVar.some(v => v.gene === e.gene && v.pos >= e.start && v.pos <= e.start + e.width)).concat(eps.slice(0, 2)) : eps.slice(0, 2))
        : eps;                                                            // cocktail 全集
    const cover = cloud.filter(c => vaccineEps.some(e => e.gene === c.gene && Math.abs(e.start - c.pos) <= e.width)).length / cloud.length;
    const riskPos = cloud.filter(c => !vaccineEps.some(e => e.gene === c.gene && Math.abs(e.start - c.pos) <= e.width)).slice(0, 4);
    const lines = [`# 疫苗设计 · ${s.entry.zh} · 平台 ${platform} × ${doses} 剂 · 策略 ${strategy}`];
    lines.push(`表位输入: ${vaccineEps.length}/${eps.length} 个表面表位${strategy === 'matched' ? '（以最新样本为模板）' : strategy === 'cocktail' ? '（多价全谱）' : '（保守优先）'} · 样本依据 ${sample ? sample.id : '无(用参考谱系)'}`);
    lines.push(`预测覆盖率: <b>${fmtPct(cover)}</b>(对单点逃逸云团 m=40); 单点逃逸难防是常态, 覆盖率的意义是相对比较三种策略。`);
    lines.push(`免疫原性: 峰滴度 ≈ ${P.t}${doses >= 2 ? ' → 加强后 ' + P.t * doses : ''} · 达峰 ${P.peak} 天 · 半衰 ${P.half} 天(${doses >= 2 ? '两剂程序下 180 天仍 >50%' : '单剂 180 天滴度显著衰减'})`);
    lines.push(`逃逸风险位点(建议监测): ${riskPos.length ? riskPos.map(c => c.gene + ':' + c.pos).join(', ') : '无(当前云团全部被覆盖)'}`);
    lines.push(`与宿主内层联动: 接种后可用 pathogen_host_immune {vaccinated:true} 落到仿真里看再感染动力学。`);
    lines.push(`注: 滴度与覆盖率为合成当量(tier ${s.entry.tier}), 用于策略间相对比较。`);
    return { ok: true, text: lines.join('\n') };
  }

  // ---------------- 系统发生(距离 + UPGMA) ----------------
  function variantSet(sample) {
    const m = new Map();
    for (const c of sample.calls) {
      // 谱系距离只吃"时钟"位点: 耐药决定簇是选择驱动(会跨阈值出现/消失),
      // 测序错误是噪声 —— 两者进距离矩阵都会毁掉分子钟语义。
      if (c.class === 'det' || c.class === 'lowfreq') continue;
      m.set(c.gene + ':' + c.pos, c.alt);
    }
    return m;
  }
  function dist(a, b) {
    const A = variantSet(a), B = variantSet(b);
    let d = 0;
    for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k)) d++;
    return d;
  }
  function phylo(args) {
    const s = stateOf();
    if (!s || !s.mol || s.mol.samples.length < 2) return { ok: false, text: '至少需要两个样本才能画系统发生: 多次 pathogen_sequence(不同时间点/标签)。' };
    const ids = (args.samples && args.samples.length ? args.samples.map(String) : s.mol.samples.map(x => x.id)).filter(id => s.mol.samples.some(x => x.id === id));
    if (ids.length < 2) return { ok: false, text: '样本 id 不存在: ' + JSON.stringify(args.samples) }
    const sm = ids.map(id => s.mol.samples.find(x => x.id === id));
    const thr = args.threshold !== undefined ? Number(args.threshold) : 2;
    const n = sm.length;
    const lines = [`# 系统发生 · ${sm.length} 个样本 · SNP 阈值 ${thr}`];
    lines.push('距离矩阵(SNP 差异):');
    lines.push('      ' + sm.map(x => x.id.padEnd(6)).join(''));
    for (let i = 0; i < n; i++) {
      lines.push(x_pad(sm[i].id) + sm.map((y, j) => String(dist(sm[i], y)).padEnd(6)).join(''));
    }
    // 聚类: 单连锁, 阈值内合并
    const clusters = [];
    sm.forEach((x, i) => {
      for (const cl of clusters) if (cl.some(j => dist(sm[i], sm[j]) <= thr)) { cl.push(i); return; }
      clusters.push([i]);
    });
    lines.push(`聚类(≤${thr} SNP): ${clusters.length} 簇 —— ${clusters.map((cl, k) => `簇${k + 1}[${cl.map(i => sm[i].id).join(',')}]`).join(' ')}`);
    // UPGMA → Newick
    const tree = upgma(sm);
    lines.push(`Newick: ${tree};`);
    lines.push('提示: 同簇且时间相容 → 强烈支持同源传播(配 pathogen_trace); 距离大且无中间样本 → 可能存在未被采样的传播环节。');
    return { ok: true, text: lines.join('\n') };
  }
  function x_pad(s) { return String(s).padEnd(6); }
  function upgma(sm) {
    // 平均连锁聚类(UPGMA): 簇间距离每次现算, 树高=距离/2, 输出 Newick。
    const dOf = (a, b) => dist(sm[a], sm[b]);
    const avg = (A, B) => {
      let s = 0;
      for (const i of A) for (const j of B) s += dOf(i, j);
      return s / (A.length * B.length);
    };
    let clusters = sm.map((x, i) => ({ leaves: [i], height: 0, name: x.id, children: [] }));
    while (clusters.length > 1) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const d = avg(clusters[i].leaves, clusters[j].leaves);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
      const merged = {
        leaves: clusters[bi].leaves.concat(clusters[bj].leaves),
        height: bd / 2,
        name: null,
        children: [clusters[bi], clusters[bj]],
      };
      clusters = clusters.filter((_, k) => k !== bi && k !== bj);
      clusters.push(merged);
    }
    const toStr = (nd, parentH) => {
      const blen = Math.max(0, nd.height - (parentH || 0)).toFixed(1);
      if (!nd.children.length) return `${nd.name}:${blen}`;
      return `(${nd.children.map(c => toStr(c, nd.height)).join(',')})${nd.name || ''}:${blen}`;
    };
    return toStr(clusters[0], 0);
  }

  // ---------------- 宿主/传播链溯源 ----------------
  function trace(args) {
    const s = stateOf();
    if (!s || !s.mol || s.mol.samples.length < 3) return { ok: false, text: '溯源至少需要 3 个样本(串行分离): 多次 pathogen_sequence 并推进时间。' };
    const ids = (args.samples && args.samples.length ? args.samples.map(String) : s.mol.samples.map(x => x.id));
    const sm = ids.map(id => s.mol.samples.find(x => x.id === id)).filter(Boolean);
    const sorted = sm.slice().sort((a, b) => a.t - b.t);
    const CLOCK = 0.55;  // 宿主内演化钟速(与 genome.js 的私有变异速率对表: SNP/天)
    const lines = [`# 传播链/来源推断 · ${sm.length} 个样本(按采样时间排序)`];
    const chains = [];
    let correct = 0, total = 0;
    for (let j = 1; j < sorted.length; j++) {
      // 前代选择: 泊松似然(SNP 计数 ~ Poisson(CLOCK·Δt)) + 串行先验 -
      // 隔代传播要同时解释"为什么跳过中间样本", 罚 0.12 · 代差。
      // nll 必须含 ln(d!) —— d 随候选不同, 略掉它就会系统性地偏向大计数。
      const lnFact = k => { let s = 0; for (let x = 2; x <= k; x++) s += Math.log(x); return s; };
      let best = null, runner = Infinity;
      for (let i = 0; i < j; i++) {
        const d = dist(sorted[i], sorted[j]);
        const lam = Math.max(0.1, CLOCK * (sorted[j].t - sorted[i].t));
        const nll = lam - d * Math.log(lam) + lnFact(d) + 0.12 * (j - i - 1);
        if (!best || nll < best.nll) { runner = best ? best.nll : Infinity; best = { i, d, lam, nll }; }
        else if (nll < runner) runner = nll;
      }
      total++;
      if (best.i === j - 1) correct++;
      const conf = runner === Infinity ? 0.9 : Math.exp(-(best.nll - runner));
      chains.push(`${sorted[j].id} ← ${sorted[best.i].id} (观测 ${best.d} SNP vs 期望 ${best.lam.toFixed(1)} · NLL ${best.nll.toFixed(2)} · 置信 ${(conf * 100).toFixed(0)}%)`);
    }
    if (useFlags(args, 'locations')) lines.push(`说明: 位置信息在群体层(P3)接入前不可用; 当前链是"时间+基因距离"的串行分离推断。`);
    lines.push(...chains);
    lines.push(`指示样本(最早): <b>${sorted[0].id}</b>(t=${sorted[0].t}d) —— 同源判定: 全链 SNP 距离 ≤ ${Math.max(2, CLOCK * 3).toFixed(0)} 时支持同一来源。`);
    lines.push(`图谱正确性: 与采样真时序一致 ${(correct / total * 100).toFixed(0)}%(${correct}/${total}) —— 本环境真值可查, 因此该数字可直接当评分用。`);
    lines.push(`提示: 基因距离近 + 时间相容只是"可能同源"的证据链两角; 缺暴露调查时不要把链当事实。`);
    return { ok: true, text: lines.join('\n') };
  }
  function useFlags(args, key) {
    if (args && args[key]) return true;
    return false;
  }

  G.PathoPredict = { escape, forecast, drug_match, vaccine_design, phylo, trace, epitopes, dist, variantSet };
})();
