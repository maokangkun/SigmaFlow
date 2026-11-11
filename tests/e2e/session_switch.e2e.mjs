/** 会话切换回归(需模型): 流式中切走不被拽回 / 后台流式零整页重建 /
 * 切回运行中会话 / 快速交替 6 连击 / 点击丢失安全网补发。 */
import { probe, skip, launch, openPage, log, cleanupConversations } from './helpers.mjs';

const p = await probe();
if (!p.up) skip(`服务不可达(${p.reason})`);
if (!p.models) skip('无可用模型, 跳过需真实生成的会话切换场景');

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
try {
  await page.goto((await import('./helpers.mjs')).BASE + '/science/#/home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForTimeout(8000);
  await cleanupConversations(page, /E2E切换|只回复两个字|数到 \d+/);

  // 会话 1: 短回复
  await page.fill('#composer-text', '只回复两个字：收到(E2E切换)');
  await page.click('.send-button');
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    return r && r.messages.some(m => m.role === 'assistant') && !r.messages.some(m => m.streaming);
  }, null, { timeout: 120000 });
  const conv1 = await page.evaluate(() => CS.state.currentRunId);
  await page.evaluate(id => { CS.expandProject((CS.ui.conversations.find(c => c.id === id) || {}).projectId); }, conv1);

  // 会话 2: 长流式
  await page.click('[data-nav="home"]');
  await page.waitForTimeout(500);
  await page.fill('#composer-text', '请从 1 数到 120，每行一个数字，不要解释。');
  await page.click('.send-button');
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    return r && r.messages.some(m => m.streaming);
  }, null, { timeout: 40000 });
  const conv2 = await page.evaluate(() => CS.state.currentRunId);

  // 场景 1: 流式中切走, 3.2s 后不被拽回
  await page.click(`[data-action="open-conversation"][data-id="${conv1}"]`);
  await page.waitForTimeout(3200);
  const s1 = await page.evaluate(id => ({
    hashOk: location.hash === '#/chat/' + id,
    selected: document.querySelector('.conversation-link.selected')?.dataset.id === id,
  }), conv1);
  log('switch-away', s1);

  // 场景 2: 后台流式窗口零整页重建(节点存活)
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const el = document.querySelector('.sidebar-scroll'); if (el) el.dataset.mark = 'keep'; });
  await page.waitForTimeout(2600);
  const s2 = await page.evaluate(() => !!document.querySelector('.sidebar-scroll[data-mark="keep"]'));
  log('sidebar-stable', s2);

  // 场景 3: 切回运行中会话
  await page.click(`[data-action="open-conversation"][data-id="${conv2}"]`);
  await page.waitForTimeout(900);
  const s3 = await page.evaluate(id => ({
    hashOk: location.hash === '#/chat/' + id,
    streaming: CS.currentRun()?.messages?.some(m => m.streaming),
  }), conv2);
  log('switch-back', s3);

  // 场景 4: 快速交替 6 连击
  const seq = [conv1, conv2, conv1, conv2, conv1, conv2];
  const lands = [];
  for (const id of seq) {
    await page.click(`[data-action="open-conversation"][data-id="${id}"]`);
    await page.waitForTimeout(260);
    lands.push(await page.evaluate(id => location.hash === '#/chat/' + id, id));
  }
  log('rapid-toggle', lands);

  // 场景 5: 点击丢失安全网(pointerdown 后节点被销毁 → pointerup 补发)
  const s5 = await page.evaluate(id => {
    const btn = document.querySelector(`[data-action="open-conversation"][data-id="${id}"]`);
    if (!btn) return 'no-btn';
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    btn.remove();
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 12, clientY: 11 }));
    return new Promise(r => setTimeout(() => r(location.hash === '#/chat/' + id ? 'replayed' : 'missed'), 400));
  }, conv1);
  log('lost-click-replay', s5);

  const failures = [];
  if (!s1.hashOk || !s1.selected) failures.push('switch-away');
  if (!s2) failures.push('sidebar-stable');
  if (!s3.hashOk || !s3.streaming) failures.push('switch-back');
  if (!lands.every(Boolean)) failures.push('rapid-toggle');
  if (s5 !== 'replayed') failures.push('lost-click-replay');
  if (failures.length) { console.error('未通过:', failures.join(',')); process.exit(1); }
  console.log('PASS: 流式切换不拽回/零重建/切回/六连击/丢失点击补发');

  await page.waitForFunction(() => { const r = window.CS && CS.currentRun(); return r && !r.messages.some(m => m.streaming); }, null, { timeout: 180000 }).catch(() => {});
  await cleanupConversations(page, /E2E切换|数到 120/);
} finally {
  await browser.close();
}
