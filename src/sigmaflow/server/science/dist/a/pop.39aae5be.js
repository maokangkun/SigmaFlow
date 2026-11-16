/* ================= 虚拟病原体 · 群体层(P3) =================
 * 元种群双毒株 SEIR: 地区×年龄分组×(S/E_w/I_w/E_v/I_v/R/H/D), 接触矩阵
 * 同龄优先 + 地区间流动性耦合; 疫苗/隔离/检测-追踪/治疗按力度×覆盖生效;
 * 监测层引入"报告延迟 + 漏报 + 测序采样噪声" —— 智能体看到的 Rt 与变体
 * 频率是估计值。与宿主内层的耦合: 活动感染宿主的传染性曲线决定指示病例
 * 的传播权重(治疗了患者, 群体波就小)。
 * 数值: 每日欧拉(τ≥1 时稳定), 确定性; 噪声只在监测层。
 * 定位: 教学沙盒 —— 参数为量级, 不能当流行病学预测。
 */
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const AGE_W = [0.22, 0.58, 0.20];                 // 儿童/成人/老年
  const AGE_SEV = [0.15, 0.45, 1.0];                // 重症相对风险
  const AGE_CFR = [0.0005, 0.004, 0.05];
  const TAU_E = 3, TAU_I = 5, TAU_H = 12;           // 潜伏/传染期/住院日(通用量级)
  const CONTACT_RAW = [[1.6, 0.5, 0.3], [0.5, 1.0, 0.4], [0.3, 0.4, 0.8]];  // 同龄优先
  // 按谱半径归一化: 接触矩阵只重组"谁传染谁", 不放大"传多少"。不归一化会把
  // 有效 R0 整体抬高 ~2×, 疫情在十几天内烧穿, 疫苗/封控的可比性全部失真。
  const _lam = (() => {
    let v = [1 / 3, 1 / 3, 1 / 3];
    for (let k = 0; k < 50; k++) {
      const w = [0, 0, 0];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) w[i] += CONTACT_RAW[i][j] * v[j];
      const n = Math.hypot(...w);
      v = w.map(x => x / n);
    }
    const w = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) w[i] += CONTACT_RAW[i][j] * v[j];
    const n = Math.hypot(...w);
    return (v.reduce((a, x, i) => a + x * w[i], 0)) / (v.reduce((a, x) => a + x * x, 0) * n) * n;
  })();
  const CONTACT = CONTACT_RAW.map(row => row.map(x => x / _lam));
  const R0_DEFAULT = { virus: 2.5, bacterium: 1.5, fungus: 1.2, protozoan: 1.3 };

  function entryFor() {
    const s = G.PathoHost && G.PathoHost.state();
    if (s) return s.entry;
    if (G.PathoUI && G.PathoUI.currentSel) { const C = G.PathoCatalog; const e = C.get(G.PathoUI.currentSel()); if (e) return e; }
    return null;
  }

  const Pop = {
    _s: null,
    state() { return this._s; },

    init(args) {
      args = args || {};
      const entry = entryFor();
      if (!entry) return { ok: false, text: '没有病原体上下文: 先 pathogen_setup 选定目录条目(或用 pathogen_catalog 查)。' };
      if (entry.kind === 'prion') return { ok: false, text: '朊粒在人群里没有持续人传人传播(除散发/医源), 元种群 SEIR 不适用 —— 用临床与监测视角教学。' };
      const nR = clamp(Math.round(Number(args.regions) || 3), 1, 12);
      const N = clamp(Number(args.population) || 1e6, 10000, 1e8);
      const mobility = clamp(Number(args.mobility) !== 0 ? Number(args.mobility) || 0.1 : 0, 0, 1);
      // R0: 目录区间中值优先, 否则按大类默认
      let r0;
      if (entry.r0) r0 = (entry.r0.lo + entry.r0.hi) / 2;
      else r0 = R0_DEFAULT[entry.kind] || 1.5;
      // 宿主内耦合: 活动感染且传染性曲线高 → 指示病例早期传播权重更高
      const hostS = G.PathoHost && G.PathoHost.state();
      let srcInf = 0, coupled = false;
      if (hostS && hostS.entry.id === entry.id && hostS.inoculated && !hostS.host.extinguished) {
        const sm = hostS.samples;
        if (sm && sm.length) { srcInf = sm[sm.length - 1].inf; coupled = true; }
      }
      const comp = [];
      const per = N / nR;
      for (let r = 0; r < nR; r++) {
        const row = [];
        for (let a = 0; a < 3; a++) {
          const pop = per * AGE_W[a];
          row.push({ S: pop, E1: 0, I1: 0, E2: 0, I2: 0, R: 0, H: 0, D: 0, V: 0 });
        }
        comp.push(row);
      }
      let i0 = clamp(Math.round(Number(args.initial_cases) || 50), 1, 100000);
      // 宿主耦合: 活动感染宿主的传染性决定这批种子病例的"有效规模"
      // (未治疗的高排毒指示病例 = 更多继发感染; 治疗压低排毒 = 种子效力更弱)
      if (coupled) i0 = Math.max(1, Math.round(i0 * (0.3 + 1.4 * srcInf)));
      const c0 = comp[0];
      c0[1].I1 = Math.min(i0 * 0.7, c0[1].S); c0[1].S -= c0[1].I1;
      c0[2].I1 = Math.min(i0 * 0.3, c0[2].S); c0[2].S -= c0[2].I1;
      this._s = {
        entry, t: 0, nR, N, mobility,
        beta: r0 / TAU_I,
        r0, comp,
        fg: { S: 1 },
        interventions: [],
        campaigns: [],
        sample: [],
        variantIntro: 20,           // 变异株引入日
        variant: { adv: 1.25, escape: 0.35, sev: 1.2, seeded: false },
        coupled, srcInf: coupled ? srcInf : 0,
        horizon: 720,
      };
      this.pushSample(0);
      return {
        ok: true,
        text: [
          `# 群体模型已就绪: ${entry.zh}（${entry.id}, tier ${entry.tier}）`,
          `规模 ${N.toLocaleString()} · ${nR} 个地区 · 三年龄组(22/58/20%) · 流动性 ${mobility}`,
          `R0 取 ${r0.toFixed(1)}${entry.r0 ? '（目录区间中值）' : '（大类默认）'} · 传染期 ${TAU_I}d · 变异株 t=20d 引入(传播优势 1.25× / 免疫逃逸 0.35 / 重症 1.2×)`,
          coupled ? `宿主内耦合: 当前指示病例传染性指数 ${srcInf.toFixed(2)} —— 宿主治疗效果会改变早期传播动力学` : '宿主内耦合: 未检测到活动感染(指示病例按普通病例处理)',
          `下一步: pathogen_intervene / pathogen_vaccinate 设干预, pathogen_advance 推进(宿主内层工具共用), pathogen_pop_observe 观测。`,
        ].join('\n'),
      };
    },

    // ---- 干预与疫苗 ----
    intervene(args) {
      const s = this._s;
      if (!s) return { ok: false, text: '先 pathogen_pop_init。' };
      const KIND = { mask: '口罩(β×(1−0.35x))', distancing: '限聚(β×(1−0.30x))', school: '停课(儿童接触×(1−0.40x))', lockdown: '封控(β×(1−0.55x), 流动↓)', travel: '旅行限制(流动×(1−0.60x))', tti: '检测-追踪-隔离(传染期缩短)', treatment: '抗微生物治疗(传染期↓ 重症↓)' };
      const kind = String(args.kind || '');
      if (!KIND[kind]) return { ok: false, text: '未知干预: ' + kind + '（可用 ' + Object.keys(KIND).join('/') + '）' };
      const strength = clamp(Number(args.strength) || 0.5, 0, 1);
      const coverage = clamp(Number(args.coverage) === 0 ? 1 : Number(args.coverage) || 0.6, 0, 1);
      const start = Number(args.start_day) || 0;
      const end = Number(args.end_day) || 180;
      s.interventions.push({ kind, eff: strength * coverage, start, end });
      return { ok: true, text: `干预已排程: <b>${KIND[kind]}</b> 力度${(strength * coverage).toFixed(2)}(强度${strength}×覆盖${coverage}) t=${start}–${end}d。紧随其后用 pathogen_advance 推进看效果。` };
    },

    vaccinate(args) {
      const s = this._s;
      if (!s) return { ok: false, text: '先 pathogen_pop_init。' };
      const coverage = clamp(Number(args.coverage) === 0 ? 0.6 : Number(args.coverage) ?? 0.6, 0, 1);
      const efficacy = clamp(Number(args.efficacy) === 0 ? 0.8 : Number(args.efficacy) ?? 0.85, 0, 1);
      const start = Number(args.start_day) || 0;
      const allocation = String(args.allocation || 'age');
      s.campaigns.push({ coverage, efficacy, start, dur: 60, allocation });
      const blocked = coverage * efficacy;
      return {
        ok: true,
        text: [
          `疫苗接种计划: 覆盖 ${(coverage * 100).toFixed(0)}% × 保护力 ${(efficacy * 100).toFixed(0)}% → 人群阻断比例 ${blocked.toFixed(2)}(分配: ${allocation})`,
          `对野生株: 阈值 R0${s.r0.toFixed(1)} 需要 1−1/R0 = ${(1 - 1 / s.r0).toFixed(2)} 才能压 Rt<1${blocked >= 1 - 1 / s.r0 ? ' —— 本计划可达成(野生株)' : ' —— 尚不足以单独压平, 需配合 NPI 或提高覆盖'}`,
          `对逃逸株: 变异株 escape=0.35, 疫苗阻断按 (1−0.35) 打折 —— 覆盖率要按更高目标设计。投放 60 天爬坡, t=${start}d 起。`,
        ].join('\n'),
      };
    },

    // ---- 动力学 ----
    effMask(s, t) {
      let m = 1, mob = s.mobility, childCut = 1, tauCut = 1, sevCut = 1;
      for (const iv of s.interventions) {
        if (t < iv.start || t > iv.end) continue;
        const x = iv.eff;
        if (iv.kind === 'mask') m *= 1 - 0.35 * x;
        if (iv.kind === 'distancing') m *= 1 - 0.30 * x;
        if (iv.kind === 'school') childCut = 1 - 0.40 * x;
        if (iv.kind === 'lockdown') { m *= 1 - 0.55 * x; mob *= 1 - 0.6 * x; }
        if (iv.kind === 'travel') mob *= 1 - 0.60 * x;
        if (iv.kind === 'tti') tauCut *= 1 - 0.35 * x;
        if (iv.kind === 'treatment') { tauCut *= 1 - 0.20 * x; sevCut *= 1 - 0.25 * x; }
      }
      return { m, mob, childCut, tauCut, sevCut };
    },
    vaccRate(s, t) {
      let v = 0;
      for (const c of s.campaigns) {
        if (t < c.start || t > c.start + c.dur) continue;
        v += c.coverage * c.efficacy / c.dur;
      }
      return Math.min(0.05, v);
    },
    step(dt) {
      const s = this._s;
      const E = this.effMask(s, s.t);
      const vRate = this.vaccRate(s, s.t);
      const tauI = Math.max(1.2, TAU_I * E.tauCut);
      // 变异株引入: 在引入日给区域 0 注入少量暴露者(≈现感染量的 0.5% + 保底),
      // 之后靠传播优势与免疫逃逸竞争 —— 没有这个注入, lamV 恒 0, 变体永远出不来。
      if (!s.variant.seeded && s.t >= s.variantIntro) {
        s.variant.seeded = true;
        const c00 = s.comp[0][1];
        const inj = 3 + Math.round(c00.I1 * 0.005);
        const moved = Math.min(inj, c00.E1 + c00.I1 * 0.05, c00.S);
        c00.S -= moved; c00.E2 += moved;
      }
      for (let r = 0; r < s.nR; r++) {
        const row = s.comp[r];
        // 流动性耦合的传染压力(含各年龄接触)
        for (let a = 0; a < 3; a++) {
          const c = row[a];
          let lamW = 0, lamV = 0;
          for (let r2 = 0; r2 < s.nR; r2++) {
            const w = r2 === r ? 1 : E.mob / Math.max(1, s.nR - 1);
            for (let b = 0; b < 3; b++) {
              const cm = CONTACT[a][b] * (a === 0 || b === 0 ? E.childCut : 1);
              const pop = s.comp[r2][b];
              lamW += w * cm * (s.beta * E.m) * pop.I1 / Math.max(1e-9, (pop.S + pop.E1 + pop.I1 + pop.E2 + pop.I2 + pop.R + pop.V));
              lamV += w * cm * (s.beta * E.m * s.variant.adv) * pop.I2 / Math.max(1e-9, (pop.S + pop.E1 + pop.I1 + pop.E2 + pop.I2 + pop.R + pop.V));
            }
          }
          // 宿主耦合: 起始 10 天内指示病例加权
          let srcBoost = 1;
          if (s.coupled && s.t < 10) srcBoost = 1 + 1.2 * s.srcInf;
          const dS = -(lamW * c.S * srcBoost + lamV * c.S) * dt - Math.min(c.S, vRate * c.S * dt);
          const dE1 = (lamW * c.S * srcBoost - c.E1 / TAU_E) * dt;
          const dI1 = (c.E1 / TAU_E - c.I1 / tauI) * dt;
          const dE2 = (lamV * (c.S + c.R * s.variant.escape * lamV / Math.max(1e-9, lamV + 1)) - c.E2 / TAU_E) * dt;
          const dI2 = (c.E2 / TAU_E - c.I2 / tauI) * dt;
          const dR = ((c.I1 + c.I2) / tauI - lamV * s.variant.escape * c.R / 5) * dt;
          c.S = Math.max(0, c.S + dS);
          c.E1 = Math.max(0, c.E1 + dE1); c.I1 = Math.max(0, c.I1 + dI1);
          c.E2 = Math.max(0, c.E2 + dE2); c.I2 = Math.max(0, c.I2 + dI2);
          c.R = Math.max(0, c.R + dR - (s.variant.seeded ? lamV * s.variant.escape * c.R / 5 * dt : 0));
          c.V = Math.max(0, c.V + Math.min(c.S + dS, vRate * c.S * dt));   // (S→V 已含在 dS 中, V 仅记数)
          const admissions = ((c.I1 * AGE_SEV[a] * 0.04) + (c.I2 * AGE_SEV[a] * 0.04 * s.variant.sev)) * E.sevCut * dt;
          c.H = Math.max(0, c.H + admissions - c.H / TAU_H * dt);
          c.D = Math.max(0, c.D + c.H / TAU_H * AGE_CFR[a] * dt);
        }
      }
      s.t += dt;
    },
    pushSample() {
      const s = this._s;
      let I = 0, H = 0, D = 0, Ssum = 0, I1 = 0, I2 = 0, Imm = 0;
      for (const row of s.comp) for (const c of row) {
        I += c.I1 + c.I2; H += c.H; D += c.D;
        Ssum += c.S; Imm += c.V + c.R; I1 += c.I1; I2 += c.I2;
      }
      const prev = s.sample.length ? s.sample[s.sample.length - 1] : null;
      s.sample.push({
        t: +s.t.toFixed(1), I: Math.round(I), H: Math.round(H), D: Math.round(D),
        Sfrac: +(Ssum / s.N).toFixed(4),          // 真易感: 不含疫苗/康复免疫
        Imm: +(Imm / s.N).toFixed(4),
        fv: +(I2 / Math.max(1, I1 + I2)).toFixed(4),
        newI: 0,
      });
      const cur = s.sample[s.sample.length - 1];
      if (prev) cur.newI = Math.max(0, cur.I - prev.I);
      if (s.sample.length > 4000) s.sample.splice(0, s.sample.length - 4000);
    },
    advance(days) {
      const s = this._s;
      if (!s) return { ok: false, text: '先 pathogen_pop_init。' };
      const d = clamp(Number(days) || 30, 1, s.horizon - s.t);
      const n = Math.max(1, Math.round(d));
      for (let i = 0; i < n; i++) { if (s.t >= s.horizon) break; this.step(1); this.pushSample(); }
      const cur = s.sample[s.sample.length - 1];
      let peak = 0;
      for (const p of s.sample) peak = Math.max(peak, p.I);
      return { ok: true, text: `已推进 ${Math.round(d)} 天 → t=${s.t.toFixed(0)}d。当前活跃感染 ${cur.I.toLocaleString()} · 累计住院 ${cur.H.toLocaleString()} · 累计死亡 ${cur.D.toLocaleString()} · 人群易感余 ${(cur.Sfrac * 100).toFixed(0)}% · 变异株占比 ${(cur.fv * 100).toFixed(1)}%(病程峰 ${peak.toLocaleString()})。` };
    },

    // ---- 观测 ----
    observe(args) {
      const s = this._s;
      if (!s) return { ok: false, text: '先 pathogen_pop_init。' };
      const E = this.effMask(s, s.t);
      const cur = s.sample[s.sample.length - 1];
      const tauI = Math.max(1.2, TAU_I * E.tauCut);
      const rtW = s.r0 * E.m * cur.Sfrac;
      let peak = 0, peakT = 0;
      for (const p of s.sample) if (p.I > peak) { peak = p.I; peakT = p.t; }
      const lines = [
        `# 群体状态 · ${s.entry.zh} · t=${s.t.toFixed(0)}d(tier ${s.entry.tier}, 教学量级)`,
        `活跃感染 ${cur.I.toLocaleString()} · 累计住院 ${cur.H.toLocaleString()} · 死亡 ${cur.D.toLocaleString()}`,
        `Rt(野生, 解析) = ${rtW.toFixed(2)} = R0 ${s.r0.toFixed(1)} × 干预 ${E.m.toFixed(2)} × 真易感 ${(cur.Sfrac * 100).toFixed(0)}%(免疫 ${((cur.Imm || 0) * 100).toFixed(0)}%) · 住院容量参考 ${(s.N / 100000 * 40).toLocaleString()} 床/10万`,
        `变异株(逃逸株)占比 ${(cur.fv * 100).toFixed(1)}%${s.variant.seeded ? '' : '(尚未引入: t=' + s.variantIntro + 'd)'} · 病程峰值 ${peak.toLocaleString()} @ t=${peakT}d`,
        `干预: ${s.interventions.length ? s.interventions.map(i => `${i.kind}×${i.eff.toFixed(2)}(${i.start}-${i.end}d)`).join('、') : '无'} · 疫苗计划: ${s.campaigns.length ? s.campaigns.map(c => `cov${(c.coverage * 100).toFixed(0)}%/eff${(c.efficacy * 100).toFixed(0)}%`).join('、') : '无'}`,
      ];
      if (s.coupled) lines.push(`宿主耦合: 指示病例传染性 ${s.srcInf.toFixed(2)}(前 10 天传播加权) —— 用宿主内层治疗后再跑对照可以看到差别。`);
      if (args && args.series) {
        const ss = s.sample.filter((_, i) => i % Math.ceil(s.sample.length / 40) === 0).slice(-40);
        lines.push('series(t,I,H,D,fv):');
        for (const p of ss) lines.push(`  ${p.t}\t${p.I}\t${p.H}\t${p.D}\t${(p.fv * 100).toFixed(1)}`);
      }
      lines.push('注: 本观察是"上帝视角"(真值); 智能体做公卫决策应基于 pathogen_surveillance 的带噪读数。');
      return { ok: true, text: lines.join('\n') };
    },

    // ---- 监测(带噪观测) ----
    surveillance(args) {
      const s = this._s;
      if (!s) return { ok: false, text: '先 pathogen_pop_init。' };
      const frac = clamp(Number(args.seq_fraction) === 0 ? 0.01 : Number(args.seq_fraction) ?? 0.01, 0, 1);
      const day = Number(args.day) || s.t;
      const idx = Math.max(0, s.sample.findIndex(p => p.t >= day - 7)) || 0;   // 报告延迟 5-7 天
      const wk = s.sample.slice(idx, Math.max(idx + 1, s.sample.findIndex(p => p.t >= day)));
      let newI = 0;
      for (let i = 1; i < wk.length; i++) newI += Math.max(0, wk[i].I - wk[i - 1].I);
      const ascertain = 0.35;                     // 漏报: 只观测到 ~1/3
      const reported = Math.round(newI * ascertain);
      const truthFv = wk.length ? wk[wk.length - 1].fv : 0;
      const nSeq = Math.max(0, Math.round(reported * frac));
      // 二项采样噪声(确定性: 用本周报告数+测序数做种子, 同场景可复现)
      const seedIdx = Math.max(1, Math.round(newI + nSeq) || 1);
      let hash = seedIdx * 2654435761 >>> 0;
      const rnd = () => { hash = (hash + 0x6D2B79F5) >>> 0; let t = Math.imul(hash ^ (hash >>> 15), 1 | hash); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let success = 0;
      for (let i = 0; i < nSeq; i++) if (rnd() < truthFv) success++;
      const est = nSeq ? success / nSeq : 0;
      const ci = nSeq ? 1.96 * Math.sqrt(Math.max(1e-9, est * (1 - est)) / nSeq) : 1;
      const prevWk = s.sample.slice(Math.max(0, idx - 7), idx);
      let newIprev = 0;
      for (let i = 1; i < prevWk.length; i++) newIprev += Math.max(0, prevWk[i].I - prevWk[i - 1].I);
      const rtEst = newIprev > 0 && reported > 0 ? Math.min(12, (reported / Math.max(1, Math.round(newIprev * ascertain)))) : null;
      const lines = [
        `# 监测报告(target t=${day.toFixed(0)}d, 反映 ~${(day - 5).toFixed(0)}d 前的疫情, 报告延迟 5-7 天)`,
        `本周报告新增病例: <b>${reported.toLocaleString()}</b>(漏报率 ~${(1 - ascertain) * 100}%: 与检测策略有关)`,
        rtEst ? `Rt 估计(观测增量比): <b>${rtEst.toFixed(2)}</b>(基于报告病例, 含噪声与延迟; 解析真值见 pop_observe)` : 'Rt 估计: 数据不足',
      ];
      if (nSeq) {
        lines.push(`变异株占比(测序采样 ${frac * 100}%): <b>${(est * 100).toFixed(1)}%</b> [95%CI ±${(ci * 100).toFixed(1)}pp] 基于 ${nSeq} 条序列 —— 真值 ${truthFv >= 0 ? '' : ''}不可见, 采样越少噪声越大`);
      } else {
        lines.push(`变异株占比: 测序样本不足(${frac * 100}% × ${reported} = ${nSeq} 条) —— 这正是真实监测的常态: 需要扩大采样或推迟结论`);
      }
      lines.push(`每周必须用 pathogen_pop_observe + pathogen_surveillance 对照才知道"解析值 vs 有噪观测"的差距; 只看一边会高估把握。`);
      return { ok: true, text: lines.join('\n') };
    },

    // ---- 溢出预警 ----
    spillover(args) {
      const C = G.PathoCatalog;
      if (!C) return { ok: false, text: '目录未加载。' };
      const iface = clamp(Number(args.interface) === 0 ? 0.5 : Number(args.interface) ?? 0.5, 0, 1);
      // 监测灵敏度(0-1): 弱 0.2 / 中 0.5 / 强 0.85 —— 决定"能不能在早期看见"
      const SUR_W = { weak: 0.2, low: 0.2, '弱': 0.2, mid: 0.5, '中': 0.5, strong: 0.85, '强': 0.85 };
      let sur;
      if (args && args.surveillance === undefined) sur = 0.5;
      else if (typeof (args || {}).surveillance === 'string') sur = SUR_W[args.surveillance.trim().toLowerCase()] ?? clamp(Number(args.surveillance) || 0, 0, 1);
      else sur = clamp(Number((args || {}).surveillance) || 0, 0, 1);
      const ent = entryFor();
      const factor = (e) => {
        const tx = e.tx.join('|');
        const animal = (tx.includes('animal') ? 1 : 0) + (tx.includes('vector') ? 0.8 : 0) + (String(e.reservoir || '').match(/蝙蝠|啮齿|禽|果蝠|鼠|鸟|猴/) ? 0.6 : 0);
        const receptor = e.kind === 'virus' ? (['resp', 'contact'].some(t => e.tx.includes(t)) ? 1 : 0.4) : 0.5;
        // 基因屏障: tier C(目录级/宿主适应数据少的罕见种)在弱监测下几乎必然"晚发现"
        const barrier0 = e.tier === 'C' ? 0.8 : e.tier === 'B' ? 0.5 : 0.3;
        const barrier = e.tier === 'C' ? barrier0 * (1.45 - 0.45 * sur) : barrier0;
        const bslRisk = e.bsl >= 4 ? 0.9 : e.bsl === 3 ? 0.7 : 0.4;
        const novel = e.kind === 'virus' ? 0.2 : 0.1;
        return { animal, receptor, barrier: Math.min(1, barrier), bsl: bslRisk, novel, sur, score: 0.30 * animal + 0.20 * receptor + 0.15 * Math.max(0, 1 - barrier) + 0.15 * bslRisk + 0.10 * novel + 0.10 * sur };
      };
      const scores = C.all().map(e => ({ e, f: factor(e) }));
      scores.forEach(x => { x.ifScore = x.f.score * (0.55 + 0.9 * iface); });
      scores.sort((a, b) => b.ifScore - a.ifScore);
      const lines = [`# 溢出预警 · 人兽界面对接 ${ctxType(iface)}(=${iface.toFixed(2)})${args && args.what_if ? ' · what-if 模式(只算因子分解与预期规模)' : ''}`];
      lines.push(`监测灵敏度: ${sur < 0.35 ? '弱(被动报告/无哨点)' : sur > 0.7 ? '强(哨点+综合征+测序)' : '中(哨点医院)'}(=${sur.toFixed(2)}) —— 预计从首例到实验室确认中位延迟 <b>${Math.round(7 + 42 * (1 - sur))} 天</b>; 弱监测下罕见/tier C 病原被系统性晚发现。`);
      if (ent && (ent.tx.includes('animal') || ent.tx.includes('vector') || ent.reservoir)) {
        const f = factor(ent);
        lines.push(`当前场景 ${ent.zh}: 风险 ${(f.score * (0.55 + 0.9 * iface)).toFixed(2)}/1.0 —— 因子: 宿主/媒介 ${f.animal.toFixed(1)} · 受体兼容 ${f.receptor.toFixed(1)} · 基因屏障 ${f.barrier.toFixed(1)} · BSL ${f.bsl.toFixed(1)} · 监测 ${f.sur.toFixed(1)}`);
        lines.push(`预期暴发规模(量级): ${expectedSize(ent, iface)} —— 界面对接每 ↑0.1, 预期规模约 ×${(1 + 0.25).toFixed(2)}`);
      } else if (ent) lines.push(`当前场景 ${ent.zh}: 无人兽界面/储存宿主字段, 直接溢出途径不适用(人传人/环境途径为主)。`);
      lines.push(`Watchlist(全目录按风险排序 Top8, 界面=${iface.toFixed(2)}):`);
      for (const x of scores.slice(0, 8)) lines.push(`· ${(x.ifScore).toFixed(2)}  ${x.e.zh}(${x.e.id}) 储存 ${x.e.reservoir || '—'} · 媒介 ${x.e.vector || '—'} · tier ${x.e.tier}`);
      lines.push('注: 评分为教学合成(tier 语义), 用于排序与因子分解练习, 不是真实生态风险数值。把 surveillance 从 weak 拉到 strong 再跑一次 —— watchlist 排序会变, 这就是"监测能力是风险分母"的演练。');
      if (args && args.what_if) lines.push('what-if 说明: 把 interface 调到 0.9 再跑一次, top 项得分与预期规模同步上行, 这组对照就是"减少界面对接"的价值演练。');
      return { ok: true, text: lines.join('\n') };
    },

    // ---- 血清学调查(带噪观测的免疫快照) ----
    serology(args) {
      const s = this._s;
      if (!s) return { ok: false, text: '先 pathogen_pop_init。' };
      const n = Math.max(30, Math.min(50000, Math.round(Number(args && args.sample_per_region) || 500)));
      const day = Number(args && args.day) || s.t;
      const snap = s.sample.slice().reverse().find(p => p.t <= day + 1e-9) || s.sample[0];
      const SENS = 0.90, SPEC = 0.98;      // 现实教学: 抗体检测有灵敏度/特异度
      // 确定性二项抽样: 种子 = 采样量+地区数+报告日(同参数可复算)
      let h = (Math.round(day * 10) * 2654435761 ^ n * 97 ^ s.nR * 31) >>> 0;
      const rnd = () => { h = (h + 0x6D2B79F5) >>> 0; let x = Math.imul(h ^ (h >>> 15), 1 | h); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
      const wilson = (k, m) => {
        const z = 1.96, ph = (k + z * z / 2) / (m + z * z), hw = z * Math.sqrt((ph * (1 - ph) / m) + (z * z / (4 * m * m))) / (1 + z * z / m);
        return [Math.max(0, ph - hw), Math.min(1, ph + hw)];
      };
      const lines = [`# 血清学调查 · t=${day.toFixed(0)}d · 每地区抽样 ${n} · 试剂 灵敏度 ${SENS * 100}%/特异度 ${SPEC * 100}%`];
      let totK = 0, totPop = 0, estSum = 0;
      for (let ri = 0; ri < s.nR; ri++) {
        let immT = 0, pop = 0;
        for (const c of s.comp[ri]) { immT += c.V + c.R; pop += c.S + c.E1 + c.I1 + c.E2 + c.I2 + c.R + c.V; }
        const truthP = immT / Math.max(1e-9, pop);
        const apparent = truthP * SENS + (1 - truthP) * (1 - SPEC);   // 观测到的是"表现阳性率"
        let k = 0;
        for (let i = 0; i < n; i++) if (rnd() < apparent) k++;
        const [lo, hi] = wilson(k, n);
        lines.push(`· 地区 ${ri + 1}: ${k}/${n} 阳性 → 估计 ${(k / n * 100).toFixed(1)}% [<b>CI ${(lo * 100).toFixed(1)} ~ ${(hi * 100).toFixed(1)}%</b>]`);
        totK += k; totPop += pop; estSum += (s.nR ? 0 : 0) + (k / n);
      }
      const [lo2, hi2] = wilson(totK, n * s.nR);
      lines.push(`合计: ${totK.toLocaleString()}/${(n * s.nR).toLocaleString()} → 加权血清阳性率 <b>${(totK / (n * s.nR) * 100).toFixed(1)}%</b> [CI ${(lo2 * 100).toFixed(1)} ~ ${(hi2 * 100).toFixed(1)}%]`);
      if (n < 150) lines.push(`样本量偏小(${n}/地区): 区间过宽, 不足以支撑地区差异化决策 —— 加大抽样或合并地区看。`);
      lines.push(`未校正偏倚说明: ①低流行区 1−特异度(${((1 - SPEC) * 100).toFixed(0)}%)主导, 直接引用会高估; ②抽样框偏差/高危职业超额采样未建模。`);
      lines.push(`判读: 血清阳性 ≈ 人群免疫屏障的观测代理。本教学引擎把感染/疫苗免疫记为持久 —— 现实中抗体随月衰减, 血清阳性率会<b>低于</b>累计发病率(低估)。`);
      lines.push(`对照: 观测代理 vs 解析免疫(Imm%)的差异 = 检测偏差本身; 用 pathogen_pop_observe 看真值仅限校准学习, 公卫决策应站在这份带噪报告上。`);
      return { ok: true, text: lines.join('\n') };
    },
  };
  function ctxType(iface) { return iface > 0.7 ? '高(活体市场/驯养密集)' : iface > 0.35 ? '中(接触/职业暴露)' : '低(监测性采样)'; }
  function expectedSize(e, iface) {
    const r0 = e.r0 ? (e.r0.lo + e.r0.hi) / 2 : 1.5;
    const size = Math.round(1 + 50 * iface * iface * r0 * (e.sev >= 4 ? 0.6 : 1));
    return size <= 5 ? '散发(' + size + ' 例内)' : size <= 80 ? '局限聚集(' + size + ' 例量级)' : size <= 3000 ? '社区暴发(' + size + ' 例量级)' : '暴发流行(' + size.toLocaleString() + ' 例量级)';
  }

  G.PathoPop = Pop;
})();
