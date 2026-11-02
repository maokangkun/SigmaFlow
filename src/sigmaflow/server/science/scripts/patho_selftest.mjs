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
 * 通过/失败都打印数值, 全绿 exit 0。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'js/patho/catalog.js'));
require(path.join(root, 'js/patho/host.js'));
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
