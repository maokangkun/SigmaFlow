/** 刷新后流式恢复回归(需模型): 发起长回复 → reload 页面 → 刷新后仍是
 * 逐字流式(chat.observe 接棒), 而非 3s 存档轮询的一坨一坨整页闪现。
 * 判据: reload 后采样正文长度序列, 小步长增量(≤60 字符)出现 ≥4 次。 */
import { probe, skip, launch, log, cleanupConversations, BASE } from './helpers.mjs';

const p = await probe();
if (!p.up) skip(`服务不可达(${p.reason})`);
if (!p.models) skip('无可用模型, 跳过需真实生成的流式恢复场景');

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
try {
  await page.goto(BASE + '/science/#/home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForTimeout(6000);
  await cleanupConversations(page, /深海生物发光|E2E流式恢复/);

  // 发起长回复(数到 120: 输出慢而持续, reload 窗口充足)
  await page.fill('#composer-text', '请从 1 数到 120，每行一个数字，不要解释。(E2E流式恢复)');
  await page.click('.send-button');
  await page.waitForFunction(() => {
    const el = document.querySelector('.agent-intro');
    return el && (el.textContent || '').length > 60;
  }, null, { timeout: 60000 });
  const convId = await page.evaluate(() => CS.state.currentRunId);
  log('stream-started', convId);

  // 刷新页面 → 恢复路由拉回该会话
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForFunction(id => CS.state.currentRunId === id, convId, { timeout: 30000 });
  await page.waitForSelector('.agent-intro', { timeout: 30000 });

  // 采样 8s 正文长度序列(流式 = 多次小步长递增; 轮询 = 3s 一跳)
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const len = await page.evaluate(() => (document.querySelector('.agent-intro')?.textContent || '').length);
    samples.push(len);
    await page.waitForTimeout(500);
  }
  log('samples', samples.join(','));
  // 流式判据(节律而非步长): 记录增长点时刻。存档轮询是 3s 节流一跳,
  // 相邻增长间距恒 >=3s; 实时流(observe 接棒)增长密集, 间距 <2.8s。
  // 重放追平的首步(0->N)与终态步均计入, 只看节律即可区分两种来源。
  const growthAt = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] > samples[i - 1]) growthAt.push(i);
  }
  log('growth-at-samples', growthAt.join(','));
  if (growthAt.length < 2) throw new Error('刷新后正文无增长(接棒失败): ' + samples.join(','));
  let maxGapSamples = 0;
  for (let g = 1; g < growthAt.length; g++) {
    const gap = growthAt[g] - growthAt[g - 1];
    if (gap > maxGapSamples) maxGapSamples = gap;
  }
  // 采样周期 500ms: 轮询节律的相邻增长间距 >=6 个采样(3000ms/500ms)
  if (maxGapSamples >= 6) throw new Error(`刷新后是存档轮询节律(增长间距 ${maxGapSamples * 500}ms >= 3000ms): ` + samples.join(','));

  // 清理: 停止残留回复 + 删除会话
  await page.evaluate(() => { const r = CS.currentRun(); if (r) CS.api.ws.send('chat.stop', { runId: r.id }).catch(() => {}); });
  await page.waitForTimeout(2000);
  await cleanupConversations(page, /深海生物发光|E2E流式恢复/);
  log('pass', true);
} finally {
  await browser.close();
}
