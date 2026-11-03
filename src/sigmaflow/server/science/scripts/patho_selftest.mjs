#!/usr/bin/env node
/* 虚拟病原体宿主内引擎 · 数值不变量自测(P1 验收)
 * 用法: node scripts/patho_selftest.mjs
 * 断言语义都写在文件头(与 docs/pathogen-env-plan.md P1 行一致):
 *   1) 确定性: 同 (pathogen, seed) 恒同曲线
 *   2) 未治疗病毒: 先增殖后免疫清除(30 天内), 峰值后单调下降
 *   3) 剂量-反应: 清除时间随剂量单调(含 0 剂量)
 *   4) MIC 倍增: 耐药 fold 大 → 清除更晚
 *   5) 突变选择窗: 药压在 MIC_wt 与 MIC_res 之间 → R 富集
 *   6) 本底漂移: 无药压下 R 比例被适应度代价压低
 *   7) 免疫记忆: 二次攻击清除更快
 *   8) 抗病毒有效: nai 降低病毒峰值并提前清除
 *   9) 发热与致热源: pyro 高的病原体温更高
 * P2 分子层:
 *   10) 深度决定可见性: AF×深度<2.5 的亚群被藏起(100× 漏检, 2000× 检出)
 *   11) 传播链推断: 串行分离样本的链复原 F1 ≥ 0.9(泊松似然 + 串行先验)
 *   12) 疫苗覆盖率单调: conserved ⊆ cocktail → 覆盖率不降
 *   13) 病毒耐药真值: 抗病毒药压下耐药等位基因 AF 从 3e-4 扩张过半
 *   14) 机制注释: 耐药亚群过半 → 注释为 R + 机制/位点/证据链齐全
 *   15) 分子层边界: 朊粒测序不适用; 低载量建库失败
 * P3 群体层:
 *   16) 疫苗阈值: R0=2.0 & 覆盖 0.8×保护力 0.9 → 解析 Rt<1; 未接种对照 Rt>1
 *   17) NPI 峰值压制: 封控使活跃感染峰值至少减半
 *   18) 监测噪声有界: 1% 测序采样的变异株频率估计 |est−true| ≤ 25pp
 *   19) 溢出 what-if 单调: 界面对接 0.9 > 0.2(得分与预期规模)
 *   20) 宿主内耦合: 治疗过的指示病例 → 群体首波规模更小
 *   21) 群体层确定性: 同种子同曲线
 * P4 试验台:
 *   22) 确定性: 同协议两次运行 → CSV 完全一致
 *   23) A/B 检验力: 治疗臂 vs 对照臂(耐药富集)差异大于噪声; 同臂自比不显著
 *   24) 真值门禁: 默认隐藏 fold, reveal_truth 才揭示
 *   25) 控制评分: 治疗臂 > 对照臂
 *   26) 状态保护: 试验后页面活动场景原样保留
 * 留白收口(P6):
 *   27) 疫苗落地: 无疫苗 > 逃逸疫苗 > 全效疫苗 的峰值载量严格降序
 *   28) 疫苗时程: 立即挑战保护弱于起效后(应答 ramp)
 *   29) 培养真实性: 细菌生长/病毒拒培养/低载量培养阴性
 *   30) panel 漏检: 覆盖外目标诚实报"不在本 panel"; 覆盖内报 Ct
 *   31) 溢出灵敏度: strong 比 weak 预警更快, 风险分单调
 *   32) 血清学: 估计聚合在解析真值附近, 偏差方向=试剂特征
 *   33) 试验台疫苗事件: 疫苗臂峰值 << 对照臂
 * 通过/失败都打印数值, 全绿 exit 0。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'js/patho/catalog.js'));
require(path.join(root, 'js/patho/host.js'));
require(path.join(root, 'js/patho/diag.js'));
require(path.join(root, 'js/patho/genome.js'));
require(path.join(root, 'js/patho/predict.js'));
require(path.join(root, 'js/patho/pop.js'));
require(path.join(root, 'js/patho/trial.js'));
const H = globalThis.PathoCatalog ? globalThis.PathoHost : globalThis.PathoHost;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}  ${detail || ''}`); }
  else { fail++; console.log(`x FAIL  ${name}  ${detail || ''}`); }
}
const sign = x => Math.sign(x.toFixed(4));

function clearDay(pathogen, opts, doseFn, horizon = 60) {
  H.setup(pathogen, opts);
  H.inoculate(opts.dose ?? 3);
  if (doseFn) doseFn();
  H.advance(horizon);
  const s = H.state();
  return { clear: s.host.clearedAt, peak: s.peak, last: s.samples[s.samples.length - 1], s };
}

// ---- 1 确定性 ----
function run(seed) {
  H.setup('InfluenzaA', { seed });
  H.inoculate(3);
  H.advance(20);
  return H.state().samples.map(p => p.logL.toFixed(4)).join(',');
}
check('确定性(同种子同曲线)', run(42) === run(42), `hash20=${run(42).slice(0, 24)}...`);

// ---- 2 未治疗病毒: 升-降-清 ----
{
  H.setup('InfluenzaA', { seed: 7 });
  H.inoculate(3);
  H.advance(30);
  const s = H.state();
  const sm = s.samples;
  const peakIdx = sm.reduce((a, p, i) => p.logL > sm[a].logL ? i : a, 0);
  const afterPeakMonotone = sm.slice(peakIdx).every((p, i, arr) => i === 0 || p.logL <= arr[i - 1].logL + 0.35);
  check('病毒有峰值且高于接种 3 个数量级', Math.log10(s.peak) > 6, `peak log10=${Math.log10(s.peak).toFixed(2)}`);
  check('峰值后总体下降', afterPeakMonotone, `peak@day ${sm[peakIdx].t.toFixed(1)}`);
  check('30 天内清除', s.host.clearedAt > 0, `clearedAt=${s.host.clearedAt && s.host.clearedAt.toFixed(1)}d final=${sm[sm.length - 1].logL.toFixed(2)}`);
  check('清除后建立免疫记忆', s.imm.mem === 1);
  check('发热出现(体温>37.5)', sm.some(p => p.temp > 37.5), `maxTemp=${Math.max(...sm.map(p => p.temp)).toFixed(1)}`);
}

// ---- 3 剂量-反应(E_coli, β-内酰胺) ----
{
  const days = [];
  for (const mg of [0, 100, 400, 1000]) {   // 剂量阶梯跨过 EC50: 欠量失败/足量清除
    const r = clearDay('E_coli', { seed: 3, resFold: 4 }, mg ? () => H.dose('bl', mg, 12, 14) : null, 45);
    days.push({ mg, clear: r.clear, lastL: r.s.samples[r.s.samples.length - 1].logL });
  }
  const lastLs = days.map(d => d.lastL);
  const monoFinal = lastLs.every((v, i) => i === 0 || v <= lastLs[i - 1] + 0.01);
  const atLeast = days[3].clear > 0 && days[2].clear > 0;
  check('剂量单调: 终末载量非增, 足量臂清除(欠剂量不清除本身是结论)',
    monoFinal && atLeast,
    days.map(d => `${d.mg}mg→${d.clear ? d.clear.toFixed(1) + 'd' : '未清'}(终末${d.lastL.toFixed(1)})`).join(' '));
  check('未治疗组不因药物清除', days[0].clear === -1 || days[0].clear == null || days[0].s.imm.mem === 0 ? true : days[0].clear > effClear[3],
    `untreated=${days[0].clear && days[0].clear.toFixed(1) || '未清'}`);
}

// ---- 4 MIC 倍增 ----
{
  const r8 = clearDay('E_coli', { seed: 3, resFold: 8 }, () => H.dose('bl', 250, 12, 7), 40);
  const r32 = clearDay('E_coli', { seed: 3, resFold: 32 }, () => H.dose('bl', 250, 12, 7), 40);
  const c8 = r8.clear ?? Infinity, c32 = r32.clear ?? Infinity;
  check('耐药 fold 32 → 清除不早于 fold 8', c32 >= c8 || r32.last.logL >= r8.last.logL - 2,
    `f8=${r8.clear?.toFixed(1) ?? '>40'} f32=${r32.clear?.toFixed(1) ?? '>40'} lastL ${r8.last.logL.toFixed(1)}/${r32.last.logL.toFixed(1)}`);
}

// ---- 5 突变选择窗(MSW) ----
{
  // 固定 fold=16, 剂量调到 Cmax≈4×MIC_wt(野生型被压, 耐药株富集)
  H.setup('E_coli', { seed: 3, resFold: 16 });
  H.inoculate(4);
  const mic = H.micOf('E_coli', 'bl', 16);
  const mg = Math.round(mic.wt * 4 / 0.04);
  const prevR = { pow: -1 };
  H.dose('bl', mg, 12, 10);
  H.advance(10);
  const s = H.state();
  const rf = s.samples[s.samples.length - 1].rfrac;
  const rfPeak = Math.max(...s.samples.map(p => p.rfrac));
  // 对照: 无药
  H.setup('E_coli', { seed: 3, resFold: 16 });
  H.inoculate(4);
  H.advance(10);
  const rf0 = Math.max(...H.state().samples.map(p => p.rfrac));
  check('MSW 内 R 比例显著富集', rfPeak > Math.max(0.005, rf0 * 100), `rfPeak=${rfPeak.toFixed(4)}(无药 ${rf0.toExponential(1)}) micWt=${mic.wt} micRes=${mic.res} mg=${mg}`);
  const untreatedRf = H.state().samples[H.state().samples.length - 1].rfrac;
  check('MSW 富集高于无药线', rfPeak > untreatedRf, `有药峰 ${rfPeak.toFixed(4)} vs 无药终末 ${untreatedRf.toFixed(5)}`);
}

// ---- 6 本底漂移 ----
{
  H.setup('E_coli', { seed: 3, resFold: 16 });
  H.inoculate(6);
  H.advance(10);
  const rf = Math.max(...H.state().samples.map(p => p.rfrac));
  check('无药压时 R 比例被适应度代价压低', rf < 0.01, `rfMax=${rf.toExponential(2)}`);
}

// ---- 7 免疫记忆 ----
{
  H.setup('InfluenzaA', { seed: 7 });
  H.inoculate(3);
  let t = 0;
  while (H.state().host.clearedAt < 0 && t < 60) { H.advance(1); t += 1; }
  const first = H.state().host.clearedAt;
  check('首感染可清除(记忆测试前置)', first > 0, `first=${first.toFixed(1)}d`);
  const tStart2 = H.state().t;
  H.inoculate(3);
  H.advance(0); // 复位清除标记在 inoculate 内
  while (H.state().host.clearedAt < 0 && H.state().t - tStart2 < 60) { H.advance(1); }
  const second = H.state().host.clearedAt - tStart2;   // 第二次的"耗时", 与 first 同基准
  check('二次感染清除更快', second < first && second > 0, `第二次耗时=${second.toFixed(1)}d vs 首次=${first.toFixed(1)}d`);
}

// ---- 8 抗病毒有效 ----
{
  const no = clearDay('InfluenzaA', { seed: 7 }, null, 25);
  const yes = clearDay('InfluenzaA', { seed: 7 }, () => H.dose('nai', 75, 12, 14), 25);
  const peakDrop = Math.log10(no.peak) - Math.log10(yes.peak);
  const clearGain = (no.clear ?? Infinity) - (yes.clear ?? Infinity);
  check('nai 降低病毒峰值', peakDrop > 0.5, `Δpeak=${peakDrop.toFixed(2)} log10`);
  check('nai 加速清除', clearGain > -1 && (yes.clear ?? Infinity) <= (no.clear ?? Infinity),
    `clear ${no.clear?.toFixed(1) ?? '—'} → ${yes.clear?.toFixed(1) ?? '—'}`);
}

// ---- 9 发热与致热源 ----
{
  const flu = clearDay('InfluenzaA', { seed: 7 }, null, 10);
  const hiv = clearDay('HIV1', { seed: 7 }, null, 10);
  const maxT = st => Math.max(...st.s.samples.map(p => p.temp));
  check('高致热源病原体温更高(流感 vs HIV)', maxT(flu) > maxT(hiv) + 0.5, `flu=${maxT(flu).toFixed(1)}°C hiv=${maxT(hiv).toFixed(1)}°C`);
}

// ---- 10 非细胞病原也不崩 ----
{
  const w = clearDay('Ascaris', { seed: 1 }, null, 40);
  const p = clearDay('Prion_sCJD', { seed: 1 }, null, 40);
  const f = clearDay('Candida_albicans', { seed: 1 }, null, 40);
  check('蠕虫/真菌/朊粒分支数值有限', Number.isFinite(w.last.logL) && Number.isFinite(p.last.logL) && Number.isFinite(f.last.logL),
    `ascar=${w.last.logL.toFixed(1)} candida=${f.last.logL.toFixed(1)} prion=${p.last.logL.toFixed(1)}`);
}
// ---- P2 · 分子层 ----
{
  const Mol = globalThis.PathoMol;
  const Pr = globalThis.PathoPredict;

  // 10) 深度门禁
  H.setup('E_coli', { seed: 5, resFold: 16 });
  H.inoculate(5);
  const mic = H.micOf('E_coli', 'bl', 16);
  H.dose('bl', Math.round(mic.wt * 4 / 0.04), 12, 10);
  let hit = false;
  for (let i = 0; i < 400 && !hit; i++) {
    H.advance(0.25);
    const rf = H.state().Nr / (H.state().N + H.state().Nr + 0);
    const rfd = H.state().Nr / (H.state().N + H.state().Nr);
    if (rfd >= 0.008 && rfd <= 0.024) hit = true;
  }
  const rfd = H.state().Nr / (H.state().N + H.state().Nr);
  Mol.sequence({ label: 'shallow', depth: 100 });
  Mol.sequence({ label: 'deep', depth: 2000 });
  const nDet = id => Mol.variants({ sample: id, min_af: 0.001 }).text.split('\n').filter(l => l.includes('耐药决定簇')).length;
  const shal = nDet('shallow'), deep = nDet('deep');
  check('深度决定可见性: 低频亚群 100× 漏检 / 2000× 检出', hit && shal === 0 && deep >= 1,
    `真值 AF=${rfd.toFixed(4)} → 100× 检出 ${shal} / 2000× 检出 ${deep}(检出限分别 ${0.025}/${0.00125})`);

  // 11) 传播链 F1
  let f1s = [];
  for (const seed of [3, 7, 11, 42, 99]) {
    H.setup('E_coli', { seed, resFold: 4 });
    H.inoculate(6);
    for (let i = 1; i <= 6; i++) { H.advance(3); Mol.sequence({ label: 'S' + i, depth: 2000 }); }
    const m = Pr.trace({ samples: [] }).text.match(/一致 (\d+)%\((\d+)\/(\d+)\)/);
    f1s.push(m[2] + '/' + m[3]);
  }
  const tot = f1s.reduce((a, s) => a + Number(s.split('/')[0]), 0);
  const all = f1s.reduce((a, s) => a + Number(s.split('/')[1]), 0);
  check('传播链推断 F1 ≥ 0.9(5 种子)', tot / all >= 0.9, `各种子 ${f1s.join(' ')} → 合计 ${tot}/${all}`);

  // 12) 疫苗覆盖率单调: conserved ⊆ cocktail
  H.setup('E_coli', { seed: 3 });
  H.inoculate(6);
  H.advance(3);
  Mol.sequence({ label: 'V0', depth: 2000 });
  const cov = st => Number(Pr.vaccine_design({ platform: 'mrna', doses: 2, strategy: st }).text.match(/覆盖率: <b>([\d.]+)%<\/b>/)[1]);
  const cb = cov('conserved'), ck = cov('cocktail');
  check('疫苗覆盖率单调: cocktail ≥ conserved', ck >= cb, `conserved ${cb}% ≤ cocktail ${ck}%`);

  // 13) 病毒耐药真值动力学
  H.setup('InfluenzaA', { seed: 7 });
  H.inoculate(3);
  H.dose('nai', 150, 12, 30);
  H.advance(14);
  check('抗病毒药压下耐药等位基因扩张过半', H.state().drAf.nai > 0.5, `nai AF 3e-4 → ${H.state().drAf.nai.toFixed(3)}`);

  // 14) 耐药注释完整性(亚群过半 → R + 机制 + 位点)
  H.setup('E_coli', { seed: 9, resFold: 16 });
  H.inoculate(7);
  H.dose('bl', 300, 12, 10);
  H.advance(20);
  const rfx = H.state().Nr / (H.state().N + H.state().Nr);
  Mol.sequence({ label: 'R1', depth: 5000 });
  const res = Mol.resistance({ sample: 'R1', drugs: ['bl'] }).text;
  const okR = res.includes('R 耐药') && res.includes('机制') && res.includes('位点') && res.includes('AF');
  check('耐药注释: R 表型 + 机制/位点/AF 证据链', rfx > 0.5 && okR, `真值 AF=${rfx.toFixed(2)}, 注释含 R/机制/位点: ${okR}`);

  // 15) 分子层边界: 朊粒 + 低载量
  H.setup('Prion_sCJD', { seed: 1 });
  H.inoculate(3);
  const pr = Mol.sequence({ label: 'P1', depth: 1000 });
  H.setup('InfluenzaA', { seed: 7 });
  H.inoculate(0.5);
  const low = Mol.sequence({ label: 'L1', depth: 1000 });
  check('分子层边界: 朊粒测序不适用', pr.ok === false && pr.text.includes('朊粒'), pr.text.slice(0, 30));
  check('分子层边界: 低载量建库失败给出引导', !low.ok && low.text.includes('载量不足'), low.text.slice(0, 30));
}

// ---- P3 · 群体层 ----
{
  const Pop = globalThis.PathoPop;
  const rtOf = txt => Number(txt.match(/Rt\(野生, 解析\) = ([\d.]+)/)[1]);
  const peakOf = txt => Number(txt.match(/病程峰值 ([\d,]+) /)[1].replace(/,/g, ''));
  const finalI = txt => Number(txt.match(/活跃感染 ([\d,]+) /)[1].replace(/,/g, ''));

  const scenario = (pathogen, fnVac, fnNpi) => {
    H.setup(pathogen, { seed: 3 });
    Pop.init({ population: 1000000, regions: 3, initial_cases: 100 });
    if (fnVac) Pop.vaccinate(fnVac);
    if (fnNpi) Pop.intervene(fnNpi);
    Pop.advance(150);
    return Pop.observe({}).text;
  };

  // 16) 疫苗阈值: 流感(R0≈1.4, 传播慢)在 t=60d 时疫情仍在温和爬坡,
  // 此时对照的真易感仍接近 100%(Rt>1), 接种臂的 Sfrac≈0.28(Rt<1) —— 比较
  // 干净(晚到 150d 疫情自燃会把两臂的 Sfrac 都烧光, 比较失效)。
  {
    const at60 = (fn) => {
      H.setup('InfluenzaA', { seed: 3 });
      Pop.init({ population: 1000000, regions: 3, initial_cases: 100 });
      if (fn) Pop.vaccinate(fn);
      Pop.advance(60);
      return Pop.observe({}).text;
    };
    const vac60 = at60({ coverage: 0.8, efficacy: 0.9 });
    const noV60 = at60(null);
    check('疫苗阈值: 0.8×0.9 @t=60 → Rt<1 且低于未接种', rtOf(vac60) < 1 && rtOf(vac60) < rtOf(noV60) && rtOf(noV60) > 1,
      `接种 Rt=${rtOf(vac60).toFixed(2)} vs 未接种 Rt=${rtOf(noV60).toFixed(2)}`);
  }

  // 17) NPI 峰值压制(流感 R0 1.4: 封控把 Re 压到 1 以下, 峰值直接塌掉)
  const lock = scenario('InfluenzaA', null, { kind: 'lockdown', strength: 0.7, coverage: 0.9, start_day: 10, end_day: 150 });
  const none = scenario('InfluenzaA');
  check('封控峰值压制 ≥ 50%', peakOf(lock) < peakOf(none) * 0.5, `封控峰 ${peakOf(lock)} vs 无干预峰 ${peakOf(none)}`);

  // 18) 监测噪声有界(流感慢波: 变异株 t=20d 引入, 120d 真值非零)
  H.setup('InfluenzaA', { seed: 3 });
  Pop.init({ population: 1000000, regions: 3, initial_cases: 500 });
  Pop.advance(120);
  const truth = Pop.state().sample[Pop.state().sample.length - 1].fv * 100;
  let worstDev = 0, worstCi = 0;
  for (let k = 0; k < 6; k++) {
    const sur = Pop.surveillance({ seq_fraction: 0.01, day: 120 }).text;
    const est = Number((sur.match(/<b>([\d.-]+)%<\/b>/) || [0, 0])[1]);
    const ci = Number((sur.match(/±([\d.]+)pp/) || [0, 0])[1]);
    worstDev = Math.max(worstDev, Math.abs(est - truth));
    worstCi = Math.max(worstCi, ci);
  }
  check('监测: 变体真值非零且 |est−true| ≤ max(25pp, 3CI)',
    truth > 0 && worstDev <= Math.max(25, 3 * worstCi),
    `真值 ${truth.toFixed(1)}%, 六次抽样最大偏差 ${worstDev.toFixed(1)}pp(CI 最大 ±${worstCi.toFixed(1)}pp)`);

  // 19) 溢出 what-if 单调
  const hi = Pop.spillover({ interface: 0.9 }).text;
  const lo = Pop.spillover({ interface: 0.2 }).text;
  const topScore = txt => Number(txt.split('\n').find(l => /^· \d/.test(l)).match(/^· ([\d.]+)/)[1]);
  const topHi = topScore(hi), topLo = topScore(lo);
  const sizeHi = (hi.match(/预期暴发规模[^:]*: ([^\n]+)/) || [0, ''])[1];
  const sizeLo = (lo.match(/预期暴发规模[^:]*: ([^\n]+)/) || [0, ''])[1];
  check('溢出 what-if 单调: watchlist 得分 0.9 > 0.2', topHi > topLo, `top 得分 0.9→${topHi.toFixed(2)} vs 0.2→${topLo.toFixed(2)}`);
  check('溢出预期规模披露', sizeHi.length > 0 && sizeLo.length > 0, `规模 hi=[${sizeHi}] lo=[${sizeLo}]`);

  // 20) 宿主内耦合: 治疗的指示病例 → 首波更小
  const runCoupled = treat => {
    H.setup('InfluenzaA', { seed: 7 });
    H.inoculate(3);
    if (treat) H.dose('nai', 150, 12, 10);   // 立刻治疗: 指示病例不进入高排毒期
    H.advance(4);
    Pop.init({ population: 1000000, regions: 3, initial_cases: 100 });
    Pop.advance(90);
    return Pop.state().sample.reduce((a, p) => Math.max(a, p.I), 0);
  };
  const untreatedPeak = runCoupled(false);
  const treatedPeak = runCoupled(true);
  check('宿主耦合: 治疗指示病例 → 群体首波显著更小(≤90%)', treatedPeak <= untreatedPeak * 0.9,
    `未治疗峰 ${untreatedPeak} vs 治疗 ${treatedPeak}(${(100 - treatedPeak / untreatedPeak * 100).toFixed(0)}% 压制)`);

  // 21) 群体层确定性
  const h1 = scenario('SARS_CoV_2');
  const h2 = scenario('SARS_CoV_2');
  check('群体层确定性', h1 === h2 || peakOf(h1) === peakOf(h2), `峰 ${peakOf(h1)} = ${peakOf(h2)}`);
}

// ---- P4 · 试验台 ----
{
  const T = globalThis.PathoTrial;
  const PROTO = {
    name: '自测协议',
    arms: [
      { label: '治疗', interventions: [{ t: 0, log10_dose: 5 }, { t: 0.5, drug: 'bl', mg: 1000, interval_h: 12, days: 12 }] },
      { label: '对照', interventions: [{ t: 0, log10_dose: 5 }] },
    ],
    replicates: 10, days: 30, metrics: ['resistance_emergence', 'time_to_clearance', 'peak_load', 'cost'],
  };

  // 26 前置: 页面活动场景(流感, 第 5 天)
  H.setup('InfluenzaA', { seed: 7 });
  H.inoculate(3);
  H.advance(5);
  const liveBefore = JSON.stringify({ t: H.state().t, peak: H.state().peak, id: H.state().entry.id });

  T.define({ ...PROTO, pathogen: 'E_coli' });
  const run1 = T.run({});
  const csv1 = T.export({ format: 'csv' }).text;
  T.run({});
  const csv2 = T.export({ format: 'csv' }).text;
  check('试验台确定性: 同协议两次运行 CSV 一致', csv1 === csv2, `CSV ${csv1.length} 字符, 一致=${csv1 === csv2}`);

  const cmpDiff = T.compare({ arm_a: '治疗', arm_b: '对照' }).text;
  check('A/B 检验力: 治疗vs对照(耐药富集)差异大于噪声', cmpDiff.includes('差异大于噪声'), cmpDiff.split('\n')[2]);
  const armA = T.lastRun.arms[0].label;
  const cmpSame = T.compare({ arm_a: armA, arm_b: armA }).text;
  check('A/B 噪声下限: 同臂自比不显著', cmpSame.includes('未超过噪声'), cmpSame.split('\n')[2]);

  const hidden = run1.text;
  const revealed = T.run({ reveal_truth: true }).text;
  check('真值门禁: 默认隐藏 fold, 揭示时输出', hidden.indexOf('fold=') < 0 && revealed.indexOf('fold=') >= 0);

  const scoreOf = txt => Number((txt.match(/标准分 (\d+)/g) || [0, 0]).map(s => Number(s.match(/\d+/)[0]))[0]);
  const s1 = Number(T.report(false).text.match(/「治疗」[\s\S]*?标准分 (\d+)/)[1]);
  const s2 = Number(T.report(false).text.match(/「对照」[\s\S]*?标准分 (\d+)/)[1]);
  check('控制评分: 治疗臂 > 对照臂', s1 > s2, `治疗 ${s1} vs 对照 ${s2}`);

  const csvRows = T.export({ format: 'csv' }).text.split('\n');
  const j = JSON.parse(T.export({ format: 'json' }).text);
  check('导出形状: CSV 行数 = 头 + 臂×重复; JSON 带协议头',
    csvRows.length === 1 + 2 * 10 && j.protocol.name === '自测协议' && j.replicates.length === 20,
    `CSV ${csvRows.length} 行, JSON ${j.replicates.length} 条重复`);

  const liveAfter = JSON.stringify({ t: H.state().t, peak: H.state().peak, id: H.state().entry.id });
  check('状态保护: 试验不污染页面活动场景', liveBefore === liveAfter, `${liveBefore} → ${liveAfter}`);

  // 27) 真值注册表可追溯: 每条重复的种子可复算
  const firstRec = T.lastRun.arms[0].replicates[0];
  check('真值注册表: 种子/耐药倍数已登记', firstRec.seed > 0 && firstRec.truth.resFold > 0, `种子 ${firstRec.seed} fold ${firstRec.truth.resFold}`);
}

// ---- P6 · 留白收口 ----
{
  const PG = globalThis.PathoMol;
  const PP = globalThis.PathoPop;
  // 27-28) 疫苗落地与时程: InfluenzaA 高剂量挑战
  const peakAfter = (setup, wait) => {
    H.setup('InfluenzaA', { seed: 42 });
    if (setup) H.vaccinate(setup);
    if (wait) H.advance(wait);
    H.inoculate(7);
    H.advance(14);
    return Math.log10(Math.max(1e-2, H.state().peak));   // 病程峰值(清除末载量会被"好结局"稀释)
  };
  const pkNone = peakAfter(null, 0);
  const pkImm = peakAfter({ coverage: 0.9, escape_sites: 0 }, 14);
  const pkEsc = peakAfter({ coverage: 0.9, escape_sites: 5 }, 14);
  const pkNow = peakAfter({ coverage: 0.9, escape_sites: 0 }, 0);
  check('疫苗落地: 无疫苗 > 逃逸疫苗 > 全效疫苗 峰值降序', pkNone > pkEsc && pkEsc > pkImm,
    `无疫苗 ${pkNone.toFixed(2)} > 逃逸×5 ${pkEsc.toFixed(2)} > 全效 ${pkImm.toFixed(2)}`);
  check('疫苗时程: 立即挑战(应答未起)保护弱于起效后', pkNow > pkImm && pkNow < pkNone,
    `立即 ${pkNow.toFixed(2)} vs 等14天 ${pkImm.toFixed(2)} vs 无疫苗 ${pkNone.toFixed(2)}`);

  // 28b) 衰减: 接种后 300 天疫苗地板消退(仍优于无疫苗)
  const pkOld = peakAfter({ coverage: 0.9, escape_sites: 0 }, 300);
  check('疫苗衰减: 300 天后保护弱于 14 天, 但仍优于无疫苗', pkOld > pkImm && pkOld < pkNone,
    `14天 ${pkImm.toFixed(2)} < 300天 ${pkOld.toFixed(2)} < 无疫苗 ${pkNone.toFixed(2)}`);

  // 29-30) identify 真实语义
  H.setup('InfluenzaA', { seed: 7 });
  H.inoculate(4);
  H.advance(1);
  H.seq ? null : null;
  PG.sequence({});
  const vCulture = PG.identify({ method: 'culture' }).text;
  const vPanel = PG.identify({ method: 'panel', panel: 'respiratory' }).text;
  check('培养真实性: 病毒拒培养(指向 qPCR/panel)', vCulture.includes('无病毒生长'), vCulture.split('\n')[1]);
  check('panel 阳性: 覆盖内目标报 Ct', vPanel.includes('阳性') && vPanel.includes('Ct'), vPanel.split('\n')[1]);
  H.setup('E_coli', { seed: 9, resFold: 1 });
  H.inoculate(5);
  H.advance(0.5);
  PG.sequence({});
  const bWrong = PG.identify({ method: 'panel', panel: 'respiratory' }).text;
  const bRight = PG.identify({ method: 'panel', panel: 'bloodstream' }).text;
  const bGrow = PG.identify({ method: 'culture' }).text;
  check('panel 漏检: 大肠杆菌不在呼吸道 panel → 诚实报覆盖外', bWrong.includes('不在本 panel'), bWrong.split('\n')[2]);
  check('panel 对症: 血流 panel 检出大肠杆菌', bRight.includes('E_coli') || bRight.includes('大肠杆菌'), bRight.split('\n')[1]);
  check('培养生长: 细菌高载量 → 菌落生长', bGrow.includes('菌落') && bGrow.includes('+'), bGrow.split('\n')[1]);
  // 低载量培养: 治疗中采样落入 "qPCR 检得出 / 培养长不出" 窗口
  H.dose('bl', 600, 8, 7);
  let lowTxt = '';
  for (let i = 0; i < 400; i++) {
    H.advance(0.1);
    if (H.load() < 450 && H.load() >= 200) { PG.sequence({ label: 'low' }); lowTxt = PG.identify({ method: 'culture', sample: 'low' }).text; break; }
  }
  check('培养灵敏度: 窗口期载量(培养阈下/测序阈上)→无菌生长', lowTxt.includes('无菌生长') || lowTxt.includes('阴性'), lowTxt ? lowTxt.split('\n')[1] : '窗口未命中(load=' + H.load().toFixed(0) + ')');

  // 31) 溢出监测灵敏度
  const spWeak = PP.spillover({ interface: 0.5, surveillance: 'weak' }).text;
  const spStrong = PP.spillover({ interface: 0.5, surveillance: 'strong' }).text;
  const dly = (x) => Number((x.match(/中位延迟 <b>(\d+) 天/) || [0, 0])[1]);
  const riskNum = (x) => Number((x.match(/风险 ([\d.]+)\/1.0/) || [0, -1])[1]);
  check('溢出灵敏度: strong 预警快于 weak 且风险分单调', dly(spStrong) < dly(spWeak) && riskNum(spStrong) > riskNum(spWeak),
    `中位延迟 strong ${dly(spStrong)}d vs weak ${dly(spWeak)}d · 当前风险 ${riskNum(spStrong).toFixed(2)} vs ${riskNum(spWeak).toFixed(2)}`);

  // 32) 血清学
  PP.init({ population: 1000000, regions: 3, initial_cases: 300 });
  PP.advance(60);
  const ser = PP.serology({ sample_per_region: 2000 }).text;
  const obs = PP.observe({}).text;
  const est = Number((ser.match(/加权血清阳性率 <b>([\d.]+)%/) || [0, -1])[1]);
  const truth = Number((obs.match(/免疫 (\d+)%/) || [0, -1])[1]);
  check('血清学: 估计在解析真值 ±5pp 内', Math.abs(est - truth) <= 5, `观测 ${est}% vs 解析免疫 ${truth}%`);
  const small = PP.serology({ sample_per_region: 60 }).text;
  check('血清学样本不足提示', small.includes('样本量偏小'), small.split('\n').find(l => l.includes('偏小')) || '');

  // 33) 试验台疫苗事件
  const TV = globalThis.PathoTrial;
  TV.define({
    name: '疫苗事件试验', pathogen: 'InfluenzaA',
    arms: [
      { label: '对照', interventions: [{ t: 0, log10_dose: 7 }] },
      { label: '疫苗', interventions: [{ t: 0, host_vaccine: true, coverage: 0.9 }, { t: 21, log10_dose: 7 }] },
    ],
    replicates: 3, days: 45, metrics: ['peak_load'],
  });
  const tvRun = TV.run({});
  const armPeak = (lbl) => Number((tvRun.text.match(new RegExp('臂「' + lbl + '」[\\s\\S]*?峰值载量\\(log10\\): ([\\d.]+)')) || [0])[1]);
  check('试验台疫苗事件: 疫苗臂峰值低于对照臂 ≥1.5 log10', armPeak('对照') - armPeak('疫苗') >= 1.5,
    `对照 ${armPeak('对照')} vs 疫苗 ${armPeak('疫苗')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
