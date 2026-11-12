/** 锚点跳转落点回归: 长会话(含动态增高内容)点最后一个锚点必须落到最后一轮
 * 提问处。曾经: present 卡/图片在滚动进行中持续撑高容器, smooth 动画锁定
 * 启动时刻的目标, 落点停在半路(距目标还有几千像素)。 */
import { probe, skip, launch, log, BASE } from './helpers.mjs';

const TARGET_CONV = 'run-23ea66ae-e526-4e37-aaf0-9a5693db85ec';  // 真实长会话(只读)

const p = await probe();
if (!p.up) skip(`服务不可达(${p.reason})`);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
try {
  await page.goto(`${BASE}/science/#/chat/${TARGET_CONV}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForTimeout(8000);
  const ready = await page.evaluate(() => {
    const users = document.querySelectorAll('.user-message').length;
    const rows = document.querySelectorAll('.anchor-rail-scroll .anchor-tick-row').length;
    return { users, rows };
  });
  log('ready', JSON.stringify(ready));
  if (ready.users < 2 || ready.rows !== ready.users) skip('目标会话消息/锚点结构不符(可能已删除), 跳过');

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
