/** E2E 共用工具: 服务探测 / 浏览器启动 / 页面引导 / 会话清理。
 *
 * 服务与模型是外部依赖: 套件在无服务时整体 SKIP(exit 0), 无模型时跳过
 * 需要真实生成的场景(纯 UI 场景照跑) —— make tests 与 CI 不因此挂红。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BASE = process.env.SIGMAFLOW_E2E_BASE || 'https://10.140.177.73:8888/sigmaflow';

export async function probe() {
  const out = { base: BASE, up: false, models: false, reason: '' };
  try {
    const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(5000) });
    out.up = r.ok;
  } catch (e) {
    out.reason = String(e.cause?.code || e.message).slice(0, 80);
  }
  if (out.up) {
    try {
      const r = await fetch(BASE + '/api/models', { credentials: 'include', signal: AbortSignal.timeout(5000) });
      const j = await r.json().catch(() => ({}));
      out.models = Array.isArray(j.models) && j.models.length > 0;
    } catch { /* 无模型: UI 场景仍可跑 */ }
  }
  return out;
}

export function skip(msg) {
  console.log(`SKIP: ${msg}`);
  process.exit(0);
}

/** playwright-core 不下载浏览器: 复用本机 ~/.cache/ms-playwright 的 chromium。 */
export function chromiumPath() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(cache, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

let pw = null;
export async function launch() {
  if (!pw) pw = await import('playwright-core');
  const exe = chromiumPath();
  if (!exe) skip('本机无 chromium 二进制(~/.cache/ms-playwright); 先跑任意 playwright 安装');
  const browser = await pw.chromium.launch({
    executablePath: exe,
    args: ['--ignore-certificate-errors'],
  });
  return browser;
}

export async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => { throw new Error('页面异常: ' + String(e).slice(0, 200)); });
  await page.goto(BASE + '/science/#/home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CS && CS.state && CS.ui, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  return page;
}

export async function sendAndWaitDone(page, prompt, { timeout = 180000 } = {}) {
  await page.fill('#composer-text', prompt);
  await page.click('.send-button');
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    return r && r.messages.some(m => m.streaming);
  }, null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const r = window.CS && CS.currentRun();
    return r && !r.messages.some(m => m.streaming);
  }, null, { timeout });
}

/** 删除测试会话(标题匹配); 返回删除数。 */
export async function cleanupConversations(page, pattern) {
  return page.evaluate(async re => {
    let n = 0;
    for (const c of CS.ui.conversations || []) {
      if (new RegExp(re).test(c.title || '')) {
        try { await fetch('/sigmaflow/api/conversations/' + c.id, { method: 'DELETE', credentials: 'include' }); n++; } catch {}
      }
    }
    return n;
  }, pattern.source);
}

export function log(key, value) {
  console.log(key, JSON.stringify(value));
}
