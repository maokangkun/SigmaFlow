/** 前端纯逻辑单元测试(vm 沙箱, 零依赖) —— check.mjs 覆盖语法与 core 纯函数,
 * 这里覆盖按需加载的页面模块: patho3d 的几何助手(斐波那契球面/螺旋管曲线)。
 * 用法: node scripts/unittest.mjs (由 make science-regression 调用) */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// patho/patho3d.js 是浏览器 IIFE(挂 window.Patho3D); 沙箱里给它一个 window
const context = { window: {}, console, Math, Date, Map, Set };
context.globalThis = context;
context.globalThis = new Proxy(context, { get: (t, k) => (k in t ? t[k] : undefined) });
vm.createContext(context);
const src = await fs.readFile(path.join(root, 'js/patho/patho3d.js'), 'utf8');
vm.runInContext(src, context);
const geom = context.window.Patho3D._geom;
assert.ok(geom, 'Patho3D._geom 导出缺失(测试后门被删了?)');

// fibSphere: 点数守恒 + 全部落在球面上 + 无重复点(均匀分布的基本形态)
{
  const pts = geom.fibSphere(38, 60);
  assert.equal(pts.length, 38);
  for (const [x, y, z] of pts) {
    const r = Math.sqrt(x * x + y * y + z * z);
    assert.ok(Math.abs(r - 60) < 1e-6, `点不在球面: r=${r}`);
  }
  const seen = new Set(pts.map(p => p.map(v => v.toFixed(3)).join(',')));
  assert.equal(seen.size, 38, '斐波那契球面出现重复点');
}

// fibSphere 端点: 首末点分别贴近两极(y=±r)
{
  const pts = geom.fibSphere(25, 40);
  assert.ok(Math.abs(pts[0][1] - 40) < 1e-6, '首点应在 +y 极');
  assert.ok(Math.abs(pts[24][1] + 40) < 1e-6, '末点应在 -y 极');
}

// helixPts: 点数随圈数增加 + 首末点覆盖 len 区间 + 半径上界
{
  const few = geom.helixPts(2, 5, 40);
  const many = geom.helixPts(8, 5, 40);
  // 采样密度 n = max(24, turns*14), 再 +1 收两端
  assert.equal(few.length, 2 * 14 + 1);
  assert.equal(many.length, 8 * 14 + 1);
  const ys = many.map(p => p[1]);
  assert.ok(Math.abs(Math.max(...ys) - 20) < 1e-6 && Math.abs(Math.min(...ys) + 20) < 1e-6, '螺旋应覆盖 ±len/2');
  for (const p of many) {
    const lateral = Math.sqrt((p[0] - 0) ** 2 + (p[2] - 0) ** 2);
    assert.ok(lateral <= 5 + 2 + 1e-6, `螺旋横向半径越界: ${lateral}`);  // r + wobble
  }
}

// helixPts 相位: 相位差 π 的两条螺旋在同一 t 的横向坐标近似相反
{
  const a = geom.helixPts(1, 4, 10, 0);
  const b = geom.helixPts(1, 4, 10, Math.PI);
  const i = Math.floor(a.length / 2);
  assert.ok(a[i][0] * b[i][0] < 0, '相位差 π 的螺旋横向坐标应反号(朊粒双股交织的几何基础)');
}

console.log('PASS: patho3d fibSphere(点数/球面/无重复/极点) 与 helixPts(密度/区间/半径/相位)。');
