/** 双标签页并发同会话: requestId 前缀唯一化后, 第二个页面的普通发送必须
 * 被互斥拒绝(曾经: 两连接 seq 同号互相覆盖注册, 互斥查不到在途回复放行,
 * 历史 正文被错重放进新回复 —— run-23ea66ae 事故)。 */
import { probe, skip, launch, log, cleanupConversations, BASE } from './helpers.mjs';

const p = await probe();
if (!p.up) skip(`服务不可达(${p.reason})`);
if (!p.models) skip('无可用模型');

const browser = await launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page1 = await ctx.newPage();
try {
  await page1.setViewportSize({ width: 1400, height: 900 });
  await page1.goto(BASE + '/science/#/home', { waitUntil: 'domcontentloaded' });
  await page1.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page1.waitForTimeout(6000);
  await cleanupConversations(page1, /E2E互斥双页/);
  await page1.fill('#composer-text', '请从 1 数到 80，每行一个数字，不要解释。(E2E互斥双页)');
  await page1.keyboard.press('Enter');
  await page1.waitForFunction(() => CS.currentRun()?.messages?.some(m => m.streaming), null, { timeout: 40000 });
  const convId = await page1.evaluate(() => CS.state.currentRunId);

  // 第二标签页(独立 WS 连接, seq 重新从 1 计数)打开同一会话并发送
  const page2 = await ctx.newPage();
  await page2.setViewportSize({ width: 1400, height: 900 });
  await page2.goto(BASE + '/science/#/chat/' + convId, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page2.waitForTimeout(4000);
  await page2.fill('#composer-text', '第二页并发消息');
  await page2.keyboard.press('Enter');
  await page2.waitForTimeout(5000);
  const st = await page2.evaluate(() => {
    const r = CS.currentRun();
    return {
      users: (r?.messages || []).filter(m => m.role === 'user').length,
      streaming: r?.messages?.some(m => m.streaming),
      toast: document.body.textContent.includes('已有回复在生成') || document.body.textContent.includes('引导消息插入'),
    };
  });
  log('page2', JSON.stringify(st));
  // 判据: 第二页消息被转为引导(或拒绝) —— 但绝不能出现第二个并发回复流
  // (历史上撞号后互斥失效, 两个 agent 并发同会话把历史正文错重放进新回复)
  if (st.users >= 3 && !st.toast) throw new Error('互斥未生效: 第二页的普通发送被放行成并发回复');
  // 清理
  for (const pg of [page1, page2]) await cleanupConversations(pg, /E2E互斥双页/).catch(() => {});
  log('pass', true);
} finally { await browser.close(); }
