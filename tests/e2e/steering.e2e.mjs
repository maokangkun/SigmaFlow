/** steering 全链路回归(需模型): 引导按钮/插话回显/模型回应/徽章刷新持久化/
 * 并发 chat.send 拒绝/互斥自动转引导。 */
import { probe, skip, launch, log, cleanupConversations, BASE } from './helpers.mjs';

const p = await probe();
if (!p.up) skip(`服务不可达(${p.reason})`);
if (!p.models) skip('无可用模型, 跳过需真实生成的引导场景');

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
try {
  await page.goto(BASE + '/science/#/home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForTimeout(8000);
  await cleanupConversations(page, /E2E引导|数到 1[0-9]|bash 工具运行/);

  // 开一个带工具的长任务
  await page.fill('#composer-text', '用 bash 工具运行 sleep 14，然后说明你运行了什么命令。(E2E引导)');
  await page.click('.send-button');
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    return r && r.messages.some(m => m.streaming);
  }, null, { timeout: 40000 });
  const runId = await page.evaluate(() => CS.state.currentRunId);
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    const reply = (r?.messages || []).slice(-1)[0];
    return reply && Array.isArray(reply.blocks) && reply.blocks.some(bl => bl.type === 'tool' && bl.result == null);
  }, null, { timeout: 60000 });

  // 场景 1: 占位符切换 + steer 按钮随打字出现
  const ph = await page.evaluate(() => document.getElementById('composer-text')?.placeholder || '');
  log('placeholder', ph.slice(0, 16));
  await page.evaluate(() => {
    const ta = document.getElementById('composer-text');
    ta.value = '请以【引导收到】开头回答 6+6 等于几。'; CS.ui.composer = ta.value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const btnShown = await page.evaluate(() => !!document.querySelector('.send-steer'));
  log('steer-btn', btnShown);
  await page.click('.send-steer');
  await page.waitForTimeout(1600);

  // 场景 2: 单回复不并发 + 引导消息带角标
  const mid = await page.evaluate(() => {
    const r = CS.currentRun();
    return {
      assistantCount: r.messages.filter(m => m.role === 'assistant').length,
      streamingCount: r.messages.filter(m => m.streaming).length,
      // 引导行形态: 内嵌进回复块时间线(steer 块)或独立 user 行(旧版/fallback), 合计
      steerRows: r.messages.filter(m => m.steering).length + (r.messages.find(m2 => m2.role === 'assistant' && m2.blocks)?.blocks || []).filter(b => b.type === 'steer').length,
      badge: !!document.querySelector('.steer-badge'),
    };
  });
  log('during-steer', mid);

  // 场景 3: 并发 chat.send 被拒
  const dup = await page.evaluate(async id => {
    try { await CS.api.ws.send('chat.send', { runId: id, messages: [{ role: 'user', content: '并发消息' }] }); return 'NOT-REJECTED'; }
    catch (e) { return /已有回复正在生成/.test(String(e.message || e)) ? 'rejected' : String(e).slice(0, 60); }
  }, runId);
  log('dup-send', dup);

  // 等完成 → 场景 4: 模型回应引导 + 场景 5: 徽章刷新持久化
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    return r && !r.messages.some(m => m.streaming);
  }, null, { timeout: 200000 });
  const final = await page.evaluate(() => {
    const last = (CS.currentRun().messages || []).slice(-1)[0] || {};
    return { ack: /引导收到/.test(last.content || ''), err: !!last.error };
  });
  log('final-ack', final);

  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForTimeout(8000);
  await page.evaluate(id => { CS.navigate('chat', id); }, runId);
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => ({
    steerRows: (() => { const rr = CS.currentRun(); if (!rr) return 0; const rows = rr.messages.filter(m => m.steering).length; const reply = [...rr.messages].reverse().find(m2 => m2.role === 'assistant' && m2.blocks); return rows + (reply?.blocks || []).filter(b => b.type === 'steer').length; })(),
    badge: !!document.querySelector('.steer-badge'),
  }));
  log('badge-after-refresh', after);

  // 场景 6: 互斥自动转引导(隐藏本地流式标记, 强制普通发送撞互斥)
  await page.fill('#composer-text', '用 bash 工具运行 sleep 12，然后一句话总结。(E2E引导2)');
  await page.click('.send-button');
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    return r && r.messages.some(m => m.streaming);
  }, null, { timeout: 40000 });
  const run2 = await page.evaluate(() => CS.state.currentRunId);
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    const reply = (r?.messages || []).slice(-1)[0];
    return reply && Array.isArray(reply.blocks) && reply.blocks.some(bl => bl.type === 'tool' && bl.result == null);
  }, null, { timeout: 60000 });
  const autoSteer = await page.evaluate(() => {
    const run = CS.currentRun();
    return new Promise(res => {
      for (const m of run.messages) { if (m.streaming) delete m.streaming; }
      run.status = 'complete';
      const ta = document.getElementById('composer-text');
      ta.value = '竞态测试：请以【引导收到】开头回答 7+7。'; CS.ui.composer = ta.value;
      document.querySelector('form[data-form="composer"]').requestSubmit();
      const t0 = Date.now();
      const iv = setInterval(() => {
        const m = run.messages.find(x => x.steering && /竞态测试/.test(x.content || ''));
        if (m) { clearInterval(iv); res({ converted: true, dupUser: run.messages.filter(x => x.role === 'user' && /竞态测试/.test(x.content || '')).length, errBlocks: run.messages.filter(x => x.error).length }); }
        else if (Date.now() - t0 > 10000) { clearInterval(iv); res({ converted: false }); }
      }, 200);
    });
  });
  log('mutex-auto-steer', autoSteer);
  await page.waitForFunction(() => { const r = window.CS && CS.currentRun(); return r && !r.messages.some(m => m.streaming); }, null, { timeout: 200000 }).catch(() => {});

  const failures = [];
  if (!/生成中/.test(ph)) failures.push('placeholder');
  if (!btnShown) failures.push('steer-btn');
  if (mid.assistantCount !== 1 || mid.streamingCount !== 1 || mid.steerRows !== 1 || !mid.badge) failures.push('during-steer');
  if (dup !== 'rejected') failures.push('dup-send');
  if (!final.ack || final.err) failures.push('final-ack');
  if (after.steerRows !== 1 || !after.badge) failures.push('badge-after-refresh');
  if (!autoSteer.converted || autoSteer.dupUser !== 1 || autoSteer.errBlocks !== 0) failures.push('mutex-auto-steer');
  if (failures.length) { console.error('未通过:', failures.join(',')); process.exit(1); }
  console.log('PASS: 引导按钮/插话回显/单回复/并发拒绝/模型回应/徽章持久化/互斥自动转全链路');

  await cleanupConversations(page, /E2E引导|数到 1[0-9]/);
} finally {
  await browser.close();
}
