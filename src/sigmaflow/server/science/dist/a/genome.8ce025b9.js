/* ================= 虚拟病原体 · 分子/基因组层(P2) =================
 * 真值与读数分离: 引擎与样本持"真值"(谱系变异 + 耐药决定簇的真实 AF),
 * 工具只能拿到"测序读数"—— 由深度决定的检出率、AF 估计噪声、测序错误
 * 假阳全在这里。分子层的铁律: 基因组不落地, 序列由 (病原体, 基因) 哈希
 * 确定性生成; 同种子同读数, 复现即复算。
 */
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;

  // ---------------- 确定性随机 ----------------
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
  const gauss = (r) => {
    const u1 = Math.max(1e-9, r()), u2 = r();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  // ---------------- 基因座图式(按原型) ----------------
  const VIR_NAMING = {
    v_ssRNA_seg: ['HA 血凝素', 'NA 神经氨酸酶', 'PB2 聚合酶亚基', 'PB1 聚合酶亚基', 'PA 聚合酶亚基', 'NP 核蛋白', 'M 基质/离子通道', 'NS 非结构蛋白'],
    v_ssRNA_p: ['Spike 刺突蛋白', 'RdRp RNA依赖RNA聚合酶', 'N 核衣壳', 'M 膜蛋白', 'E 包膜蛋白', 'NSP3', 'NSP6', 'NSP15'],
    v_ssRNA_n: ['G 糖蛋白', 'L 大聚合酶', 'N 核蛋白', 'P 磷酸化蛋白', 'M 基质', 'SH 小疏水蛋白'],
    v_dsRNA: ['VP1 聚合酶', 'VP2 衣壳', 'VP4 蛋白酶', 'VP6 内衣壳', 'VP7 外衣壳', 'NSP4'],
    v_ssDNA: ['VP1 衣壳', 'VP2 衣壳', 'NS1'],
    v_dsDNA: ['gB 糖蛋白', 'gD 糖蛋白', 'DNApol DNA聚合酶', 'TK 胸苷激酶', '主要衣壳蛋白', 'IE 即刻早期基因'],
    v_rtDNA: ['S 表面抗原', 'P 聚合酶', 'C 核心蛋白', 'X'],
    v_rtna: ['Env 包膜糖蛋白', 'Gag 核衣壳', 'Pol 聚合酶', '蛋白酶/逆转录酶', 'Vif/Nef 调节'],
  };
  const BAC_LOCI = {
    b_gp: ['pbpA 青霉素结合蛋白', 'gyrA DNA旋转酶', 'rpoB RNA聚合酶β', 'rpsL 核糖体蛋白S12', 'dltD D-丙氨酸', 'agr 群体感应', 'hla 毒力因子', 'spa 表面蛋白A', 'femA 细胞壁合成', 'katG 过氧化氢酶', 'mepA 金属蛋白酶', 'plasmid repA 质粒复制'],
    b_gn: ['gyrA DNA旋转酶', 'parC 拓扑异构酶IV', 'rpoB RNA聚合酶β', 'ompF 孔道蛋白', 'ompC 孔道蛋白', 'acrAB 外排泵', 'ramA 外排调节子', 'intI1 整合子', 'blaAmpC β-内酰胺酶(染色体)', 'fimH 菌毛黏附', 'plasmid IncF 质粒', 'tolA 胞质间', 'waaL 脂多糖连接酶'],
    b_cocci: ['pbp1 青霉素结合蛋白', 'pbp2 青霉素结合蛋白', 'gyrA DNA旋转酶', 'rpoB RNA聚合酶β', 'murE 细胞壁合成', 'lytA 自溶素', 'pspA 表面蛋白', 'nanA 神经氨酸酶'],
    b_cocciGn: ['penA 青霉素结合蛋白', 'ponA 青霉素结合蛋白', 'gyrA DNA旋转酶', 'porB 孔道蛋白', 'mtrR 外排调节', 'opa 外膜蛋白', 'plasmid repB 质粒'],
    b_intra: ['16S rRNA', '23S rRNA', 'ompM 外膜蛋白', 'pmpD 膜蛋白', 'ftsZ 细胞分裂', 'incA 包涵体膜'],
    b_tb: ['katG 过氧化氢酶', 'inhA 脂肪酸合成酶', 'rpoB RNA聚合酶β', 'pncA 吡嗪酰胺酶', 'embB 阿拉伯糖转移酶', 'gyrB DNA旋转酶', 'rpsL 核糖体蛋白', 'ahpC 烷基过氧化物还原酶'],
    b_anaero: ['16S rRNA', 'tpiA 丙糖磷酸异构酶', 'rpoB RNA聚合酶β', 'cpe 肠毒素', 'gyrA DNA旋转酶', 'plasmid pCP13'],
    b_spiro: ['flaB 鞭毛蛋白', 'ospC 外表面蛋白', 'bmpA 膜蛋白', '16S rRNA', 'tpn47 外膜蛋白'],
  };
  const EUK_LOCI = {
    f_yeast: ['ERG11 麦角固醇合酶', 'FKS1 β-葡聚糖合酶', 'CDR1 外排泵', 'MDR1 外排泵', 'MRR1 外排调节', 'CAP1 应答因子'],
    f_mold: ['cyp51A 甾醇14α-去甲基化酶', 'FKS1 β-葡聚糖合酶', 'M88 检测位点', 'HSP90 热休克蛋白'],
    f_dimorphic: ['ERG11 甾醇合酶', 'FKS1 β-葡聚糖合酶', 'URA5 嘧啶合成', 'BAD1 / YPS3 侵袭相关'],
    p_apicomplexa: ['kelch13 环状体蛋白', 'pfcrt 氯喹抗性转运体', 'pfmdr1 MDR 转运体', 'dhfr 二氢叶酸还原酶', 'dhps 二氢蝶酸合酶', 'cytB 细胞色素b'],
    p_flagellate: ['18S rRNA', 'POLO-like激酶', '氨甲蝶呤抗性基因', '细胞色素氧化酶', '表面糖蛋白 gp63'],
    p_amoeba: ['18S rRNA', 'SSU rRNA', '半胱氨酸蛋白酶基因', '凝集素基因'],
    p_microspora: ['18S rRNA', 'RNA聚合酶II大亚基', 'tubulin-β'],
    h_nema: ['β-tubulin-1', 'β-tubulin-2', '18S rRNA', '烟碱受体亚基', 'P-糖蛋白'],
    h_cestode: ['β-tubulin', 'cox1 线粒体', 'nad1 线粒体', 'ITS rRNA'],
    h_trema: ['β-tubulin', 'cox1 线粒体', 'ITS rRNA', '28S rRNA'],
  };
  // 每类药物的耐药决定簇: 位点, 突变名, 机制类别 —— 与 host.DRUGS 的 emax>0 类一一对应
  const DETERMINANT = {
    bl:    { locus: 'pbpA/青霉素结合蛋白', change: 'PBP 重构插入片段', mech: '靶点修饰(PBP 亲和力↓)' },
    blsi:  { locus: '质粒 bla 酶', change: '获得 TEM/SHV/CTX-M 型 ESBL', mech: '获得基因(β-内酰胺酶)' },
    car:   { locus: '质粒碳青霉烯酶', change: '获得 KPC/NDM 型碳青霉烯酶', mech: '获得基因(碳青霉烯酶)' },
    gly:   { locus: '肽聚糖合成操纵子', change: 'vanA 操纵子(质粒)', mech: '靶点替换(D-Ala-D-Lac)' },
    oxa:   { locus: '23S rRNA', change: 'G2576T', mech: '靶点修饰(核糖体甲基化)' },
    mac:   { locus: '23S rRNA', change: 'A2059G', mech: '靶点修饰(核糖体)' },
    tet:   { locus: '16S rRNA / tetM', change: '获得 tetM 保护蛋白', mech: '获得基因(核糖体保护)' },
    ag:    { locus: '16S rRNA / 甲基化酶', change: '获得 16S 甲基化酶', mech: '靶点修饰(甲基化)' },
    fq:    { locus: 'gyrA / parC', change: 'gyrA S83L + parC E84K', mech: '靶点修饰(QRDR)' },
    sul:   { locus: 'dhfr/dhps', change: '获得 sul1-sul2 / dfr', mech: '获得基因(替代酶)' },
    chl:   { locus: 'cat 基因', change: '获得 cat 乙酰转移酶', mech: '获得基因(失活酶)' },
    linc:  { locus: '23S rRNA', change: 'C2611T', mech: '靶点修饰' },
    dap:   { locus: 'mprF / mprF 调节', change: 'mprF L341F + 操纵子上调', mech: '细胞膜电荷改变' },
    str:   { locus: '23S rRNA / acrAB', change: 'acrAB 上调 + VgaA', mech: '外排上调' },
    col:   { locus: 'pmrAB / pmrC', change: 'pmrB 突变(LPS 修饰)', mech: '靶点修饰(LPS)' },
    mnz:   { locus: 'nim 基因 / rdxA', change: 'nim 失活基因(质粒)', mech: '获得基因(还原失活)' },
    rif:   { locus: 'rpoB', change: 'rpoB S531L', mech: '靶点修饰(RNA聚合酶)' },
    inh:   { locus: 'katG', change: 'katG S315T', mech: '靶点失活(过氧化物酶)' },
    pza:   { locus: 'pncA', change: 'pncA 移码/错义', mech: '酶失活(吡嗪酰胺酶)' },
    emb:   { locus: 'embB', change: 'embB M306V', mech: '靶点修饰(阿拉伯糖转移酶)' },
    tgc:   { locus: 'tetM 类扩展 / 16S rRNA', change: '16S rRNA 保护蛋白变异', mech: '靶点保护扩展' },
    ampho: { locus: 'ERG11 / FKS1', change: 'ERG11 过表达 + FKS1 热点突变', mech: '靶点替换/量上调' },
    azole: { locus: 'cyp51A', change: 'cyp51A 启动子 TR34 + L98H', mech: '靶点修饰+过表达' },
    echino: { locus: 'FKS1', change: 'FKS1 S639P 热点', mech: '靶点修饰(β-葡聚糖合酶)' },
    flucyt: { locus: 'FUR1/FCY1', change: 'FUR1 突变', mech: '酶失活' },
    art:   { locus: 'kelch13', change: 'kelch13 C580Y', mech: '环清除延迟(半衰期扩展)' },
    cq:    { locus: 'pfcrt', change: 'pfcrt K76T', mech: '药物外排(食物泡)' },
    mfq:   { locus: 'pfmdr1', change: 'pfmdr1 扩增 N86Y', mech: '外排泵变异' },
    pq:    { locus: '线粒体 cytB', change: 'cytB Y268C', mech: '靶点修饰' },
    atov:  { locus: 'cytB', change: 'cytB Y268S', mech: '靶点修饰(电子传递)' },
    parom: { locus: '16S rRNA', change: '获得 SAT/APH 酶', mech: '获得基因(失活酶)' },
    pent:  { locus: '线粒体 AXP', change: 'AXP 连接酶变异', mech: '靶点修饰' },
    eflor: { locus: '蛋氨酸合酶', change: '蛋氨酸合酶变异', mech: '靶点修饰' },
    suram: { locus: '表面糖蛋白', change: 'VSG 交换变异', mech: '抗原变异' },
    melar: { locus: 'P2 嘌呤转运体', change: 'AT 无效转运', mech: '摄取障碍' },
    nifurt: { locus: '硝基还原酶 NTR', change: 'NTR 表达缺失', mech: '活化途径丢失' },
    nitaz: { locus: '硝基还原酶', change: '硝基还原酶变异', mech: '活化途径丢失' },
    dap2:  { locus: 'folP1', change: 'folP1 突变', mech: '靶点修饰(DHPS)' },
    clof:  { locus: 'rpoB', change: 'rpoB S531L', mech: '靶点修饰(RNA聚合酶)' },
    sb:    { locus: 'APT1 转运体', change: 'APT1 下调突变', mech: '药物摄取障碍' },
    bzd:   { locus: 'β-tubulin-1', change: 'β-tubulin F200Y', mech: '靶点修饰(微管)' },
    praz:  { locus: 'TRP 通道', change: '瞬时受体电位通道变异', mech: '靶点修饰(钙内流)' },
    iver:  { locus: '谷氨酸门控氯通道', change: 'GluCl S298L', mech: '靶点修饰(氯通道)' },
    pyr:   { locus: '烟碱受体', change: 'nAChR 亚基变异', mech: '靶点修饰' },
    dec:   { locus: 'chitinase', change: '几丁质酶变异', mech: '靶点修饰' },
    tcbz:  { locus: 'β-tubulin', change: 'β-tubulin F200Y', mech: '靶点修饰(微管)' },
  };

  // 病毒抗病毒决定簇: 药物类→(基因, 突变名) —— 流感的 H275Y 等经典位点语义
  const VIR_DETERMINANT = {
    nai: { locus: 'NA 神经氨酸酶', change: 'NA H275Y' },
    m2: { locus: 'M 基质/离子通道', change: 'M2 S31N' },
    rdrp: { locus: 'RdRp RNA依赖RNA聚合酶', change: '聚合酶 活性中心变异' },
    pol: { locus: 'DNApol DNA聚合酶', change: 'pol 焦磷酸结合区变异' },
    rt: { locus: 'Pol 聚合酶/逆转录酶', change: 'RT M184V' },
    pi: { locus: '蛋白酶/逆转录酶', change: '蛋白酶 D30N' },
    inst: { locus: 'Pol 聚合酶', change: '整合酶 R263K' },
    fus: { locus: 'Env 包膜糖蛋白', change: 'gp41 融合区变异' },
    ifn: { locus: 'NS 非结构蛋白', change: 'IFN 应答逃逸变异' },
    ns5: { locus: 'NS5A/NS5B 直接抗病毒', change: 'NS5A Y93H' },
    rib: { locus: 'RdRp RNA依赖RNA聚合酶', change: '聚合酶 变异' },
    tec: { locus: 'DNApol DNA聚合酶', change: 'pol 变异' },
    mab: { locus: 'Spike/表面蛋白', change: '表位逃逸突变' },
    ivig: { locus: '表面糖蛋白', change: '表位逃逸突变' },
  };

  function lociFor(entry) {
    const r = rng(hash32('loci::' + entry.id));
    const out = [];
    const names = entry.kind === 'virus' ? (VIR_NAMING[entry.arch] || VIR_NAMING.v_ssRNA_p)
      : (BAC_LOCI[entry.arch] || EUK_LOCI[entry.arch] || ['看家基因A', '看家基因B', '核糖体 RNA']);
    names.forEach((name, i) => {
      const surface = i === 0 || (entry.kind === 'virus' && i === 1 && String(name).match(/HA|NA|Spike|糖蛋白|Env/));
      const gene = String(name).split(' ')[0];
      out.push({
        gene, name, i,
        len: 300 + Math.floor(r() * 2200),
        // 表位密度: 表面/分泌蛋白高; tol=0 处变异不受容(保守)
        epi: surface ? 3 + Math.floor(r() * 4) : 0,
        tol: 0.3 + r() * 0.7,
      });
    });
    return out;
  }

  function windowOf(entry, gene, pos, len) {
    // 确定性伪序列窗口: 同 (病原体, 基因, 位置) 恒同
    const r = rng(hash32(entry.id + '::' + gene + '::w' + Math.floor(pos / 60)));
    const bases = 'ACGT';
    let s = '';
    for (let i = 0; i < len; i++) s += bases[Math.floor(r() * 4)];
    return s;
  }

  // ---------------- 表位窗口(单一事实源: escape/vaccine/lineage 共用) ----------------
  function epitopes(entry, loci) {
    const out = [];
    for (const l of loci) {
      if (!l.epi) continue;
      for (let k = 0; k < l.epi; k++) {
        const r = rng(hash32(entry.id + '::epi::' + l.gene + '::' + k));
        out.push({ gene: l.gene, start: 20 + Math.floor(r() * (l.len - 60)), width: 12 + Math.floor(r() * 10) });
      }
    }
    return out;
  }

  // ---------------- 谱系变异(真值的一部分) ----------------
  // 前 2 个变异刻意落进表位窗口(逃逸信号), 其余散布在中性位点。
  function lineageOf(entry, loci, seed) {
    const r = rng(hash32('lineage::' + entry.id + '::' + seed));
    const n = 3 + Math.floor(r() * 5);
    const eps = epitopes(entry, loci);
    const variants = [];
    for (let k = 0; k < n; k++) {
      const bases = 'ACGT';
      let gene, pos;
      if (k < 2 && eps.length) {
        const ep = eps[Math.floor(r() * eps.length)];
        gene = ep.gene; pos = ep.start + Math.floor(r() * ep.width);
      } else {
        const loc = pick(r, loci);
        gene = loc.gene; pos = 40 + Math.floor(r() * (loc.len - 80));
      }
      const ref = pick(r, bases.split(''));
      let alt = pick(r, bases.split(''));
      if (alt === ref) alt = 'ACGT'[(bases.indexOf(ref) + 1) % 4];
      variants.push({ gene, pos, ref, alt, class: 'lineage', inEpitope: k < 2 && eps.some(e => e.gene === gene && pos >= e.start && pos <= e.start + e.width) });
    }
    return variants;
  }

  // ---------------- 模块状态 ----------------
  function stateOf() {
    const s = G.PathoHost && G.PathoHost.state();
    return s;
  }
  function ensure(s) {
    if (!s.mol) {
      const loci = lociFor(s.entry);
      s.mol = {
        loci,
        lineage: lineageOf(s.entry, loci, s.seed),
        accPrivate: [],    // 宿主内演化: 已固定的私有变异, 后续样本全部携带
        lastSampleT: 0,
        samples: [],       // {id,label,t,depth,truth:{lineage,private,dets,load},calls}
      };
    }
    return s.mol;
  }
  function resetAll(s) { if (s) s.mol = null; }
  const origSetup = G.PathoHost && G.PathoHost.setup;
  if (G.PathoHost) {
    const prevSetup = G.PathoHost.setup;
    G.PathoHost.setup = function (id, opts) { const st = prevSetup.call(this, id, opts || {}); if (st) st.mol = null; return st; };
  }

  // ---------------- 测序 ----------------
  function sequence(args) {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未设置场景(pathogen_setup)。' };
    const mol = ensure(s);
    const load = s.isVirus ? s.V : (s.N + s.Nr);
    const id = args.label ? String(args.label) : ('S' + (mol.samples.length + 1));
    if (s.entry.kind === 'prion') return { ok: false, text: '朊粒没有核酸基因组——测序不适用; 用蛋白错误折叠扩增(说明见分子层文档)之外, 本环境不提供该检测。' };
    if (load < 200) return { ok: false, text: `载量不足(≈${load < 1 ? 0 : load.toFixed(0)} 等效单位): qPCR 检出限以下, 测序建库失败。先回到宿主内层推进时间或提高接种剂量。` };
    const depth = Math.max(50, Math.min(200000, Number(args.depth) || 1000));
    const r = rng(hash32('seq::' + s.entry.id + '::' + s.seed + '::' + id + '::' + s.diagSeed));
    s.diagSeed++;

    // 真值快照: 谱系变异 + 各耐药决定簇当前 AF
    const clss = s.entry.rxCls().filter(k => G.PathoHost.DRUGS[k] && G.PathoHost.DRUGS[k].emax > 0);
    const dets = [];
    if (s.isVirus) {
      for (const cls of clss) {
        const d = G.PathoHost.DRUGS[cls];
        if (!d.vir) continue;
        const vd = VIR_DETERMINANT[cls];
        if (!vd) continue;
        dets.push({ cls, locus: vd.locus, change: vd.change, af: s.drAf[cls] || 0, mech: '靶点修饰(抗病毒耐药)' });
      }
    } else {
      const tot = s.N + s.Nr;
      const rfrac = tot > 1 ? s.Nr / tot : 0;
      for (const cls of clss) {
        const det = DETERMINANT[cls];
        if (!det) continue;
        dets.push({ cls, locus: det.locus, change: det.change, mech: det.mech, af: rfrac });
      }
    }
    // 分子钟: 自上次采样以来新固定的私有 SNP(2 天约 1 个, 确定性泊松近似)
    const dtDays = Math.max(0, s.t - (mol.lastSampleT || 0));
    const newPriv = Math.max(0, Math.round(dtDays * 0.55 * (0.6 + r() * 0.8) - 0.3));
    for (let k = 0; k < newPriv; k++) {
      const loc = pick(r, mol.loci);
      const pos = 20 + Math.floor(r() * (loc.len - 40));
      mol.accPrivate.push({ gene: loc.gene, pos, ref: 'G', alt: 'A', class: 'private', t: s.t });
    }
    mol.lastSampleT = s.t;
    const truth = { lineage: mol.lineage, private: mol.accPrivate.slice(), dets, load: +load };   // load: 采样时真值载量(培养/panel 阳性判据)
    const calls = [];
    // 谱系变异 + 已固定私有变异: AF≈1
    for (const v of truth.lineage) calls.push({ ...v, af: 1 - r() * 0.01 });
    for (const v of truth.private) calls.push({ ...v, af: 0.95 + r() * 0.04 });   // 私有变异: 随宿主内演化逐步固定
    // 决定簇: AF 估计噪声 ∝ 1/sqrt(depth·AF); 检出阈 2.5 read
    for (const d of truth.dets) {
      if (d.af <= 0) continue;
      // 二项检出铁律: 支持 read 数 ~ depth×AF, 少于 2.5 条就被"藏"在读数下 -
      // 低深度永远看不到低频亚群, 这正是深度与假阴的核心教学点。
      if (d.af * depth < 2.5) continue;
      const sig = 1 / Math.sqrt(Math.max(1, depth * d.af));
      const afHat = Math.max(0, Math.min(1, d.af * (1 + gauss(r) * sig)));
      calls.push({ gene: d.locus.split(' ')[0], pos: 100 + Math.floor(r() * 500), ref: 'C', alt: 'T', class: 'det', cls: d.cls, af: afHat, truthAf: d.af });
    }
    // 测序错误假阳: 1-3 个低频噪声
    const nErr = 1 + Math.floor(r() * 3);
    for (let i = 0; i < nErr; i++) {
      const loc = pick(r, mol.loci);
      calls.push({ gene: loc.gene, pos: 10 + Math.floor(r() * loc.len), ref: 'A', alt: 'G', class: 'lowfreq', af: 0.003 + r() * 0.005 });
    }
    calls.sort((a, b) => (a.gene < b.gene ? -1 : a.gene > b.gene ? 1 : a.pos - b.pos));
    const sample = { id, label: id, t: +s.t.toFixed(2), depth, quality: +(0.85 + r() * 0.13).toFixed(2), truth, calls };
    mol.samples.push(sample);
    return {
      ok: true,
      text: [
        `# 测序完成: 样本 ${id} · ${s.entry.zh} · t=${s.t.toFixed(1)}d · 深度 ${depth}× · 质量 ${sample.quality}`,
        `产出: ${calls.length} 个原始变异调用(含谱系位点) —— 用 pathogen_variants 过滤查看。`,
        `本深度下可检出的最低 AF 约 ${(2.5 / depth).toFixed(4)}; 低于该频率的亚群被"藏"在读数下, 结论要据此打折。`,
        `样本已保存, 可供 pathogen_resistance / pathogen_escape / pathogen_phylo / pathogen_trace 分析。`,
      ].join('\n'),
    };
  }

  function variants(args) {
    const s = stateOf();
    if (!s || !s.mol) return { ok: false, text: '没有可用样本: 先 pathogen_sequence。' };
    const sample = s.mol.samples.find(x => x.id === String(args.sample || '')) || s.mol.samples[s.mol.samples.length - 1];
    if (!sample) return { ok: false, text: '没有可用样本: 先 pathogen_sequence。' };
    const minAf = args.min_af !== undefined ? Number(args.min_af) : 0.02;
    const lines = [`# 变异谱 · 样本 ${sample.id} · 深度 ${sample.depth}× · 最小 AF=${minAf.toFixed(3)}`];
    let shown = 0;
    for (const c of sample.calls) {
      const cls = c.class === 'det' ? `耐药决定簇(${c.cls})` : c.class === 'lineage' ? '谱系标记' : c.class === 'private' ? `谱系私有(t=${c.t.toFixed(0)}d 固定)` : '低频(可能为测序错误)';
      if (c.af >= minAf) {
        lines.push(`· ${c.gene} p.${c.pos} ${c.ref}>${c.alt} AF=${(c.af * 100).toFixed(2)}% [${cls}]`);
        shown++;
      }
    }
    lines.push(`共显示 ${shown}/${sample.calls.length} 个调用; 未显示的低于阈值(含可能存在的真实低频亚群)。`);
    lines.push('提示: 用 pathogen_resistance 看机制注释与表型预测, 用更高的深度重新测序可以看到更低频的亚群。');
    return { ok: true, text: lines.join('\n') };
  }

  // 多重 PCR panel 目标清单(现实教学: panel 只报覆盖内目标, 覆盖外=漏检)。
  const PANELS = {
    respiratory: { name: '呼吸道 17 联', targets: ['InfluenzaA', 'InfluenzaB', 'SARS_CoV_2', 'SeasonalCorona', 'RSV', 'Parainfluenza', 'Rhinovirus', 'Adenovirus', 'SARS_CoV', 'S_pneumoniae', 'K_pneumoniae', 'H_influenzae_b', 'M_pneumoniae', 'C_pneumoniae', 'L_pneumophila', 'M_tuberculosis', 'Pneumocystis'] },
    gastro: { name: '胃肠道 15 联', targets: ['Rotavirus', 'Norovirus', 'Astrovirus', 'Adenovirus', 'E_coli_EHEC', 'E_coli_ETEC', 'Salmonella_Typhi', 'Salmonella_NTS', 'Shigella', 'Campylobacter', 'V_cholerae', 'C_difficile', 'Cryptosporidium', 'Giardia', 'E_histolytica'] },
    bloodstream: { name: '血流/脓毒症 7 联', targets: ['S_aureus', 'E_coli', 'K_pneumoniae', 'S_pneumoniae', 'S_agalactiae', 'N_meningitidis', 'Salmonella_Typhi'] },
    cns: { name: '中枢神经系统 9 联', targets: ['HSV1', 'HSV2', 'S_pneumoniae', 'N_meningitidis', 'S_agalactiae', 'E_coli', 'K_pneumoniae', 'VZV', 'P_falciparum'] },
  };

  function identify(args) {
    const s = stateOf();
    if (!s || !s.mol) return { ok: false, text: '没有可用样本: 先 pathogen_sequence。' };
    const sample = s.mol.samples.find(x => x.id === String(args.sample || '')) || s.mol.samples[s.mol.samples.length - 1];
    if (!sample) return { ok: false, text: '没有可用样本: 先 pathogen_sequence。' };
    const r = rng(hash32('id::' + s.entry.id + '::' + sample.id + '::' + s.diagSeed));
    s.diagSeed++;
    const method = String(args.method || 'mngs');
    // 采样时载量: 培养与 panel 的阳性判据(治疗收尾期采样=低载量, 结果要诚实)
    const load = (sample.truth && sample.truth.load) || 0;
    const kind = s.entry.kind;
    if (method === 'mngs') {
      // 宏基因组: 主 + 1-2 个背景/污染种
      const C = G.PathoCatalog;
      const pool = C.all().filter(e => e.id !== s.entry.id && e.kind === s.entry.kind);
      const nBg = 1 + Math.floor(r() * 2);
      const lines = [`# 病原识别(mNGS) · 样本 ${sample.id} · 读长匹配 + 分类丰度`];
      lines.push(`· <b>${s.entry.zh}</b> (${s.entry.id})  丰度 ${((86 + r() * 11)).toFixed(1)}%  置信度高(种/属级唯一读数充足)`);
      for (let i = 0; i < nBg; i++) {
        const bg = pool[Math.floor(r() * pool.length)];
        lines.push(`· ${bg.zh} (${bg.id})  丰度 ${((0.4 + r() * 1.6)).toFixed(1)}%  背景/污染可能(读数少, 低于严格阈值)`);
      }
      lines.push(`判读: 主判 ${s.entry.zh}; 低丰度读数建议用 panel 复核 —— mNGS 不能代替物种特异性确认。`);
      return { ok: true, text: lines.join('\n') };
    }
    if (method === 'panel') {
      const key = String(args.panel || 'respiratory');
      const pl = PANELS[key];
      if (!pl) return { ok: true, text: `# 病原识别(panel)
未知 panel 「${key}」。可用: ${Object.keys(PANELS).join(' / ')}(respiratory/gastro/bloodstream/cns)。` };
      const lines = [`# 病原识别(多重 PCR ${pl.name}) · 样本 ${sample.id}`];
      if (!pl.targets.includes(s.entry.id)) {
        lines.push(`· 目标清单 ${pl.targets.length} 项全部阴性(含临界复测)。`);
        lines.push(`· <b>${s.entry.zh} 不在本 panel 覆盖内 —— panel 漏检语义: 这不是"没有感染", 是"这套引物看不到它"。</b>`);
        lines.push(`建议: 换 ${kind === 'virus' ? 'respiratory/gastro 覆盖外用 mNGS' : 'mNGS(宏基因组全谱)'} 或按临床综合征补送针对性检测。`);
        return { ok: true, text: lines.join('\n') };
      }
      if (load < 100) {
        lines.push(`· ${s.entry.zh} 靶标 <b>阴性</b>(靶基因 Ct>38 未检出) —— 采样时载量 ${load < 1 ? '0' : load.toFixed(0)} 等效单位, 低于 panel 检测限。`);
        lines.push(`· 其余靶标阴性。注: 检测限下阴性 ≠ 无感染(治疗收尾期常见); 需要病因学确认请重新采样或用 mNGS。`);
        return { ok: true, text: lines.join('\n') };
      }
      const ct = Math.min(38, Math.max(12, 38 - 8 * (Math.log10(load) - 2) + (r() - 0.5) * 1.6));
      lines.push(`· <b>${s.entry.zh}</b> (${s.entry.id})  阳性 · 靶基因 Ct <b>${ct.toFixed(1)}</b>${ct > 35 ? '(临界, 建议复测确认)' : ''}`);
      lines.push(`· 其余 ${(pl.targets.length - 1)} 项靶标阴性; panel 特异性高于 mNGS(无背景种问题), 覆盖外新发病原会漏检。`);
      lines.push(`判读: Ct≈${ct.toFixed(0)} 对应采样时载量量级 —— 与宿主内层载量曲线互为印证(t=${sample.t}d)。`);
      return { ok: true, text: lines.join('\n') };
    }
    if (method === 'culture') {
      const lines = [`# 病原识别(培养) · 样本 ${sample.id}`];
      if (kind === 'virus') {
        lines.push(`· <b>无病毒生长</b> —— 常规培养皿不支持病毒复制(需活细胞/鸡胚, 本环境不提供细胞培养线)。`);
        lines.push(`· 这不是阴性报告: 病毒病原请走 qPCR 载量 / panel / mNGS / 抗原(见诊断读数层)。`);
        return { ok: true, text: lines.join('\n') };
      }
      if (kind === 'protozoa' || kind === 'helminth') {
        lines.push(`· <b>不适用</b> —— ${kind === 'protozoa' ? '原虫' : '蠕虫'}不做常规培养鉴定; 走血膜/粪检镜检或血清学(教学提示: 诊断读数层的抗原/显微镜语义)。`);
        return { ok: true, text: lines.join('\n') };
      }
      if (kind === 'prion') return { ok: true, text: '朊粒不能体外培养; 走脑组织病理 + 免疫组化(教学在分子层文档说明)。' };
      // 细菌/真菌: 生长判据 = 采样时载量; 慢生长者给真实周转时间
      const slow = { M_tuberculosis: '罗氏培养 2-6 周(液体系统 ~10 天)', Cryptococcus: '2-5 天(慢生长酵母)' };
      if (load < 500) {
        lines.push(`· 48-72h <b>无菌生长</b>(阴性) —— 采样时载量 ${load < 1 ? '0' : load.toFixed(0)} 等效单位, 接种量低于培养灵敏度(教学: 与 qPCR 检测限的差距)。`);
        lines.push(`· 提示: 抗生素使用期采样/病灶深部采样常见假阴性; 需要时停药复送或改 mNGS。`);
        return { ok: true, text: lines.join('\n') };
      }
      const grade = Math.min(4, Math.max(1, Math.round(Math.log10(load) - 2)));
      const tat = slow[s.entry.id] || (kind === 'fungus' ? '2-5 天' : '18-30 小时(过夜孵育)');
      lines.push(`· <b>${s.entry.zh}</b> (${s.entry.id})  菌落形态一致 · 生长半定量 <b>+${grade}</b>(接种量量级 10^${Math.log10(load).toFixed(0)})`);
      lines.push(`· 周转: ${tat} · 基质谱(MALDI-TOF)分值 2.1-2.3(tier ${s.entry.tier}) · 可传代做 MIC 面板(诊断读数层)。`);
      return { ok: true, text: lines.join('\n') };
    }
    return { ok: true, text: `未知 method「${method}」。可用: mngs / panel(respiratory|gastro|bloodstream|cns) / culture。` };
  }

  // ---------------- 耐药注释 ----------------
  function resistance(args) {
    const s = stateOf();
    if (!s || !s.mol || !s.mol.samples.length) return { ok: false, text: '没有可用样本: 先 pathogen_sequence。' };
    const sample = s.mol.samples.find(x => x.id === String(args.sample || '')) || s.mol.samples[s.mol.samples.length - 1];
    const wanted = (args.drugs && args.drugs.length ? args.drugs : s.entry.rxCls()).map(String);
    const lines = [`# 耐药注释 · 样本 ${sample.id} · ${s.entry.zh} · 深度 ${sample.depth}×`];
    let any = false;
    for (const cls of wanted) {
      const d = G.PathoHost.DRUGS[cls];
      const det = DETERMINANT[cls] || (s.isVirus ? VIR_DETERMINANT[cls] : null);
      if (!d || !det) continue;
      const truthDet = sample.truth.dets.find(x => x.cls === cls);
      const mic = G.PathoHost.micOf(s.entry.id, cls, s.resFold);
      const af = truthDet ? truthDet.af : 0;
      const detected = af > 2.5 / sample.depth;
      const phen = af < 0.01 ? 'S 敏感' : af < 0.5 ? 'I 混合(含耐药亚群)' : 'R 耐药';
      const readMic = af < 0.01 ? mic.wt : af < 0.5 ? `混合(野生型 ${mic.wt} / 耐药 ${mic.res})` : mic.res;
      lines.push(`· <b>${d.zh}</b>(${cls}) → ${phen}`);
      lines.push(`  机制: ${det.mech || '靶点修饰'} · 位点 ${det.locus} · ${det.change}`);
      lines.push(`  真实亚群 AF=${(af * 100).toFixed(2)}% ${detected ? `(本深度可检出)` : `(低于本深度检出限 ${(2.5 / sample.depth).toFixed(3)}, 未报)`} · 预测 MIC ${readMic} mg/L`);
      any = true;
    }
    if (!any) lines.push('（目录无可注释的药物类）');
    lines.push(`注: 本表按"决定簇存在→表型推断"合成(tier ${s.entry.tier}); 负荷分支的决定簇为共定位多药耐药(教学简化: 单一耐药亚群同时携带各类决定簇)。`);
    return { ok: true, text: lines.join('\n') };
  }

  G.PathoMol = Object.assign(G.PathoMol || {}, {
    hash32, rng, lociFor, lineageOf, epitopes, DETERMINANT, VIR_DETERMINANT,
    ensure, resetAll,
    sequence, variants, identify, resistance,
    samples() { const s = stateOf(); return s && s.mol ? s.mol.samples : []; },
    get DETERMINANT_KEY() { return Object.keys(DETERMINANT); },
  });
})();
