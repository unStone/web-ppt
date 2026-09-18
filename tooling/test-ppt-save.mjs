import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {recordCount} from './lib/measured.mjs';
const out='out/ppt-save';mkdirSync(out,{recursive:true});
const dist=process.argv.includes('--dist');
writeFileSync(`${out}/entry.mjs`,dist?`export * as core from '@web-ppt/core';export * as edit from '@web-ppt/edit-core';export * as ppt from '@web-ppt/edit-core/ppt';export * as cfb from '@web-ppt/edit-core/cfb';`:
 `export * as core from '../../packages/core/src/index.ts';export * as edit from '../../packages/edit-core/src/index.ts';export * as ppt from '../../packages/edit-core/src/ppt/index.ts';export * as cfb from '../../packages/edit-core/src/cfb/index.ts';`);
execFileSync('npx',['esbuild',`${out}/entry.mjs`,'--bundle','--platform=browser','--format=esm',`--tsconfig=${dist?'tsconfig.base.json':'tsconfig.json'}`,`--outfile=${out}/contract.mjs`,'--log-level=error'],{stdio:'inherit'});
const {core,edit,ppt,cfb}=dist?Object.fromEntries(await Promise.all([['core','@web-ppt/core'],['edit','@web-ppt/edit-core'],['ppt','@web-ppt/edit-core/ppt'],['cfb','@web-ppt/edit-core/cfb']].map(async([key,path])=>[key,await import(path)]))):await import(`../${out}/contract.mjs?${Date.now()}`);
let count=0;const check=(c,label)=>{assert(c,label);count++;};
const text=e=>e.text?.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');
const walk=elements=>elements.flatMap(e=>[e,...e.kind==='group'?walk(e.children):[]]);
function validateDirectory(bytes){
 const file=cfb.readCompoundFile(bytes),doc=file.entries.find(e=>e.name==='PowerPoint Document').bytes;
 const current=file.entries.find(e=>e.name==='Current User').bytes;
 const user=new DataView(current.buffer,current.byteOffset,current.length),v=new DataView(doc.buffer,doc.byteOffset,doc.length);
 const edit=user.getUint32(16,true);check(v.getUint16(edit+2,true)===0xff5,'Current User 指向真正的 UserEditAtom');
 const dir=v.getUint32(edit+20,true);check(v.getUint16(dir+2,true)===0x1772,'UserEdit 指向持久化目录');
 const count=v.getUint32(dir+8,true)>>>20;check(count>=3,'文档、母版和页面都是持久对象');
 check(v.getUint16(v.getUint32(dir+12,true)+2,true)===1000,'persistId 1 对应 DocumentContainer');
}
for(const name of ['sample.ppt','sample-ppt-edit.pptx']){
 const source=await core.parse(readFileSync(`fixtures/${name}`),{edit:true,keepPackage:true,lazy:false}),doc=edit.createDoc(source),editor=new edit.Editor(doc);
 const id=doc.slides[doc.slideOrder[0]].children[0],before=editor.effectiveElement(id).x;
 source.dispose();
 editor.exec({type:'SetXfrm',id,x:before+25,y:editor.effectiveElement(id).y+10});
 const bytes=ppt.savePpt(doc);check(editor.isDirty(),'导出不伪造保存点');
 validateDirectory(bytes);check(Buffer.from(bytes).equals(ppt.savePpt(doc)),'重复保存字节确定');
 writeFileSync(`${out}/${name.replace(/\.pptx?$/,'.ppt')}`,bytes);
 const reopened=await core.parse(bytes,{edit:true});check(reopened.source==='ppt','魔数识别为二进制 PPT');
 if(name.endsWith('.pptx')){check(source.slides[0].notes==='备注\tNative notes','备注区分段落制表位与实际制表符');check(reopened.slides[0].notes===source.slides[0].notes,'备注制表符原生保存');}
 check(reopened.slides.length===source.slides.length,'保留全部页面');
 const originalImage=source.slides[0].elements.find(e=>e.kind==='image'),image=reopened.slides[0].elements.find(e=>e.kind==='image');
 if(originalImage){check(!!image,'PNG 原生图片');check(Buffer.from(edit.sourceAsset(doc,originalImage.src).bytes).equals(Buffer.from(await(await fetch(image.src)).arrayBuffer())),'图片字节保留，源包释放后仍可保存');}check(Math.abs(reopened.slides[0].elements[0].x-before-25)<0.2,'编辑位置保存重开');
 check(text(reopened.slides[0].elements[0])===text(source.slides[0].elements[0]),'UTF-16 中英文原生文字');
 const originalGroup=source.slides[0].elements.find(e=>e.kind==='group'),group=reopened.slides[0].elements.find(e=>e.kind==='group');
 if(originalGroup){check(group?.children.length===originalGroup.children.length,'组合内部仍为原生对象');check(group.scaleX===originalGroup.scaleX&&group.rot===originalGroup.rot,'组合比例和旋转');check(reopened.slides[1].hidden,'隐藏页');}
 editor.undo();const undo=await core.parse(ppt.savePpt(doc));check(Math.abs(undo.slides[0].elements[0].x-before)<0.2,'撤销后保存');undo.dispose();editor.redo();
 check(Buffer.from(bytes).equals(ppt.savePpt(doc)),'重做后确定性写回');
 const again=new edit.Editor(edit.createDoc(reopened));const twice=await core.parse(ppt.savePpt(again.doc));
 check(walk(twice.slides[0].elements).map(text).join('|')===walk(reopened.slides[0].elements).map(text).join('|'),'原生保存重开再次保存');
 twice.dispose();again.dispose();reopened.dispose();editor.dispose();source.dispose();
}
const p=await core.parse(readFileSync('fixtures/sample-ppt-edit.pptx'),{edit:true,keepPackage:true}),editor=new edit.Editor(edit.createDoc(p));
const slide=editor.doc.slideOrder[0];
const id=editor.doc.slides[slide].children[0];
editor.exec({type:'SetNotes',id:slide,text:'中文备注\nNative notes'});
const withNotes=ppt.savePpt(editor.doc);writeFileSync(`${out}/notes.ppt`,withNotes);
const notes=await core.parse(withNotes);check(notes.slides[0].notes==='中文备注\nNative notes','原生演讲者备注');notes.dispose();
const unsupported=edit.createDoc(await core.parse(readFileSync('fixtures/sample-three-d.pptx'),{edit:true,keepPackage:true}));
assert.throws(()=>ppt.savePpt(unsupported),error=>error instanceof ppt.PptSaveError&&error.issues[0].slide===1);count++;edit.disposeDoc(unsupported);
editor.dispose();p.dispose();
for(const change of [
 body=>body.paragraphs[0].runs[0].link='https://example.com',
 body=>body.paragraphs[0].runs[0].color='rgba(0,0,0,0.5)',
 body=>body.fontScale=0.7,
 body=>body.paragraphs[0].rtl=true,
 body=>body.paragraphs[0].marL=6000,
]){
 const p=await core.parse(readFileSync('fixtures/sample-ppt-edit.pptx'),{edit:true,keepPackage:true});
 change(p.slides[0].elements[0].text);const doc=edit.createDoc(p);
 assert.throws(()=>ppt.savePpt(doc),error=>error instanceof ppt.PptSaveError&&error.issues[0].slide===1);count++;
 edit.disposeDoc(doc);p.dispose();
}
{
 const appearance=await core.parse(readFileSync('fixtures/sample-ppt-appearance-save.pptx'),{edit:true,keepPackage:true,lazy:false});
 const doc=edit.createDoc(appearance),bytes=ppt.savePpt(doc);
 writeFileSync(`${out}/appearance.ppt`,bytes);validateDirectory(bytes);
 check(Buffer.from(bytes).equals(ppt.savePpt(doc)),'外观固件重复保存字节确定');
 const reopened=await core.parse(bytes,{edit:true});
 // 旧 PPT 读路径不还原 wzName；按固件写入顺序定位
 const [grad,patt,...rest]=reopened.slides[0].elements;
 const arrows=rest.filter(e=>e.kind==='shape'&&e.stroke?.head);
 const img=rest.find(e=>e.kind==='image');
 check(grad?.fill?.type==='gradient'&&grad.fill.stops.length===2,'双色线性渐变写入');
 check(Math.abs(grad.fill.angle)<0.5,'渐变角度 0° 读写对称');
 check(/^rgb\(21,\s*101,\s*192\)$/.test(grad.fill.stops[0].color)&&/^rgb\(229,\s*57,\s*53\)$/.test(grad.fill.stops[1].color),'渐变端点色');
 check(patt?.fill?.type==='pattern'&&patt.fill.preset==='smGrid','图案 smGrid 读写对称');
 check(/^rgb\(21,\s*101,\s*192\)$/.test(patt.fill.fg)&&/^rgb\(255,\s*255,\s*255\)$/.test(patt.fill.bg),'图案前景背景色');
 const arrowTypes=['triangle','stealth','diamond','oval','arrow'];
 check(arrows.length===5,'五种默认箭头形状');
 arrows.forEach((el,i)=>{
  const type=arrowTypes[i];
  check(el.stroke?.dash?.length===2&&Math.abs(el.stroke.dash[0]/el.stroke.width-4)<0.1,`${type} 预设虚线`);
  check(el.stroke?.head?.type===type&&el.stroke.head.w===3&&el.stroke.head.h===3&&el.stroke.tail?.type===type,`${type} 默认尺寸箭头`);
 });
 check(img?.kind==='image'&&img.crop&&Math.abs(img.crop.l-0.125)<0.002&&Math.abs(img.crop.t-0.125)<0.002,'矩形裁剪 cropFrom*');
 for(const [label,mutate,re] of [
  ['图片效果',p=>{p.slides[0].elements.find(e=>e.kind==='image').filter='grayscale(1)';},/图片效果|异形裁剪/],
  ['径向渐变',p=>{const g=p.slides[0].elements.find(e=>e.fill?.type==='gradient');g.fill={...g.fill,radial:true};},/径向|多色标/],
  ['自定义虚线',p=>{const s=p.slides[0].elements.find(e=>e.stroke?.head?.type==='triangle');s.stroke={...s.stroke,dash:[1,2,3]};},/自定义虚线/],
  ['箭头尺寸',p=>{const s=p.slides[0].elements.find(e=>e.stroke?.head?.type==='triangle');s.stroke={...s.stroke,head:{type:'triangle',w:5,h:5}};},/箭头尺寸/],
 ]){
  const src=await core.parse(readFileSync('fixtures/sample-ppt-appearance-save.pptx'),{edit:true,keepPackage:true});
  mutate(src);const rejectDoc=edit.createDoc(src);
  assert.throws(()=>ppt.savePpt(rejectDoc),error=>error instanceof ppt.PptSaveError&&re.test(error.message),label);count++;
  edit.disposeDoc(rejectDoc);src.dispose();
 }
 reopened.dispose();edit.disposeDoc(doc);appearance.dispose();
}
recordCount('pptSave',count);console.log(`原生 PPT 保存 ${count} 项通过${dist?'（独立产物）':''}`);
