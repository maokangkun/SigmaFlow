/**
 * 构建前端产物。两种模式:
 *
 * 1. 默认(拆分缓存模式): index.html 只留骨架, 各 CSS/JS 输出为带内容哈希的独立文件
 *    (dist/a/<name>.<hash>.js|css)。改一个文件只有那个文件换名, 其余仍命中浏览器缓存,
 *    大幅降低弱网下的重复下载量。
 * 2. 若存在 esbuild 就顺手压缩(纯可选: 找不到也不报错, 只是体积大一些)。
 * 3. 单文件离线版另存为 dist/standalone.html(整包内联, 便于离线/邮件分发)。
 *
 * 懒加载: index.html 里带 data-lazy 的 <script> 不进首屏, 输出到 dist/a/ 并登记到
 * window.__LAZY 表; 运行时用 ensureLazy('名字') 按需注入(见 js/core.js)。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'a');

// esbuild 只作为可选优化: 有就压缩, 没有就原样输出(构建不因缺工具失败)。
const esbuild = findEsbuild();
function findEsbuild() {
  const candidates = [
    process.env.ESBUILD_BIN,
    path.join(root, 'node_modules/.bin/esbuild'),
    '/data/mkk/pi-web-deploy/node_modules/.bin/esbuild',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fsSync.accessSync(c, fsSync.constants.X_OK);
      return c;
    } catch {}
  }
  return null;
}

async function minify(code, loader) {
  if (!esbuild) return code;
  try {
    const out = spawnSync(
      esbuild,
      ['--loader=' + loader, '--minify', '--charset=utf8', '--log-level=error'],
      { input: code, maxBuffer: 64 * 1024 * 1024 }
    );
    const stdout = out.stdout ? out.stdout.toString('utf8') : '';
    // 压缩失败或空输出时退回原文, 保证构建总能产出可用文件。
    return out.status === 0 && stdout.length > 0 ? stdout : code;
  } catch {
    return code;
  }
}

const read = (rel) => fs.readFile(path.join(root, rel), 'utf8');
const hash8 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);

let html = await read('index.html');

const emitted = []; // { rel, out, raw, min }
const urlOf = new Map(); // 源路径 -> 新 URL

async function emitAsset(src, loader, content) {
  const min = await minify(content, loader);
  const base = path.basename(src).replace(/\.(js|css)$/, '');
  const ext = path.extname(src);
  const name = `${base}.${hash8(min)}${ext}`;
  await fs.writeFile(path.join(assets, name), min);
  const total = Buffer.byteLength(min);
  emitted.push({ src, out: `a/${name}`, raw: Buffer.byteLength(content), min: total });
  urlOf.set(src, `a/${name}`);
  return min;
}

// 清理上一轮产物: 旧哈希文件不再被引用, 留着只会占用仓库与磁盘。
await fs.rm(assets, { recursive: true, force: true });
await fs.mkdir(assets, { recursive: true });

// ---- 样式: 全部拆分(首个 HTML 即刻申请, 天然并行下载) ----
for (const m of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]) {
  const src = m[1];
  const min = await emitAsset(src, 'css', await read(src));
  html = html.replace(m[0], () => `<link rel="stylesheet" href="${urlOf.get(src)}">`);
}

// ---- 脚本: 首屏同步(defer 保序) + data-lazy 懒加载 ----
const lazyMap = {};
// 属性顺序不限: <script src=...> 与 <script data-lazy src=...> 都要匹配。
for (const m of [...html.matchAll(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g)]) {
  const src = m[2];
  const attrs = (m[1] || '') + (m[3] || '');
  const lazy = /data-lazy/.test(attrs);
  const code = await read(src);
  const min = await emitAsset(src, 'js', code);
  const url = urlOf.get(src);
  if (lazy) {
    const key = path.basename(src).replace(/\.js$/, '');
    lazyMap[key] = url;
    html = html.replace(m[0], () => '');
  } else {
    html = html.replace(m[0], () => `<script defer src="${url}"></script>`);
  }
}
html = html.replace(
  /<\/head>/i,
  () => `  <script>window.__LAZY=${JSON.stringify(lazyMap)};</script>\n</head>`
);

// ---- 静态资产: 不内联, 由 StaticFiles 随站点提供 ----
await fs.cp(path.join(root, 'js/vendor/draco'), path.join(dist, 'vendor/draco'), { recursive: true });
await fs.cp(path.join(root, 'assets/cell'), path.join(dist, 'cell'), { recursive: true });
// 虚拟患者素材: PNG/音效 wav 与 Draco 压缩全身器官 GLB(16MB, 页面按需 fetch)
await fs.cp(path.join(root, 'assets/patient'), path.join(dist, 'patient'), { recursive: true });

// ---- 构建烙印: 前端展示构建号, 便于确认浏览器跑的是新包 ----
const buildId = hash8(
  emitted.map((e) => e.out).join('|') + html
);
html = html.replace(/<head>/i, () => `<head>\n<meta name="build" content="${buildId}">`);
await fs.writeFile(path.join(dist, 'index.html'), html);

// ---- 离线单文件版: 全部内联(只在需要分发时使用) ----
let standalone = await read('index.html');
for (const e of emitted) {
  const min = await fs.readFile(path.join(dist, e.out), 'utf8');
  const escCss = min.replace(/<\/style/gi, '<\\/style');
  const escJs = min.replace(/<\/script/gi, '<\\/script');
  // 单文件版: 懒加载脚本也一并内联(离线场景没有网络可等), 属性顺序不限。
  const srcRe = e.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  standalone = standalone
    .replace(`<link rel="stylesheet" href="${e.src}">`, () => `<style>${escCss}</style>`)
    .replace(
      new RegExp(`<script([^>]*?)\\ssrc="${srcRe}"([^>]*)></script>`),
      () => `<script>${escJs}</script>`
    );
}
standalone = standalone.replace(/<head>/i, () => `<head>\n<meta name="build" content="${buildId}">`);
await fs.writeFile(path.join(dist, 'standalone.html'), standalone);

const sum = (k) => emitted.reduce((a, e) => a + e[k], 0);
const kb = (n) => (n / 1024).toFixed(1);
console.log(
  `Split build: dist/index.html (${kb(Buffer.byteLength(html))} KB, ${emitted.length} assets) ` +
    `build=${buildId}${esbuild ? ' minified' : ' unminified'}`
);
console.log(`  assets raw ${kb(sum('raw'))} KB -> ${kb(sum('min'))} KB`);
console.log(`  standalone.html ${kb(Buffer.byteLength(standalone))} KB (offline bundle)`);
for (const e of emitted.sort((a, b) => b.min - a.min)) {
  console.log(`   ${e.out}  ${kb(e.raw)} -> ${kb(e.min)} KB`);
}
