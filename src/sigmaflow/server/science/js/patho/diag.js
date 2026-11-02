/* ================= 虚拟病原体 · 诊断读数层(P1) =================
 * 观测=有噪: 智能体看到的是检测报告, 不是引擎内部状态。检出限、假阴、
 * 深度不足、报告延迟都在这里出现 —— 这是"推断类任务"有难度、可打分的原因。
 * 噪声由 (setup seed, 调用序号) 决定: 可复现; 引擎本体(host.js)无随机。
 */
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;

  const LOD = 100;                 // qPCR 检出下限(copies/ml 等效)
  const CT_AT_LOD = 35;            // LoD 处的标称 Ct
  const CT_SLOPE = 3.32;           // 每 log10 载量 3.32 Ct

  function seededNoise(state, sigma) {
    // mulberry32(state.seed ^ 调用序号): 同一场景重复同诊断结果
    let s = ((state.seed * 2654435761) ^ (state.diagSeed * 40503)) >>> 0;
    const n1 = r => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const u1 = Math.max(1e-9, n1()), u2 = n1();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * sigma;
  }

  const loadOf = () => Math.max(0, G.PathoHost ? G.PathoHost.load() : 0);
  const stateOf = () => (G.PathoHost ? G.PathoHost.state() : null);

  function pcr() {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未载入病原体。' };
    s.diagSeed++;
    const L = loadOf();
    const lines = [`# qPCR · ${s.entry.zh} · 采样时间 ${s.t.toFixed(2)}d`];
    if (L < LOD) {
      lines.push(`结果: <b>未检出</b>（Ct ≥ ${CT_AT_LOD + 1.5}, 检出下限 ~${LOD} copies/ml 等效）`);
      lines.push('提示: 未检出 ≠ 不存在 —— 高 Ct 区间与采样时机都可能假阴, 必要时复查或换标本部位。');
      return { ok: true, text: lines.join('\n') };
    }
    const ct = CT_AT_LOD - CT_SLOPE * (Math.log10(L) - Math.log10(LOD)) + seededNoise(s, 0.35);
    const cat = ct < 25 ? '高载量' : ct < 30 ? '中等载量' : ct < 34 ? '低载量' : '临界(接近检出限)';
    lines.push(`结果: <b>阳性</b> · Ct ${ct.toFixed(1)}（${cat}）`);
    lines.push(`估算载量: 10^${(Math.log10(L) + seededNoise(s, 0.12)).toFixed(2)} copies/ml 等效 [tier ${s.entry.tier} 量级]`);
    lines.push('提示: Ct 为相对值, 受采样质量/提取效率影响; 高 Ct 结果应结合临床与复检判断。');
    return { ok: true, text: lines.join('\n') };
  }

  function antigen() {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未载入病原体。' };
    s.diagSeed++;
    const L = loadOf();
    const sens = 1 / (1 + Math.exp(-(Math.log10(Math.max(10, L)) - 5.5) * 1.6));  // 载量越高越灵
    const pos = seededNoise(s, 100) < 0 ? false : Math.abs(seededNoise(s, 1)) < 3 * sens - 1.5; // 阈值化
    const lines = [`# 抗原快速检测 · ${s.entry.zh} · ${s.t.toFixed(2)}d`];
    lines.push(pos ? '结果: <b>阳性</b>（检测线显色）' : '结果: <b>阴性</b>（未显色）');
    lines.push(`本方法对标载量的灵敏度曲线: 该载量下检出概率约 ${(sens * 100).toFixed(0)}%${pos ? '' : ' —— 阴性与"Ct 高区间假阴"的语义一致'}`);
    lines.push('提示: 抗原检测载量敏感性低于 PCR, 临床怀疑度高时阴性不能排除。');
    return { ok: true, text: lines.join('\n') };
  }

  function culture() {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未载入病原体。' };
    s.diagSeed++;
    if (s.entry.kind === 'virus') {
      return {
        ok: true,
        text: [
          `# 培养 · ${s.entry.zh}`,
          '结果: <b>不适用</b> —— 病毒需要组织培养/细胞系实验室, 常规细菌平板不生长。',
          '请改用 qPCR(载量)或抗原检测; 病原识别用 mNGS/多重 PCR panel(后续接线)。',
        ].join('\n'),
      };
    }
    const L = loadOf();
    const drugOn = s.drugs.some(d => G.PathoHost.DRUGS[d.cls] && G.PathoHost.DRUGS[d.cls].emax > 0);
    const cfu = L >= 1 ? Math.pow(10, Math.log10(L) + 3 + seededNoise(s, 0.1)) : 0;   // CFU/ml 换算
    const lines = [`# 培养 · ${s.entry.zh} · ${s.t.toFixed(2)}d`];
    if (cfu < 1e3) {
      lines.push('结果: <b>未生长</b>（48h 平板无菌落）');
      lines.push(drugOn ? '提示: 在用抗菌药物会显著抑制培养阳性率, 建议给药前采样或停药窗口复查。' : '提示: 低菌量/采样偏差可致假阴。');
    } else {
      lines.push(`结果: <b>生长</b> · 约 ${cfu.toExponential(1)} CFU/ml 等效`);
      lines.push(drugOn ? '提示: 在抗菌药物压力下仍生长 —— 结合 MIC 面板判断是否耐药亚群被富集。' : '可送 MIC 面板/质谱鉴定(后续接线)。');
    }
    return { ok: true, text: lines.join('\n') };
  }

  function micPanel() {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未载入病原体。' };
    s.diagSeed++;
    if (s.entry.kind === 'virus' || s.entry.kind === 'prion') {
      return { ok: true, text: `# 药敏面板 · ${s.entry.zh}\n结果: 不适用 —— 病毒/朊粒不做 MIC 面板; 病毒用基因型耐药推断(分子层, 后续接线)。` };
    }
    const cls = s.entry.rxCls().filter(k => G.PathoHost.DRUGS[k] && G.PathoHost.DRUGS[k].emax > 0);
    if (!cls.length) return { ok: true, text: `# 药敏面板 · ${s.entry.zh}\n结果: 目录无可用抗菌类(以支持治疗为主)。` };
    const total = s.N + s.Nr;
    const rfrac = total > 1 ? s.Nr / total : 0;
    const lines = [`# MIC 面板 · ${s.entry.zh} · ${s.t.toFixed(2)}d · 微量肉汤稀释`];
    for (const k of cls) {
      const d = G.PathoHost.DRUGS[k];
      const mic = G.PathoHost.micOf(s.entry.id, k, s.resFold);
      // 耐药亚群 >50% 时读取到耐药表型; 1-50% 报"混合"; <1% 检不出亚群
      const read = rfrac > 0.5 ? mic.res : mic.wt;
      const series = [];
      let v = read * 0.25;
      for (let i = 0; i < 4; i++) { series.push(v); v *= 2; }
      const bkpt = d.mic * 2;   // 折点(类基准×2): S ≤ 折点 < I < 4×折点 ≤ R 量级
      const cat = mic.wt <= bkpt ? (read <= bkpt ? 'S 敏感' : (read <= bkpt * 4 ? 'I 中介/剂量依赖' : 'R 耐药')) : (read <= bkpt * 4 ? 'I 中介/剂量依赖' : 'R 耐药');
      lines.push(`· ${d.zh}(${k}): 生长终点 MIC ≈ ${read} mg/L → <b>${cat}</b>[稀释梯 ${series.map(x => x.toPrecision(2)).join('/')}]`);
      if (rfrac >= 0.01 && rfrac <= 0.5) lines.push(`  ⚠ 高稀释孔散在生长: 检出耐药亚群约 ${(rfrac * 100).toFixed(1)}%（fold ${mic.fold}×）—— 建议联合用药或提高剂量并复查`);
      else if (rfrac < 0.01 && rfrac > 0) lines.push(`  耐药亚群本底 ${(rfrac * 100).toFixed(2)}%: 常规面板不显示, 需测序(深度 ≥1000)才能量化`);
    }
    lines.push(`注: 折点为类基准量级(tier ${s.entry.tier}), 非真实 EUCAST/CLSI 判读数据。`);
    return { ok: true, text: lines.join('\n') };
  }

  function serology() {
    const s = stateOf();
    if (!s) return { ok: false, text: '尚未载入病原体。' };
    return {
      ok: true,
      text: [
        `# 血清学(IgM/IgG) · ${s.entry.zh}`,
        '结果: P2 接线中 —— 血清学需要"抗原暴露→IgM 窗口→IgG 持续"的独立模型,\n本层当前只提供 qPCR/抗原/培养/MIC 面板。',
      ].join('\n'),
    };
  }

  function run(assay, opts) {
    opts = opts || {};
    switch (String(assay || 'pcr')) {
      case 'pcr': return pcr();
      case 'antigen': return antigen();
      case 'culture': return culture();
      case 'mic_panel': return micPanel();
      case 'panel': return { ok: true, text: [pcr().text, culture().text, micPanel().text].join('\n\n') };
      case 'serology': return serology();
      default: return { ok: false, text: '未知检测: ' + assay + '（可用 pcr/antigen/culture/mic_panel/panel）' };
    }
  }

  G.PathoDiag = { run, LOD };
})();
