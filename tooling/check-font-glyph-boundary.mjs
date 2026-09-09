import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {moduleClosure} from './lib/module-closure.mjs';

const root=resolve('.'),out=resolve(root,'out/font-glyphs');
mkdirSync(out,{recursive:true});
const forbidden=/harfbuzz|\.wasm|font-glyph-samples|\bcordis\b/;
const defaults={};
for(const name of ['core','edit-core','viewer-core','editor','fonts','react','vue','collab']){
  const entry=resolve(root,`packages/${name}/dist/${name}.js`),closure=moduleClosure(entry);
  if(forbidden.test(closure.source)||closure.source.includes('web-ppt-fonts/1')||closure.source.includes('eot-root-restricted')){
    throw new Error(`${name} 默认入口引入可选字体整形实现`);
  }
  defaults[name]={files:closure.files.length,raw:closure.raw,gzip:closure.gzip};
}
const pkg=JSON.parse(readFileSync(resolve(root,'packages/fonts/package.json')));
if(Object.keys(pkg.dependencies??{}).length)throw new Error('字体包不能引入 HarfBuzz 或其他运行时依赖');
const entries={};
for(const name of ['glyphs','glyphs/harfbuzz','glyphs/worker','glyphs/browser']){
  const entry=resolve(root,'packages/fonts',pkg.exports[`./${name}`].import);
  const built=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',metafile:true});
  if(Object.keys(built.metafile.inputs).some(path=>/node_modules|packages\/core\/|font-glyph-samples/.test(path)))throw new Error(`${name} 引入外部运行时或字体样本`);
  // harfbuzz 是本包适配入口的合法文件名；只有实现包或字节依赖才越界。
  if(/\bharfbuzzjs\b|\.wasm|font-glyph-samples|\bcordis\b/.test(built.outputFiles[0].text))
    throw new Error(`${name} 自动加载整形器或产品框架`);
  entries[name]=moduleClosure(entry);
  delete entries[name].source;
}
for(const name of ['glyphs','glyphs/harfbuzz','glyphs/worker']){
  if(/\b(document|DOMParser|FontFace|HTMLCanvasElement)\b/.test((await build({
    entryPoints:[resolve(root,'packages/fonts',pkg.exports[`./${name}`].import)],bundle:true,write:false,format:'esm',platform:'neutral',
  })).outputFiles[0].text))throw new Error(`${name} 不能依赖 DOM`);
}
writeFileSync(resolve(out,'boundary.json'),JSON.stringify({defaults,entries},null,2)+'\n');
console.log('字体默认 / 按需 / Worker 边界通过，整形器与字体字节均由宿主提供');
