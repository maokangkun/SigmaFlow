/** 3D 形态视图回归: 六大类各能建场景出画布(WebGL 上下文可用), 说明文字就位。
 * 不依赖模型服务 —— 纯前端程序化建模。 */
import { probe, skip, launch, openPage, log, BASE } from './helpers.mjs';

const p = await probe();
if (!p.up) skip(`服务不可达(${p.reason})`);

const KINDS = [
  ['InfluenzaA', '包膜病毒'],
  ['S_aureus', '球菌'],
  ['Candida_albicans', '酵母'],
  ['E_histolytica', '原虫'],
  ['Ascaris', '蠕虫'],
  ['Prion_sCJD', '朊粒'],
];

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
try {
  await page.goto(BASE + '/science/#/pathogen', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Patho3D && window.PathoUI, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const results = [];
  for (const [id, label] of KINDS) {
    const r = await page.evaluate(async id => {
      try {
        window.Patho3D.open(id);
        await new Promise(r => setTimeout(r, 2200));
        const cv = document.querySelector('#p23dStage canvas.p23d-cv');
        const cap = document.getElementById('p23dCap')?.textContent || '';
        const loading = !!document.querySelector('.p23d-loading');
        window.Patho3D.close();
        await new Promise(r => setTimeout(r, 150));
        return { canvas: !!cv, capLen: cap.length, loading, closedClean: !document.getElementById('patho3d') };
      } catch (e) { return { err: String(e).slice(0, 80) }; }
    }, id);
    results.push([id, r.canvas === true, r.capLen > 10, r.loading === false, r.closedClean === true]);
    if (results.at(-1).slice(1).some(v => v !== true)) {
      console.error('FAIL 明细', id, JSON.stringify(r));
    }
  }
  log('patho3d', results);
  const bad = results.filter(r => r.slice(1).some(v => v !== true));
  if (bad.length) { console.error('未通过:', JSON.stringify(bad)); process.exit(1); }
  console.log(`PASS: 六类形态视图(${KINDS.map(k => k[1]).join('/')})画布/说明/关闭清理全通过`);
} finally {
  await browser.close();
}
