/** E2E 运行器: 顺序执行所有 *.e2e.mjs, 汇总 PASS/FAIL/SKIP。
 * 依赖: tests/e2e/node_modules(首次自动 npm install)。 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(dir, 'node_modules/playwright-core'))) {
  console.log('首次运行: 安装 playwright-core(复用本机 chromium, 不下载浏览器)...');
  try {
    execSync('npm install --no-audit --no-fund', { cwd: dir, stdio: 'inherit' });
  } catch (e) {
    // 离线/registry 不可达: 按套件"环境缺失不挂红"的哲学整体 SKIP,
    // 而不是以一屏 npm 报错砸红 make test-all
    console.log('SKIP: npm install 失败(离线?), E2E 跳过 —— 有网后重跑会自动补装');
    process.exit(0);
  }
}

const suites = fs.readdirSync(dir).filter(f => f.endsWith('.e2e.mjs')).sort();
let fail = 0;
for (const suite of suites) {
  console.log(`\n===== ${suite} =====`);
  const r = spawnSync(process.execPath, [path.join(dir, suite)], { stdio: 'inherit', timeout: 8 * 60 * 1000 });
  if (r.status !== 0) { fail++; console.error(`^^^ ${suite} FAILED`); }
}
console.log(`\nE2E 汇总: ${suites.length - fail} 通过 / ${fail} 失败 (共 ${suites.length} 套)`);
process.exit(fail ? 1 : 0);
