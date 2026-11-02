/* ================= 虚拟病原体 · 宿主内动力学引擎(P1) =================
 * 纯数据层: 不碰 DOM, 浏览器与 node 自测同源。两个分支:
 *   病毒(archetype v_*): 靶细胞模型 T/I/V + 固有(IFN)/适应(CD8/Ab)免疫;
 *   其余(细菌/真菌/原虫/蠕虫/朊粒): 负荷模型 Ns/Nr(Logistic + 免疫清除),
 *     耐药亚群 + 突变供给 + MSW 富集, 病毒抗病毒药走 p/β/c 三靶点。
 * 数值: 定步长 dt=0.01d 欧拉 + 非负截断(本参数域内稳定: r≤2.1/d, kill≤6/d)。
 * 确定性: 同 (pathogen, seed) 恒同曲线; 噪声只存在于诊断层(diag.js)。
 *
 * 参数语义全部是"原型量级"(tier 标注随 observe 输出), 目标是机理教学与
 * 相对比较, 不是临床试验仿真 —— 文档与页面均有声明。
 */
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;

  // ---------------- 确定性哈希/随机 ----------------
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

  // ---------------- 药物类参数表(PK/PD 量级) ----------------
  // t½ 半衰期, ka 吸收率(0=静脉), Emax /d 杀灭率上限(cidal 高, static 低),
  // micWt 基准野生型 MIC(mg/L 量级), H Hill 系数, pae 后效应(h), iv 静脉给药,
  // tgt 病毒分支靶点: p(复制) β(进入) c(释放). 抗原虫/蠕虫类同样走负荷分支。
  const DRUGS = {
    // 抗病毒
    nai: { zh: '神经氨酸酶抑制剂', h: 1.2, t: 6, ka: 1.0, emax: 1.6, mic: 0.25, pae: 8, iv: false, vir: true, tgt: 'p' },
    m2:  { zh: 'M2 离子通道抑制剂', h: 1.1, t: 10, ka: 1.0, emax: 1.2, mic: 1, pae: 24, iv: false, vir: true, tgt: 'b' },
    rdrp:{ zh: '聚合酶抑制剂(RdRp)', h: 1.0, t: 6, ka: 1.6, emax: 1.6, mic: 0.25, pae: 4, iv: false, vir: true, tgt: 'p' },
    pol: { zh: 'DNA 聚合酶抑制剂', h: 1.0, t: 3, ka: 1.5, emax: 1.8, mic: 0.12, pae: 6, iv: false, vir: true, tgt: 'p' },
    rt:  { zh: '逆转录酶抑制剂', h: 1.0, t: 10, ka: 1.0, emax: 1.4, mic: 1, pae: 12, iv: false, vir: true, tgt: 'p' },
    pi:  { zh: '蛋白酶抑制剂', h: 1.1, t: 6, ka: 1.0, emax: 1.4, mic: 0.5, pae: 8, iv: false, vir: true, tgt: 'p' },
    inst:{ zh: '整合酶抑制剂', h: 1.0, t: 9, ka: 1.0, emax: 1.4, mic: 1, pae: 12, iv: false, vir: true, tgt: 'p' },
    fus: { zh: '融合抑制剂', h: 1.0, t: 11, ka: 0, emax: 1.3, mic: 2, pae: 12, iv: true, vir: true, tgt: 'b' },
    ifn: { zh: '干扰素', h: 1.2, t: 4, ka: 0, emax: 1.0, mic: 2, pae: 24, iv: true, vir: true, tgt: 'p' },
    ns5: { zh: 'NS5A/NS5B 直接抗病毒', h: 1.0, t: 12, ka: 1.0, emax: 2.2, mic: 0.05, pae: 24, iv: false, vir: true, tgt: 'p' },
    rib: { zh: '利巴韦林', h: 1.0, t: 24, ka: 0.8, emax: 1.2, mic: 4, pae: 24, iv: false, vir: true, tgt: 'p' },
    tec: { zh: '正痘病毒抑制剂', h: 1.0, t: 7, ka: 0.8, emax: 1.5, mic: 2, pae: 24, iv: false, vir: true, tgt: 'p' },
    // 抗菌(负荷分支)
    bl:  { zh: 'β-内酰胺类', h: 1.2, t: 6, ka: 1.8, emax: 3.6, mic: 2, pae: 1.5, iv: false },
    blsi:{ zh: 'β-内酰胺+酶抑制剂', h: 1.2, t: 6, ka: 1.6, emax: 3.8, mic: 4, pae: 1.8, iv: false },
    car: { zh: '碳青霉烯类', h: 1.0, t: 2, ka: 1.5, emax: 4.2, mic: 1, pae: 2.0, iv: true },
    gly: { zh: '糖肽/脂糖肽类', h: 1.3, t: 6, ka: 0, emax: 3.4, mic: 1, pae: 2.0, iv: true },
    oxa: { zh: '恶唑烷酮类', h: 1.0, t: 5, ka: 1.2, emax: 2.6, mic: 2, pae: 3, iv: false },
    mac: { zh: '大环内酯类', h: 1.1, t: 3, ka: 1.0, emax: 2.2, mic: 2, pae: 4, iv: false },
    tet: { zh: '四环素类', h: 1.0, t: 8, ka: 1.2, emax: 2.4, mic: 1, pae: 4, iv: false },
    ag:  { zh: '氨基糖苷类', h: 1.1, t: 2.5, ka: 0, emax: 4.0, mic: 2, pae: 4, iv: true },
    fq:  { zh: '氟喹诺酮类', h: 1.1, t: 7, ka: 1.2, emax: 3.8, mic: 1, pae: 2.5, iv: false },
    sul: { zh: '磺胺/甲氧苄啶', h: 1.0, t: 10, ka: 0.9, emax: 2.2, mic: 4, pae: 0, iv: false },
    chl: { zh: '氯霉素', h: 1.0, t: 3, ka: 1.4, emax: 3.0, mic: 4, pae: 2, iv: false },
    linc:{ zh: '林可酰胺类', h: 1.0, t: 3, ka: 1.4, emax: 2.6, mic: 2, pae: 1, iv: false },
    dap: { zh: '环脂肽类', h: 1.2, t: 8, ka: 0, emax: 4.0, mic: 1, pae: 3, iv: true },
    str: { zh: '链阳菌素类', h: 1.1, t: 2, ka: 0, emax: 3.2, mic: 1, pae: 4, iv: true },
    col: { zh: '多黏菌素类', h: 1.2, t: 4, ka: 0, emax: 3.6, mic: 2, pae: 4, iv: true },
    mnz: { zh: '硝基咪唑类', h: 1.0, t: 8, ka: 1.8, emax: 3.6, mic: 2, pae: 3, iv: false },
    rif: { zh: '利福霉素类', h: 1.3, t: 3, ka: 1.4, emax: 4.0, mic: 0.5, pae: 6, iv: false },
    inh: { zh: '异烟肼', h: 1.2, t: 2, ka: 1.4, emax: 3.4, mic: 0.2, pae: 5, iv: false },
    pza: { zh: '吡嗪酰胺', h: 1.0, t: 9, ka: 1.2, emax: 2.4, mic: 4, pae: 24, iv: false },
    emb: { zh: '乙胺丁醇', h: 1.0, t: 4, ka: 1.0, emax: 2.0, mic: 2, pae: 8, iv: false },
    tgc: { zh: '替加环素', h: 1.0, t: 27, ka: 0, emax: 2.8, mic: 0.5, pae: 4, iv: true },
    // 抗真菌/抗原虫/抗蠕虫(同为负荷分支, emax 表示免疫协同清除)
    ampho:  { zh: '两性霉素B(脂质体)', h: 1.2, t: 24, ka: 0, emax: 3.4, mic: 1, pae: 24, iv: true },
    azole:  { zh: '三唑类', h: 1.1, t: 12, ka: 1.0, emax: 2.6, mic: 1, pae: 12, iv: false },
    echino: { zh: '棘白菌素类', h: 1.1, t: 13, ka: 0, emax: 2.8, mic: 1, pae: 24, iv: true },
    flucyt: { zh: '氟胞嘧啶', h: 1.0, t: 4, ka: 1.4, emax: 2.8, mic: 2, pae: 4, iv: false },
    art:  { zh: '青蒿素类(ACT)', h: 1.2, t: 1, ka: 1.8, emax: 4.5, mic: 1, pae: 4, iv: false },
    cq:   { zh: '氯喹类', h: 1.0, t: 40, ka: 1.4, emax: 3.4, mic: 0.5, pae: 24, iv: false },
    mfq:  { zh: '甲氟喹', h: 1.0, t: 14, ka: 0.8, emax: 3.0, mic: 1, pae: 24, iv: false },
    pq:   { zh: '伯氨喹/他非诺喹', h: 1.0, t: 6, ka: 1.4, emax: 2.4, mic: 2, pae: 12, iv: false },
    atov: { zh: '阿托伐醌/氯胍', h: 1.0, t: 3, ka: 0.9, emax: 2.6, mic: 1, pae: 6, iv: false },
    parom:{ zh: '巴龙霉素', h: 1.0, t: 4, ka: 1.2, emax: 2.2, mic: 4, pae: 2, iv: false },
    pent: { zh: '戊烷脒', h: 1.0, t: 9, ka: 0, emax: 2.6, mic: 1, pae: 12, iv: true },
    eflor:{ zh: '依氟鸟氨酸', h: 1.0, t: 3, ka: 0.5, emax: 2.4, mic: 2, pae: 12, iv: false },
    suram:{ zh: '苏拉明', h: 1.0, t: 5, ka: 0, emax: 2.6, mic: 2, pae: 12, iv: true },
    melar:{ zh: '砷剂(美拉胂醇)', h: 1.0, t: 2, ka: 0, emax: 3.0, mic: 2, pae: 12, iv: true },
    nifurt:{ zh: '硝呋替莫', h: 1.0, t: 3, ka: 1.2, emax: 2.4, mic: 4, pae: 6, iv: false },
    nitaz:{ zh: '硝唑尼特', h: 1.0, t: 3, ka: 1.2, emax: 2.2, mic: 4, pae: 4, iv: false },
    dap2: { zh: '氨苯砜', h: 1.0, t: 22, ka: 1.0, emax: 2.6, mic: 1, pae: 24, iv: false },
    clof: { zh: '氯法齐明', h: 1.0, t: 25, ka: 1.0, emax: 1.8, mic: 1, pae: 24, iv: false },
    sb:   { zh: '锑剂(葡萄糖酸锑钠)', h: 1.0, t: 12, ka: 0, emax: 2.6, mic: 4, pae: 24, iv: true },
    bzd:  { zh: '苯并咪唑类(阿苯达唑)', h: 1.1, t: 8, ka: 1.2, emax: 2.6, mic: 1, pae: 12, iv: false },
    praz: { zh: '吡喹酮', h: 1.0, t: 2, ka: 2.0, emax: 3.6, mic: 1, pae: 6, iv: false },
    iver: { zh: '伊维菌素', h: 1.0, t: 18, ka: 0.8, emax: 2.8, mic: 1, pae: 24, iv: false },
    pyr:  { zh: '噻嘧啶', h: 1.0, t: 10, ka: 1.4, emax: 2.4, mic: 2, pae: 12, iv: false },
    dec:  { zh: '乙胺嗪(DEC)', h: 1.0, t: 8, ka: 1.4, emax: 2.4, mic: 2, pae: 12, iv: false },
    tcbz: { zh: '三氯苯达唑', h: 1.0, t: 8, ka: 1.2, emax: 2.6, mic: 2, pae: 12, iv: false },
    // 特殊
    mab:  { zh: '单克隆抗体', h: 1.2, t: 20, ka: 0, emax: 2.2, mic: 1, pae: 120, iv: true, vir: true, tgt: 'p' },
    ivig: { zh: '免疫球蛋白', h: 1.2, t: 21, ka: 0, emax: 1.6, mic: 2, pae: 168, iv: true, vir: true, tgt: 'p' },
    support: { zh: '支持治疗', h: 1, t: 1e9, ka: 0, emax: 0, mic: 1e9, pae: 0, iv: true },
    ors:  { zh: '口服补液+液体管理', h: 1, t: 1e9, ka: 0, emax: 0, mic: 1e9, pae: 0, iv: true },
    vacx: { zh: '疫苗/暴露后预防', h: 1, t: 1e9, ka: 0, emax: 0, mic: 1e9, pae: 0, iv: true },
    cort: { zh: '糖皮质激素辅助', h: 1, t: 3, ka: 1.4, emax: 0, mic: 1e9, pae: 0, iv: false },
    antitox: { zh: '抗毒素/抗血清', h: 1, t: 14, ka: 0, emax: 2.0, mic: 1, pae: 168, iv: true },
    vita: { zh: '维生素A 辅助', h: 1, t: 1e9, ka: 0, emax: 0, mic: 1e9, pae: 0, iv: true },
  };
  const DRUG_ALIAS = { DNA_ff: 'dap2' };

  const DT = 0.01;          // 固定步长(天)
  const HORIZON = 365;      // 最大模拟时长(天)
  const SAMPLE_EVERY = 0.05;// 采样间隔(天)
  const K_BURDEN = 1e9;     // 负荷模型携带容量(CFU/ml 量级)
  const T0_VIRUS = 1e8;     // 靶细胞库(cells/ml 量级)
  const LOD_LOAD = 100;     // qPCR 检出下限(copies/ml 等效)

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sat = x => x <= 0 ? 0 : x >= 1 ? 1 : x;
  const hill = (x, h) => x <= 0 ? 0 : Math.pow(x, h) / (1 + Math.pow(x, h));

  // MIC 量级由 (病原体, 类) 哈希在 {0.25..32} 中取 —— 同 seed 恒同值,
  // tier 语义: 这是"原型对表", 不是真实抗微生物药敏数据。
  const STRAIN_POOL = [0.5, 1, 2];              // 株间敏感度差异(× 类基准)
  const FOLD_POOL = [4, 8, 16, 32];             // 耐药突变倍数(表观型)
  function micOf(entryId, cls, resFold) {
    const base = (DRUGS[cls] && DRUGS[cls].mic) || 1;
    const r = rng(hash32(entryId + '::' + cls));
    const wt = base * STRAIN_POOL[Math.floor(r() * STRAIN_POOL.length)];
    if (resFold !== undefined) return { wt, res: wt * resFold, fold: resFold };
    const fold = FOLD_POOL[Math.floor(r() * FOLD_POOL.length)];
    return { wt, res: wt * fold, fold };
  }

  function freshState(entry, opts) {
    const arch = (G.PathoCatalog && G.PathoCatalog.arch[entry.arch]) || {};
    opts = opts || {};
    const isVirus = entry.kind === 'virus';
    return {
      entry, arch, isVirus, t: 0, seed: opts.seed || (hash32(entry.id) % 99991) + 1,
      resFold: opts.resFold,                              // 自测钩子: 固定耐药倍数
      // 病毒分支
      T: T0_VIRUS, I: 0, V: 0, cumInfCells: 0,
      // 负荷分支
      N: 0, Nr: 0, biofilm: 0,
      // 免疫
      imm: { ifn: 0, cd8: 0, ab: 0, mem: 0, supp: 0, exposed: -1, rampT: 0 },
      // 宿主
      host: { temp: 36.6, dmg: 0, severe: false, clearedAt: -1, priorClear: false },
      // 药物: {cls, mg, start, intervalH, end, micWt, micRes}
      drugs: [],
      diagSeed: 1,
      samples: [],
      peak: 0, inoculated: false, events: [],
    };
  }

  function antigenOf(s) {
    return s.isVirus ? (s.V + s.I * 30) / 1e6 : s.N / K_BURDEN;
  }
  function loadOf(s) {
    return s.isVirus ? s.V : s.N + s.Nr;
  }
  function infCurve(s) {
    // 传染性: 呼吸道/接触途径的病原体按载量对数映射, 仅作 P3 群体层的接口
    const rt = s.entry.tx.some(x => x && x.indexOf('resp') === 0 || x === 'contact');
    if (!rt) return 0;
    return sat((Math.log10(Math.max(1e-2, loadOf(s))) - 3) / 5);
  }

  // 规则给药的血药浓度(解析几何叠加, 不逐步积累):
  //   C(t) = A·Σ_{k=0..n} f(t−start−kτ),  f(dt) 口服=A·ka/(ka−ke)·(e^{−ke dt}−e^{−ka dt}),
  //   静脉=A·e^{−ke dt}; 给药上限由 d.end 截断。ka 表值单位 1/h, 统一换算 /天。
  function concAt(d, t) {
    if (!d) return 0;
    const ke = Math.log(2) / (d.drug.t / 24);           // 1/天
    const ka = (d.drug.ka || 0) * 24;                   // 1/天
    const A = d.mg * 0.04;                              // mg·F/Vd 量级(mg/L)
    const D = (dt) => (dt <= 0 ? 0 : ka > 0
      ? A * ka / (ka - ke) * (Math.exp(-ke * dt) - Math.exp(-ka * dt))
      : A * Math.exp(-ke * dt));
    const tau = d.intervalH > 0 ? d.intervalH / 24 : Infinity;
    if (!(tau === Infinity)) {
      const n = Math.floor((Math.min(t, d.end) - d.start) / tau + 1e-9); // 已给完的剂数-1
      if (n < 0) return 0;
      const dte = t - (d.start + n * tau);               // 距最后一剂
      let c = 0;
      // 等比前向叠加: Σ f(dte + jτ) = 口服两项几何和
      if (ka > 0) {
        const gke = Math.exp(-ke * dte) * (1 - Math.exp(-ke * (n + 1) * tau)) / (1 - Math.exp(-ke * tau));
        const gka = Math.exp(-ka * dte) * (1 - Math.exp(-ka * (n + 1) * tau)) / (1 - Math.exp(-ka * tau));
        c = A * ka / (ka - ke) * (gke - gka);
      } else {
        c = A * Math.exp(-ke * dte) * (1 - Math.exp(-ke * (n + 1) * tau)) / (1 - Math.exp(-ke * tau));
      }
      return c;
    }
    return D(t - d.start);
  }

  function immuneStep(s, dt, ag) {
    const im = s.imm;
    const seen = ag > 0.015;
    if (seen && im.exposed < 0) { im.exposed = s.t; }
    const delayW = im.mem > 0.5 ? 0.35 : 1;              // 记忆免疫: 成熟更快
    const memFloor = im.mem > 0.5 && ag > 0.005 ? 0.35 : 0;  // 记忆地板: 二次应答从 35% 效应起步
    const mat = im.exposed >= 0 ? sat((s.t - im.exposed - 3.5 * delayW) / (2.5 + 1.5 * delayW)) : 0;
    im.rampT = mat;
    const on = ag > 0.02 ? 1 : 0;
    const suppF = 1 - 0.75 * im.supp;
    im.ifn += (on * sat(ag * 1.5) * suppF - im.ifn) * clamp(dt / 0.8, 0, 1);
    // 累积暴露积分(sero): 抗体效价跟随感染剂量史而不是瞬时抗原 —— 大感染后
    // 效价持续(血清转化), 这是"尾巴快速收口"与"二次应答更快"的共同来源。
    im.expInt = (im.expInt || 0) + Math.min(ag, 5) * dt;
    const sero = sat(im.expInt * 0.25) * mat;
    const tgt8 = Math.max(memFloor, sat(ag * 2.5) * mat, 0.6 * sero) * suppF;
    im.cd8 += (tgt8 - im.cd8) * clamp(dt / 12, 0, 1);
    const rampAb = im.exposed >= 0 ? sat((s.t - im.exposed - 5 * delayW) / (3 + 2 * delayW)) : 0;
    const tgtAb = Math.max(memFloor, sat(ag * 1.8) * rampAb, sero) * suppF;
    im.ab += (tgtAb - im.ab) * clamp(dt / 18, 0, 1);
  }

  function step(s, dt) {
    const a = s.arch;
    const concAll = s.drugs.map(d => ({ d, C: concAt(d, s.t) }));
    if (s.isVirus) {
      // 药物靶点折减: β/p/c
      let betaMul = 1, pMul = 1, cMul = 1;
      for (const { d, C } of concAll) {
        if (!d.drug.vir || d.drug.emax <= 0) continue;
        const ec = Math.max(1e-6, d.micWt * 0.6);
        const eff = 0.85 * hill(C / ec, d.drug.h);
        const f = 1 - eff;
        if (d.drug.tgt === 'p') pMul = Math.min(pMul, f);
        else if (d.drug.tgt === 'b') betaMul = Math.min(betaMul, f);
        else cMul = Math.min(cMul, f);
      }
      const beta = (a.r || 1.0) / T0_VIRUS * betaMul;
      const p = 30 * pMul;   // 日产粒量: 决定对数斜率与峰值形态(βT₀=r 已锁 λ)
      const delta = 1.0 + 1.5 * s.imm.ifn + 0.8 * s.imm.cd8;
      const c = 3.0 * cMul + 5 * s.imm.ab;
      const dT = 2.4 * (1 - s.T / T0_VIRUS) - 0.01 * s.T - beta * s.T * s.V;
      const dI = beta * s.T * s.V - delta * s.I;
      const dV = p * s.I - c * s.V;
      s.T = Math.max(0, s.T + dT * dt);
      s.I = Math.max(0, s.I + dI * dt);
      if (s.I + dI * dt > 0) s.cumInfCells = Math.min(1, s.cumInfCells + (beta * s.T * s.V) / Math.max(1, T0_VIRUS) * dt);
      s.V = Math.max(0, s.V + dV * dt);
    } else {
      // 负荷分支: 敏感/耐药两株 Logistic + 药物/免疫清除 + 突变供给
      let killS = 0, killR = 0;
      for (const { d, C } of concAll) {
        const dr = d.drug;
        if (!dr || dr.vir || dr.emax <= 0) continue;
        // 后效应: C 掉到 MIC 下仍保留衰减的活性(以最后一剂时间近似)
        const effC = C + dr.pae / 24 * 0.02 * (C < d.micWt ? Math.exp(-(s.t - d.lastAbove) / (dr.pae / 24 || 1)) : 0);
        killS += dr.emax * hill(effC / (d.micWt * 1.2), dr.h);
        killR += dr.emax * hill(effC / (d.micRes * 1.2 || 1e9), dr.h);
        if (C > d.micWt) d.lastAbove = s.t;
      }
      const ag = antigenOf(s);
      const immKill = (0.05 + 0.45 * sat(ag * 2) * (1 + 0.3 * s.imm.cd8 + 0.5 * s.imm.ab)) * (1 - 0.6 * s.imm.supp);
      const r = a.r || 0.9;
      const cost = 0.12;                                 // 耐药适应度代价
      const capacity = Math.max(0, 1 - (s.N + s.Nr) / K_BURDEN);
      // 低密度调理吞噬: 负荷越低, 中性粒/补体的单位清除越强(对数密度差
      // 映射到 0-0.6/d 的加成)。注意强度上限: 固有免疫就该能收掉疗程尾
      // 的亚临界残余(<1e3), 但不能强到把"耐药株在 MSW 里的扩张"也一并
      // 压死 —— 耐药优势对抗的是药物, 不是宿主; 富集仍然要能发生。
      const logDen = Math.log10(Math.max(1, s.N + s.Nr));
      const lowDenKill = 0.35 + 0.6 * sat(3 - logDen);
      const dS = r * s.N * capacity * (1 - 0.6 * s.biofilm) - (killS + immKill + (lowDenKill - 0.35)) * s.N;
      const dR = r * (1 - cost) * s.Nr * capacity * (1 - 0.6 * s.biofilm) - (killR + immKill + (lowDenKill - 0.35)) * s.Nr;
      const mut = 3e-9 * s.N * dt;                       // 突变供给(绝对量)
      s.N = Math.max(0, s.N + dS * dt - mut);
      s.Nr = Math.max(0, s.Nr + dR * dt + mut);
    }
    // 免疫 + 病理输出
    const ag2 = antigenOf(s);
    immuneStep(s, dt, ag2);
    const pyro = (a.pyro || 1) * (0.4 + 0.6 * s.imm.ifn);
    s.host.temp = 36.6 + Math.min(2.6, pyro * sat(ag2 * 1.2) * 1.05) * (1 - 0.25 * s.imm.supp);
    const L = loadOf(s);
    s.peak = Math.max(s.peak, L);
    if (!s.isVirus && L > 1e7) {
      s.host.dmg += (Math.log10(L) - 7) * dt * 0.05;
      if (s.host.dmg > 1) s.host.severe = true;
    }
    if (s.isVirus && L > 1e8 && s.arch.pyro > 2.5) s.host.severe = true;
    // 清除判定 → 扑灭: 低于阈值持续 2 天视为免疫清除并归零残余(教学语义:
    // 记忆免疫完成"灭菌级"清除, 残余不再复燃); 再感染重新接种, 记忆保留。
    if (s.inoculated && s.t > 0.5 && !s.host.extinguished) {
      if (L < LOD_LOAD * 0.01) {
        s.host.clearLowT = (s.host.clearLowT || 0) + dt;
        if (s.host.clearedAt < 0 && s.host.clearLowT >= 2) {
          s.host.clearedAt = s.t;
          s.imm.mem = 1;
          s.host.extinguished = true;
          if (s.isVirus) { s.V = 0; s.I = 0; } else { s.N = 0; s.Nr = 0; }
        }
      } else {
        s.host.clearLowT = 0;
      }
    }
    s.t += dt;
  }

  function samplePush(s) {
    const concAll = {};
    for (const d of s.drugs) concAll[d.cls] = +concAt(d, s.t).toFixed(3);
    s.samples.push({
      t: +s.t.toFixed(3), logL: Math.log10(Math.max(1e-2, loadOf(s))),
      T: +((s.T / T0_VIRUS)).toFixed(4), ifn: +s.imm.ifn.toFixed(3), cd8: +s.imm.cd8.toFixed(3),
      ab: +s.imm.ab.toFixed(3), temp: +s.host.temp.toFixed(2), inf: +infCurve(s).toFixed(3),
      rfrac: s.isVirus ? 0 : +(s.N + s.Nr > 1 ? s.Nr / (s.N + s.Nr) : 0).toFixed(6),
      conc: concAll,
    });
    if (s.samples.length > 12000) s.samples.splice(0, s.samples.length - 12000);
  }

  function runTo(s, untilDays) {
    const target = Math.min(HORIZON, s.t + untilDays);
    let sinceSample = 0;
    const n = Math.max(1, Math.round((target - s.t) / DT));
    for (let i = 0; i < n && s.t < target - 1e-9; i++) {
      step(s, DT);
      sinceSample += DT;
      if (sinceSample >= SAMPLE_EVERY - 1e-9) { samplePush(s); sinceSample = 0; }
    }
    if (!s.samples.length || s.samples[s.samples.length - 1].t < s.t - 1e-9) samplePush(s);
  }

  // ---------------- 对外 API ----------------
  const Host = {
    DRUGS, micOf, DT, HORIZON,
    state() { return this._s || null; },
    setup(pathogenId, opts) {
      const C = G.PathoCatalog;
      const entry = C && (C.get(pathogenId) || null);
      if (!entry) return null;
      if (!opts || !opts.keep) this._s = freshState(entry, opts);
      const s = this._s;
      if (opts && opts.immunity === 'vaccinated') s.imm.ab = 0.55;
      if (opts && opts.immunity === 'prior') { s.imm.mem = 1; s.imm.cd8 = 0.3; s.imm.ab = 0.4; }
      if (opts && opts.immunity === 'immunosuppressed') s.imm.supp = 0.6;
      if (opts && opts.seed !== undefined) s.seed = opts.seed;
      if (opts && opts.resFold !== undefined) s.resFold = opts.resFold;
      return s;
    },
    inoculate(logDose, route) {
      let s = this._s;
      if (!s) return null;
      const dose = Math.pow(10, clamp(Number(logDose) || 3, -1, 12));
      // 再感染: 清除后再次接种, 免疫记忆保留, 清除时间戳复位
      s.host.clearedAt = -1;
      s.host.clearLowT = 0;
      s.host.extinguished = false;
      if (s.isVirus) { s.V = dose; s.I = 0; if (s.V < s.T * 1e-6) s.T = T0_VIRUS; }
      else {
        // 现存变异: 接种物中即带耐药株(丰度 ≈ 突变供给/适应度代价),
        // 选择压的对象是它们, 而不是"给药后才凭空冒出来的突变"
        s.N = dose;
        s.Nr = dose * 2.5e-8;
      }
      s.inoculated = true; s.peak = Math.max(s.peak, 0);
      if (s.drugs.length) { /* 既有给药计划保留 */ }
      samplePush(s);
      return s;
    },
    dose(clsOrName, mg, intervalH, days) {
      const s = this._s;
      if (!s) return null;
      const key = DRUG_ALIAS[clsOrName] || String(clsOrName || '').trim();
      const drug = DRUGS[key] || DRUGS[String(key).toLowerCase()];
      if (!drug) return { error: '未知药物类别 ' + clsOrName };
      mg = clamp(Number(mg) || 500, 0.01, 5000);
      const ivH = Number(intervalH) || 0;
      const iv = ivH > 0 ? clamp(ivH, 1, 168) : 0;
      const dv = Number(days) || 0;
      const end = s.t + clamp(dv > 0 ? dv : 0.01, 0.01, 360);
      const mic = micOf(s.entry.id, key, s.resFold);
      const d = { cls: key, drug, mg, start: s.t, intervalH: iv, end, micWt: mic.wt, micRes: mic.res, fold: mic.fold, lastAbove: s.t };
      s.drugs.push(d);
      if (key === 'cort') { s.imm.supp = clamp(s.imm.supp + 0.35, 0, 0.85); }   // 激素: 免疫抑制(教学语义)
      if (key === 'ifn') { s.imm.ifn = Math.max(s.imm.ifn, 0.5); }
      return d;
    },
    setImmune(o) {
      const s = this._s;
      if (!s) return null;
      if (o.prior_exposure !== undefined || o.vaccinated !== undefined) {
        if (o.vaccinated) s.imm.ab = Math.max(s.imm.ab, 0.55);
        if (o.prior_exposure) { s.imm.mem = 1; s.imm.ab = Math.max(s.imm.ab, 0.4); }
      }
      if (o.immunosuppression !== undefined) s.imm.supp = clamp(Number(o.immunosuppression) || 0, 0, 1) * 0.9;
      if (o.passive_antibody !== undefined) {
        s.imm.ab = Math.max(s.imm.ab, clamp(Number(o.passive_antibody) || 0, 0, 1));
        this.dose('mab', 300, 0, 21);
      }
      return s;
    },
    advance(days) {
      const s = this._s;
      if (!s) return null;
      const d = clamp(Number(days) || 1, 0.05, HORIZON - s.t);
      if (d <= 0) return s;
      runTo(s, d);
      return s;
    },
    load() { const s = this._s; return s ? loadOf(s) : 0; },
    observe(series) {
      const s = this._s;
      if (!s) return '尚未载入病原体: 先 pathogen_setup / 选定目录条目。';
      const L = loadOf(s);
      const lines = [];
      lines.push(`# 时间 ${s.t.toFixed(2)}d · ${s.entry.zh}（${s.entry.id}）· tier ${s.entry.tier} · 原型 ${s.entry.arch}`);
      lines.push(`载量: ${L >= 1 ? L.toExponential(2) : L.toFixed(3)} 等效单位 (log10 ${Math.log10(Math.max(1e-2, L)).toFixed(2)}) · 峰值 log10 ${Math.log10(Math.max(1e-2, s.peak)).toFixed(2)}`);
      if (s.isVirus) lines.push(`靶细胞剩余 ${(s.T / T0_VIRUS * 100).toFixed(0)}% · 累计感染 ${(s.cumInfCells * 100).toFixed(1)}%`);
      else lines.push(`耐药亚群占比 ${(s.N + s.Nr > 1 ? (s.Nr / (s.N + s.Nr) * 100).toFixed(3) : '0.000')}% · 生物膜庇护 ${(s.biofilm * 100).toFixed(0)}%`);
      lines.push(`免疫: IFN ${s.imm.ifn.toFixed(2)} · CD8 ${s.imm.cd8.toFixed(2)} · Ab ${s.imm.ab.toFixed(2)} · 记忆 ${s.imm.mem > 0.5 ? '已建立' : '未建立'} · 免疫抑制 ${s.imm.supp.toFixed(2)}`);
      lines.push(`体温 ${s.host.temp.toFixed(1)}°C · 传染性指数 ${infCurve(s).toFixed(2)} · 严重进程 ${s.host.severe ? '是' : '否'}(损伤 ${s.host.dmg.toFixed(2)})`);
      if (s.drugs.length) {
        const dr = s.drugs.slice(-3).map(d => {
          const C = concAt(d, s.t);
          return `${d.cls}(MIC ${d.micWt}${d.fold ? '/R ' + d.fold + '×' : ''}) C=${C.toFixed(2)}mg/L`;
        });
        lines.push('在用药物: ' + dr.join(' · '));
      } else lines.push('在用药物: 无');
      if (s.host.clearedAt > 0) lines.push(`首次清除: 第 ${s.host.clearedAt.toFixed(1)} 天(载量 < 检测阈值且持续)`);
      lines.push(`注: 原型量级仿真(tier ${s.entry.tier}), 用于机理与相对比较, 非临床/非预测。`);
      if (series) {
        const ss = s.samples.filter((_, i) => i % Math.ceil(s.samples.length / 60) === 0).slice(-60);
        lines.push('series(t,logL,ifn,cd8,ab,temp,rfrac):');
        for (const p of ss) lines.push(`  ${p.t}\t${p.logL.toFixed(2)}\t${p.ifn.toFixed(2)}\t${p.cd8.toFixed(2)}\t${p.ab.toFixed(2)}\t${p.temp.toFixed(1)}\t${p.rfrac.toFixed(4)}`);
      }
      return lines.join('\n');
    },
  };

  G.PathoHost = Host;
})();
