import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { resolve, join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { Buf, cat, plus, emf, comment, header, eof, object, solidBrush, file, example, version } from './lib/emf-plus-fixture.mjs';
import { recordCount } from './lib/measured.mjs';
const root=resolve('.'),out=join(root,'out/emf-plus');mkdirSync(out,{recursive:true});
const entry=join(out,'entry.mjs');writeFileSync(entry,`export * from '${root}/packages/core/src/emf-plus.ts';export * as core from '${root}/packages/core/src/index.ts';`);
const bundled=await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[['@web-ppt/core',join(root,'packages/core/src/index.ts')]]});
const api=process.argv.includes('--dist') ? {...await import('@web-ppt/core/emf-plus'),core:await import('@web-ppt/core')} : bundled;
let count=0;
const check=(condition,label)=>{assert(condition,label);count++;};
for(const dual of[false,true]){
 const result=api.decodeEmfPlus(example({dual}));check(result.mode==='emf-plus',result.reason);check(result.svg.includes('#4477cc80'),'透明色');
 check(result.svg.includes('C80 10 120 200 180 100'),'原生三次曲线');check(result.svg.includes('linearGradient'),'渐变');
 check(result.svg.includes('clipPath'),'裁剪');check(result.svg.includes('data:image/png;base64'),'位图');check(result.svg.includes('EMF+ 中文 text'),'原生中文文本');
 check(!result.svg.includes('#00ff00'),'双格式只绘制一次');writeFileSync(join(out,`${dual?'dual':'only'}.svg`),result.svg);
}
const unsupported=api.decodeEmfPlus(example({unknown:true}));check(unsupported.mode==='unsupported'&&unsupported.svg===null,'Only 未支持的记录明确失败');
const fallback=api.decodeEmfPlus(example({dual:true,unknown:true}));check(fallback.mode==='emf-fallback'&&fallback.svg.includes('#00ff00'),'Dual 整体回退');check(!fallback.svg.includes('linearGradient'),'回退不混入部分 EMF+');
const draw=plus(0x400a,0x8000,b=>b.u32(0xffff0000).u32(1).rect(0,0,10,10));
const partial=solidBrush(0xffabcd12),a=plus(0x4008,0x8100,b=>b.u32(partial.length).raw(partial.subarray(0,8))),b=plus(0x4008,0x0100,b=>b.u32(partial.length).raw(partial.subarray(8)));
const continued=api.decodeEmfPlus(file([comment(header(false),a),comment(b,plus(0x400a,0,q=>q.u32(0).u32(1).rect(0,0,20,20)),eof())]));check(continued.mode==='emf-plus'&&continued.svg.includes('#abcd12ff'),'跨注释继续对象');
check(api.decodeEmfPlus(file([comment(header(false),a,eof())])).mode==='unsupported','拒绝未完成对象');
const compressed=new Buf().u32(version).u32(4).u32(0x800).raw([10,10,20,0,0,20,108,0,0,0x42,1,0x81]).bytes;
const rle=api.decodeEmfPlus(file([comment(header(false),object(3,0,compressed),plus(0x4014,0x8000,q=>q.u32(0xffaaaaaa)),eof())]));
check(rle.mode==='emf-plus',rle.reason);check(rle.svg.includes('M10 10L30 10L30 30L10 30Z'),'相对坐标及 RLE 类型');
const dc=api.decodeEmfPlus(file([comment(header(false),draw,plus(0x4004)),emf(43,new Buf().u32(20).u32(20).u32(30).u32(30).bytes),comment(draw,eof())]));
check(dc.mode==='emf-plus'&&dc.svg.includes('#ffffff'),'GetDC 绘制普通 EMF 段');check((dc.svg.match(/#ff0000ff/g)||[]).length===2,'GetDC 后恢复 EMF+');
const transformed=api.decodeEmfPlus(file([comment(header(false),plus(0x4030,3,q=>q.f(1)),plus(0x402d,0,q=>q.f(10).f(20)),draw,eof())]));
check(transformed.svg.includes('matrix(1.33 0 0 1.33 13.33 26.67)'),'点单位与世界坐标转换');
const cleared=api.decodeEmfPlus(file([comment(header(false),draw,plus(0x4009,0,q=>q.u32(0)),eof())]));
check(cleared.mode==='emf-plus'&&!cleared.svg.includes('#ff0000ff')&&cleared.svg.includes('#00000000'),'透明 Clear 移除先前内容');
const corpus=join(root,'corpus/poi/at.ecodesign.www_downloads_Vertiefungsvortrag_elektronik.pptx');
if(existsSync(corpus)){
 const parts=unzipSync(readFileSync(corpus));
 for(const name of['image18.emf','image28.emf']){
  const r=api.decodeEmfPlus(parts['ppt/media/'+name]);assert(r.mode==='emf-plus',r.reason);
  assert(/<(path|text|image)\s/.test(r.svg),'真实 Office GetDC 内容不可丢失');writeFileSync(join(out,name+'.svg'),r.svg);
 }
}
for(const bytes of[example().subarray(0,100),file([comment(header(false),draw)]),file([comment(header(false),plus(0x400a,0x8000,q=>q.u32(0).u32(0xffffffff)),eof())])])check(api.decodeEmfPlus(bytes).mode==='unsupported','损坏输入拒绝');
const source=readFileSync(join(root,'fixtures/sample-emf-plus.pptx'));api.enableEmfPlus();const p=await api.core.parse(source,{lazy:false});
const svg=api.core.renderSlideToSvg(p,p.slides[0],{textMode:'svg'});check(svg.includes('linearGradient')||decodeURIComponent(svg).includes('linearGradient'),'PPTX 实际图片解析');p.dispose();
check(api.decodeEmfPlus(new Uint8Array([1,2,3])).mode==='absent','其他格式交还默认解码器');
recordCount('emfPlus',count);console.log(`EMF+ ${count} 项通过`);
