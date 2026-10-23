import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {bundleBrowser} from './lib/bundle-browser.mjs';
import * as hb from 'harfbuzzjs';
import Ajv from 'ajv';
const root=resolve(import.meta.dirname,'..'),out=join(root,'out/agent-lint');mkdirSync(out,{recursive:true});
const dist=process.argv.includes('--dist');
const modules={core:'core/src/index.ts',edit:'edit-core/src/index.ts',lint:'edit-core/src/lint/index.ts',sampler:'edit-core/src/lint/sampler.ts',fonts:'fonts/src/glyphs/index.ts',fontHb:'fonts/src/glyphs/harfbuzz.ts'};
const publicNames={core:'@web-ppt/core',edit:'@web-ppt/edit-core',lint:'@web-ppt/edit-core/lint',sampler:'@web-ppt/edit-core/lint/sampler',fonts:'@web-ppt/fonts/glyphs',fontHb:'@web-ppt/fonts/glyphs/harfbuzz'};
const entry=join(out,'entry.mjs');writeFileSync(entry,Object.entries(modules).map(([name,file])=>`export * as ${name} from ${JSON.stringify(dist?publicNames[name]:join(root,'packages',file))};`).join('\n'));
let api;
if(dist){
 const metadata=join(out,'dist-metafile.json');
 execFileSync('npx',['esbuild',entry,'--bundle','--platform=browser','--format=esm','--log-level=error',`--tsconfig=${join(root,'tooling/tsconfig.agent-lint-dist.json')}`,`--metafile=${metadata}`,`--outfile=${join(out,'runtime.mjs')}`],{cwd:root,stdio:'inherit'});
 for(const input of Object.keys(JSON.parse(readFileSync(metadata,'utf8')).inputs))assert(!/(?:^|\/)packages\/[^/]+\/src\//.test(input),`发布复验不得混入源码：${input}`);
 api=Object.fromEntries(await Promise.all(Object.entries(publicNames).map(async([name,path])=>[name,await import(path)])));
}
else api=await bundleBrowser({root,entry,output:join(out,'runtime.mjs')});
const {core,edit,lint}=api;
const pres=await core.parse(readFileSync('fixtures/sample-agent-lint.pptx'),{edit:true,keepPackage:true,lazy:false});
const doc=edit.createDoc(pres,{idPrefix:'lint-'}),before=JSON.stringify(doc);
// 真实字体测量在浏览器契约中提供；此处只跑不依赖排版的检查。
const checks=['off-canvas','element-overlap','missing-font','placeholder-prompt-left','image-distorted'];
const options={checks,fonts:{available:['WebPPT Glyph Latin'],embedded:[]}};
const report=await lint.lintPresentation(doc,options);
for(const [page,reason] of [[3,'element-overlap'],[5,'off-canvas'],[9,'missing-font'],[11,'placeholder-prompt-left'],[13,'image-distorted']])assert(report.issues.some(i=>i.slideNumber===page&&i.reason===reason),`${page} ${reason}`);
for(const [page,reason] of [[4,'element-overlap'],[6,'off-canvas'],[10,'missing-font'],[12,'placeholder-prompt-left'],[14,'image-distorted'],[15,'image-distorted']])assert(!report.issues.some(i=>i.slideNumber===page&&i.reason===reason),`${page} ${reason} 反例`);
assert.equal(JSON.stringify(doc),before);
await assert.rejects(lint.lintPresentation(doc),e=>e.reason==='measurement-required');
await assert.rejects(lint.lintPresentation(doc,{checks:['missing-font']}),e=>e.reason==='font-inventory-required');
await assert.rejects(lint.lintPresentation(doc,{checks:['off-canvas'],tolerancePx:-1}),e=>e.reason==='invalid-options');
await assert.rejects(lint.lintPresentation(doc,{checks:['off-canvas'],maxIssues:0}),e=>e.reason==='invalid-options');
const controller=new AbortController();controller.abort();await assert.rejects(lint.lintPresentation(doc,{signal:controller.signal}),e=>e.reason==='aborted');
const cancel=new AbortController();await assert.rejects(lint.lintPresentation(doc,{...options,signal:cancel.signal,onProgress:()=>cancel.abort()}),e=>e.reason==='aborted');
assert.equal(JSON.stringify(doc),before);
const provider=api.fonts.createFontProvider({loadShaper:async()=>api.fontHb.createHarfBuzzShaper(hb)});
assert.equal((await provider.register({id:'latin',origin:'explicit',bytes:new Uint8Array(readFileSync('tooling/font-glyph-samples/latin.ttf'))},{purpose:'edit'})).ok,true);
const prepared=await api.fonts.withFontMeasurement(provider,m=>lint.prepareLintText(doc,m),{purpose:'edit',language:'en',faceForRun:()=> 'latin'});
assert.equal(prepared.ok,true,JSON.stringify(prepared));
const completeOptions={fonts:options.fonts,measureText:prepared.value.measureText};
const fixtureContrast=c=>{
 assert.equal(c.slideNumber,3);
 // 该固件两个无填充文本框的文字分别位于 y=40 / 70，不在彼此的字形上；原始颜色为黑/白。
 return [{foreground:c.run.color,background:'#ffffff'}];
};
const full=await lint.lintPresentation(doc,{...completeOptions,resolveContrast:fixtureContrast});
const validate=new Ajv({strict:false}).compile(JSON.parse(readFileSync('packages/edit-core/schemas/lint.schema.json','utf8')));
assert(validate(full),JSON.stringify(validate.errors));
assert(!validate({...full,version:2}),'协议版本必须经过发布 Schema 校验');
for(const reason of lint.LAYOUT_CHECKS)assert(full.issues.some(i=>i.reason===reason),reason+' 真实字体正例');
for(const [page,reason]of [[2,'text-overflow'],[8,'low-contrast']])assert(!full.issues.some(i=>i.slideNumber===page&&i.reason===reason));
const editor=new edit.Editor(doc),id=doc.slides[doc.slideOrder[7]].children[0];
const narrowId=doc.slides[doc.slideOrder[1]].children[0];
for(const align of ['left','center','right']){
 editor.transaction(tx=>{
  tx.exec({type:'SetXfrm',id:narrowId,w:1,h:300});
  tx.exec({type:'SetParaProps',id:narrowId,range:{from:{p:0,r:0,off:0},to:{p:0,r:0,off:5}},props:{align}});
 },'字形溢出边界');
 const widths=await api.fonts.withFontMeasurement(provider,m=>lint.prepareLintText(doc,m),{purpose:'edit',language:'en',faceForRun:()=> 'latin'});
 assert(widths.ok);
 const narrow=await lint.lintPresentation(doc,{checks:['text-overflow'],measureText:widths.value.measureText});
 assert(narrow.issues.some(i=>i.elementId===narrowId&&i.measurements.widthOverflow>0),`${align} 对齐仍检测超宽字形`);
 editor.undo();
}
const outsideId=doc.slides[doc.slideOrder[4]].children[0];
const captured=await lint.lintPresentation(doc,{checks:['off-canvas'],onProgress:({completed})=>{
 if(completed===1)editor.exec({type:'SetXfrm',id:outsideId,x:100});
}});
assert(captured.issues.some(i=>i.elementId===outsideId),'等待期间编辑不改变调用时快照');
assert(!(await lint.lintPresentation(doc,{checks:['off-canvas']})).issues.some(i=>i.elementId===outsideId),'新调用读取最新投影');
editor.undo();
editor.exec({type:'Group',ids:[...doc.slides[doc.slideOrder[2]].children]});
const grouped=await lint.lintPresentation(doc,{...completeOptions,resolveContrast:fixtureContrast});
assert(!grouped.issues.some(i=>i.slideNumber===3),'普通组合不重复检查子元素，也不互报重叠');
editor.undo();
editor.exec({type:'SetElementHidden',id:doc.slides[doc.slideOrder[2]].children[0],hidden:true});
editor.exec({type:'SetFill',id,fill:{type:'gradient',angle:0,stops:[{pos:0,color:'#ffffff'},{pos:1,color:'#ffffff'}]}});
await assert.rejects(lint.lintPresentation(doc,completeOptions),e=>e.reason==='contrast-sampler-required'&&e.slideNumber===8);
const resolved=await lint.lintPresentation(doc,{...completeOptions,resolveContrast:async c=>[{foreground:c.run.color,background:'#ffffff'}]});
assert(!resolved.issues.some(i=>i.slideNumber===8&&i.reason==='low-contrast'),'宿主采样恢复均为白色的真实渐变');
const latest=JSON.stringify(doc),during=new AbortController();let resume;
const cancelled=lint.lintPresentation(doc,{...completeOptions,signal:during.signal,resolveContrast:()=>new Promise(resolve=>{resume=resolve;setTimeout(()=>during.abort(),0);})});
await assert.rejects(cancelled,e=>e.reason==='aborted');resume([{foreground:'#000000',background:'#ffffff'}]);
assert.equal(JSON.stringify(doc),latest,'取消和迟到回调不改文档');
await assert.rejects(lint.lintPresentation(doc,{checks:['off-canvas'],onProgress:()=>{throw new Error('progress');}}),e=>e.reason==='progress-callback-failed');
editor.undo();provider.dispose();editor.dispose();
writeFileSync(join(out,'unit-report.json'),JSON.stringify(report,null,2));
pres.dispose();
console.log('布局检查几何、字体、提示、裁剪、取消与只读契约通过');
