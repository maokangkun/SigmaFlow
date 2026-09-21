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
await fs.writeFile(path.join(root,'dist/index.html'),html);
console.log(`Standalone build: dist/index.html (${(Buffer.byteLength(html)/1024).toFixed(1)} KB)`);
