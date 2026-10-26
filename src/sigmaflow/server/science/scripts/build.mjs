/** Create a fully standalone, offline HTML. No bundler dependencies needed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let html=await fs.readFile(path.join(root,'index.html'),'utf8');
for(const match of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]){
  const css=await fs.readFile(path.join(root,match[1]),'utf8');
  html=html.replace(match[0],()=>`<style>\n/* ${match[1]} */\n${css.replace(/<\/style/gi,'<\\/style')}\n</style>`);
}
for(const match of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]){
  const code=await fs.readFile(path.join(root,match[1]),'utf8');
  html=html.replace(match[0],()=>`<script>\n/* ${match[1]} */\n${code.replace(/<\/script/gi,'<\\/script')}\n</script>`);
}
await fs.mkdir(path.join(root,'dist'),{recursive:true});
// 静态资产同步: Draco 解码器(js/vendor/draco)与虚拟细胞模型/预览图(assets/cell)
// 不参与内联, 拷贝进 dist 由 StaticFiles 随站点一并提供 —— 资产留在本仓库内,
// 不再引用兄弟站点的任何可执行代码或素材。
await fs.cp(path.join(root,'js/vendor/draco'),path.join(root,'dist/vendor/draco'),{recursive:true});
await fs.cp(path.join(root,'assets/cell'),path.join(root,'dist/cell'),{recursive:true});
// 版本搬戳: 前端页面展示构建号, 便于确认浏览器加载的是新 bundle（SPA 不刷新永远跑旧代码）
const crypto=await import('node:crypto');
const shortHash=crypto.createHash('md5').update(html).digest('hex').slice(0,8);
html=html.replace(/<head>/i,()=>`<head>\n<meta name="build" content="${shortHash}">`);
await fs.writeFile(path.join(root,'dist/index.html'),html);
console.log(`Standalone build: dist/index.html (${(Buffer.byteLength(html)/1024).toFixed(1)} KB) build=${shortHash}`);
