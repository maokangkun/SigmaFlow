/** 锚点跳转落点回归: 长会话(含动态增高内容)点最后一个锚点必须落到最后一轮
 * 提问处。曾经: present 卡/图片在滚动进行中持续撑高容器, smooth 动画锁定
 * 启动时刻的目标, 落点停在半路(距目标还有几千像素)。
 *
 * 会话由套件自建(前端内存注入多轮长消息), 不依赖服务器上任何具体会话 id ——
 * 固定 id 的会话被删除后套件会永久空转(结构检查直接跳过)。注入只改内存,
 * 不触发 upsert, 无需清理。 */
import { probe, skip, launch, log, BASE } from './helpers.mjs';

const p = await probe();
if (!p.up) skip(`服务不可达(${p.reason})`);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
try {
  await page.goto(`${BASE}/science/#/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForTimeout(3000);

  // 注入 6 轮合成消息: 每轮 user 短问 + assistant 长答(数千字 + present 卡),
  // 保证单轮高度远超视口、整页可滚动距离足够大
  const seeded = await page.evaluate(() => {
    const filler = n => `段落${n}。` + '这是一段用于撑高页面的回复正文，包含足够多的文字使得单轮消息的高度明显超过一屏。'.repeat(30);
    const msgs = [];
    for (let i = 1; i <= 6; i++) {
      msgs.push({ role: 'user', content: `第 ${i} 轮提问：请展开说明主题 ${i}。(E2E锚点)`, at: Date.now() - (7 - i) * 60000 });
      msgs.push({
        role: 'assistant', content: filler(i), at: Date.now() - (7 - i) * 60000 + 30000, elapsed: 1200,
        blocks: [
          { type: 'think', text: `分析主题 ${i} 的思路记录。` },
          { type: 'text', text: filler(i) },
          { type: 'present', name: `报告 ${i}`, path: `/tmp/e2e-report-${i}.md`, klass: 'doc', title: `报告 ${i}`, size: 4096 },
        ],
      });
    }
    const run = {
      id: CS.uid('run'), kind: 'chat', title: 'E2E锚点自建会话', projectId: CS.state.projectId,
      prompt: '', datasetIds: [], config: {}, messages: msgs, steps: [],
      createdAt: new Date().toISOString(), status: 'complete', progress: 0, transport: 'chat', isDemo: false,
    };
    CS.state.runs.push(run);
    CS.state.currentRunId = run.id;
    CS.navigate('chat', run.id);
    CS.render();
    return true;
  });
  await page.waitForTimeout(2000);
  const ready = await page.evaluate(() => {
    const users = document.querySelectorAll('.user-message').length;
    const rows = document.querySelectorAll('.anchor-rail-scroll .anchor-tick-row').length;
    const sc = document.querySelector('.conversation');
    return { users, rows, scrollable: sc ? sc.scrollHeight > sc.clientHeight + 2000 : false };
  });
  log('ready', JSON.stringify({ seeded, ...ready }));
  if (!seeded || ready.users < 2 || ready.rows !== ready.users) skip('合成会话注入失败或锚点结构不符, 跳过');
  if (!ready.scrollable) skip('合成会话滚动距离不足, 跳过');

  await page.evaluate(() => { const rows = [...document.querySelectorAll('.anchor-rail-scroll .anchor-tick-row')]; rows[rows.length - 1].click(); });
  // 等 smooth 动画 + 补滚落定
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.user-message')];
    const last = els[els.length - 1];
    return { lastTop: Math.round(last.getBoundingClientRect().top), viewH: innerHeight, scrollTop: Math.round(document.querySelector('.conversation').scrollTop) };
  });
  log('after-jump', JSON.stringify(st));
  if (st.lastTop > 150) throw new Error(`锚点跳转落点偏离: 最后一轮提问距视口顶 ${st.lastTop}px (>150)`);
  // 跳转后页面不准自己滚走(补滚循环卡死/来回抖)
  await page.waitForTimeout(1500);
  const st2 = await page.evaluate(() => Math.round([...document.querySelectorAll('.user-message')].pop().getBoundingClientRect().top));
  if (Math.abs(st2 - st.lastTop) > 60) throw new Error(`落点不稳定: ${st.lastTop} -> ${st2}`);
  log('pass', true);
} finally { await browser.close(); }
