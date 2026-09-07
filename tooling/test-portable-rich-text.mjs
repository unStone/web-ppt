import { countedAssert } from './lib/counted-assert.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';
const { assert, record } = countedAssert('portableRichText');
const root = resolve('.'), out = join(root, 'out/portable-rich-text');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from '@web-ppt/core'; export * as edit from '@web-ppt/edit-core'; export * as generate from '@web-ppt/edit-core/generate';`);
const { core, edit, generate } = process.argv.includes('--dist')
  ? Object.fromEntries(await Promise.all([['core','@web-ppt/core'],['edit','@web-ppt/edit-core'],['generate','@web-ppt/edit-core/generate']].map(async ([name, path]) => [name, await import(path)])))
  : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs'), aliases: [
    ['@web-ppt/core', join(root,'packages/core/src/index.ts')], ['@web-ppt/edit-core', join(root,'packages/edit-core/src/index.ts')],
  ] });
const input = readFileSync('fixtures/sample-portable-rich-text.pptx');
const parse = bytes => core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
const bodies = element => element.kind === 'shape' ? [element.text] : element.kind === 'table' ? element.rows.flatMap(row => row.cells.map(cell => cell.text)) : [];
const texts = pres => pres.slides.flatMap(slide => slide.elements.flatMap(element => bodies(element).filter(Boolean)));
const semantic = body => ({warp:body.warp, images:body.paragraphs.map(p=>!!p.bulletImage), paragraphs:body.paragraphs.map(p => p.runs.map(r => ({
  text:r.text, math:r.math, size:r.size, gradient:r.gradientFill ?? null, outline:r.outline ?? null,
  shadow:r.shadowEffect ?? null, underlineColor:r.underlineColor ?? null,
})))});
const near = (actual, expected) => {
  if (typeof expected === 'number') assert(Math.abs(actual - expected) < .001, `${actual} ≈ ${expected}`);
  else if (Array.isArray(expected)) { assert.equal(actual.length, expected.length); expected.forEach((v,i) => near(actual[i],v)); }
  else if (expected && typeof expected === 'object') for (const [key,value] of Object.entries(expected)) near(actual?.[key],value);
  else assert.deepEqual(actual,expected);
};
const source = await parse(input), expected = texts(source).map(semantic);
assert.equal(expected[2].paragraphs[0][1].math[0].kind, 'frac', '原生 a14:m 读取');
assert.equal(expected[0].paragraphs[0][0].gradient.stops[1].pos, .35789, '色标不因 CSS 取整丢失精度');
const bySlide = source.slides.map(slide => slide.elements.flatMap(element => bodies(element).filter(Boolean)).map(semantic));
const sourceDoc = edit.createDoc(source);
source.dispose();
const before = JSON.stringify(sourceDoc);
const generated = generate.generateEditDoc(sourceDoc);
assert.equal(JSON.stringify(sourceDoc), before, '生成保存不改变来源');
writeFileSync(join(out,'generated.pptx'), generated.bytes);
const bulletBytes=unzipSync(input)['ppt/media/bullet.png'];
const checkBullet=bytes=>assert(Object.values(unzipSync(bytes)).some(value=>Buffer.from(value).equals(Buffer.from(bulletBytes))),'图片项目符号原始字节随内容独立流转');
checkBullet(generated.bytes);
const reopened = await parse(generated.bytes);
near(texts(reopened).map(semantic), expected);
const xml = strFromU8(unzipSync(generated.bytes)['ppt/slides/slide1.xml']);
for (const name of ['a14:m','m:f','m:rad','m:sSubSup','a:prstTxWarp','a:gradFill','a:outerShdw','a:uFill']) assert(xml.includes(`<${name}`), `${name} 原生结构`);
assert(xml.includes('pos="35789"'), '写回精确色标');
assert(xml.includes('ang="2345678"'), '写回精确角度');

for (const slideId of sourceDoc.slideOrder) {
  const ids = sourceDoc.slides[slideId].children;
  const payload = generate.copyPortableElements(sourceDoc, ids);
  assert.equal(JSON.stringify(sourceDoc), before, '无来源复制原子且不改变源');
  const blank = generate.createBlankPptx();
  const target = await parse(blank), doc = edit.createDoc(target,{idPrefix:'portable-target-'});
  const editor = new edit.Editor(doc), frames = [];
  editor.subscribeRecovery(frame => frames.push(frame));
  editor.exec({type:'PasteElements', payload:JSON.parse(JSON.stringify(payload)),at:{parentId:doc.slideOrder[0],x:20,y:20}});
  const pasted = doc.slides[doc.slideOrder[0]].children;
  assert.equal(pasted.length, ids.length);
  editor.undo(); assert.equal(doc.slides[doc.slideOrder[0]].children.length,0);
  editor.redo(); assert.equal(doc.slides[doc.slideOrder[0]].children.length,ids.length);
  const formula = Object.values(doc.elements).find(r => r.src.name==='嵌套公式混排');
  if (formula) editor.exec({type:'EditText',id:formula.id,ops:[{type:'replace',from:{p:0,r:0,off:0},to:{p:0,r:0,off:7},text:'edited '}]});
  const bytes = await editor.save();
  writeFileSync(join(out,`copied-${sourceDoc.slideOrder.indexOf(slideId)}.pptx`),bytes);
  const after = await parse(bytes);
  const actual = texts(after).map(semantic), wanted = structuredClone(bySlide[sourceDoc.slideOrder.indexOf(slideId)]);
  if (formula) wanted[2].paragraphs[0][0].text='edited ';
  near(actual,wanted);
  if(wanted.some(body=>body.images.some(Boolean)))checkBullet(bytes);
  for (const mode of ['recovery','external']) {
    const base = await parse(blank), recoveredDoc = edit.createDoc(base,{idPrefix:'portable-target-'});
    const recovered = new edit.Editor(recoveredDoc, mode==='recovery' ? {recoveryFrames:JSON.parse(JSON.stringify(frames))} : undefined);
    if (mode==='external') for (const frame of frames) recovered.applyExternalPatches(JSON.parse(JSON.stringify(frame.patches)));
    const recoveredSaved = await parse(await recovered.save());
    near(texts(recoveredSaved).map(semantic),wanted);
    recoveredSaved.dispose(); recovered.dispose(); base.dispose();
  }
  after.dispose();editor.dispose();target.dispose();
}

// 原包仍在时，不支持生成的原生语义应继续透传；一个坏对象不得留下半成品复制。
for (const field of ['gradient','shadow','generationIssues']) {
  const doc = structuredClone({...sourceDoc,package:null});
  const first = Object.values(doc.elements).find(r=>r.src.name==='渐变描边阴影与独立下划线');
  const run = first.src.text.paragraphs[0].runs[0];
  if (field==='gradient') delete run.gradientFill;
  if (field==='shadow') delete run.shadowEffect;
  if (field==='generationIssues') run.generationIssues=['unknown-math'];
  const initial=JSON.stringify(doc);
  assert.throws(()=>generate.copyPortableElements(doc,doc.slides[doc.slideOrder[0]].children),new RegExp(first.id));
  assert.equal(JSON.stringify(doc),initial);
}
assert.throws(()=>generate.generateEditDoc({...sourceDoc,meta:{...sourceDoc.meta,readonly:true}}),/只读/);
const native = await parse(input), nativeEditor = new edit.Editor(edit.createDoc(native));
const target = Object.values(nativeEditor.doc.elements).find(r=>r.src.name==='嵌套公式混排');
nativeEditor.exec({type:'EditText',id:target.id,ops:[{type:'replace',from:{p:0,r:0,off:0},to:{p:0,r:0,off:1},text:'B'}]});
const patched = await nativeEditor.save();
writeFileSync(join(out,'patched.pptx'),patched);
const patchedPres = await parse(patched);
assert.deepEqual(texts(patchedPres)[2].paragraphs[0].runs.find(r=>r.math).math,expected[2].paragraphs[0][1].math,'补丁保存原生包装仍是公式');
patchedPres.dispose();nativeEditor.dispose();native.dispose();reopened.dispose();
for (const clear of [false,true]) {
  const p = await parse(input), doc = edit.createDoc(p), editor = new edit.Editor(doc);
  const shape = Object.values(doc.elements).find(r=>r.src.name==='渐变描边阴影与独立下划线');
  const range={from:{p:0,r:0,off:0},to:{p:0,r:0,off:shape.src.text.paragraphs[0].runs[0].text.length}};
  editor.exec(clear ? {type:'ClearFormat',id:shape.id,range} : {type:'SetRunProps',id:shape.id,range,props:{color:'#00ff00'}});
  const projected=editor.effectiveElement(shape.id).text.paragraphs[0].runs[0];
  assert.equal(projected.gradientFill,null,'清除/颜色覆盖同步清除结构渐变');
  if(clear) assert.equal(projected.shadowEffect,null,'清除阴影结构');
  p.dispose();
  const result=await parse(generate.generateEditDoc(doc).bytes);
  const actual=texts(result)[0].paragraphs[0].runs[0];
  assert.equal(actual.gradient,null,'已移除的渐变不得复活');
  if(clear) assert.equal(actual.shadowEffect ?? null,null,'已移除的阴影不得复活');
  else assert.equal(actual.color,'rgb(0,255,0)','设置纯色保持');
  editor.undo(); assert(editor.effectiveElement(shape.id).text.paragraphs[0].runs[0].gradientFill,'撤销恢复渐变');
  result.dispose();editor.dispose();p.dispose();
}
for (const [search,replacement,reason] of [
  ['<a:gradFill>','<a:gradFill rotWithShape="0">','渐变旋转'],
  ['fmla="val 16000"','fmla="+- 16000 2000 0"','艺术字调整值'],
  ['prst="textWave1"','prst="textInvalid"','艺术字预设'],
  ['<m:rad>','<m:rad><m:unknown/>','公式 m:unknown'],
  ['<m:rad>','<m:rad><m:unknown/><a:rPr sz="1200"/>','公式 a:rPr'],
  ['<m:rad>','<m:rad custom="unmodeled">','公式属性 m:rad@custom'],
  ['<m:deg/>','<m:deg><m:r><m:t>hiddenDegree3</m:t></m:r></m:deg>','公式隐藏参数 deg'],
  ['<m:rad>','<m:nary><m:naryPr><m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr><m:sub><m:r><m:t>hiddenLower</m:t></m:r></m:sub><m:sup><m:r><m:t>hiddenUpper</m:t></m:r></m:sup><m:e/></m:nary><m:rad>','公式隐藏参数 sub、公式隐藏参数 sup'],
]) {
  const parts=unzipSync(input); parts['ppt/slides/slide1.xml']=strToU8(strFromU8(parts['ppt/slides/slide1.xml']).replace(search,replacement));
  const p=await parse(zipSync(parts)), doc=edit.createDoc(p);p.dispose();
  assert.throws(()=>generate.copyPortableElements(doc,doc.slides[doc.slideOrder[0]].children),new RegExp(reason));
}
for (const [node,reason] of [
  [{kind:'script',base:[]},'公式脚标缺少'],
  [{kind:'matrix',rows:[[]]},'公式矩阵必须为非空矩形'],
]) {
  const doc=structuredClone({...sourceDoc,package:null});
  const record=Object.values(doc.elements).find(record=>record.src.name==='嵌套公式混排');
  record.src.text.paragraphs[0].runs.find(run=>run.math).math=[node];
  assert.throws(()=>generate.copyPortableElements(doc,[record.id]),new RegExp(reason));
}
const mathSource=await parse(readFileSync('fixtures/sample-math.pptx'));
const mathDoc=edit.createDoc(mathSource);mathSource.dispose();
const safeIds=mathDoc.slides[mathDoc.slideOrder[0]].children.filter(id=>!bodies(mathDoc.elements[id].src).some(b=>b?.paragraphs.some(p=>p.runs.some(r=>r.generationIssues?.length))));
const mathPayload=generate.copyPortableElements(mathDoc,safeIds);
const mathTarget=await parse(generate.createBlankPptx()), mathEditor=new edit.Editor(edit.createDoc(mathTarget));
mathEditor.exec({type:'PasteElements',payload:mathPayload,at:{parentId:mathEditor.doc.slideOrder[0],x:0,y:0}});
const mathResult=await parse(await mathEditor.save());
assert.deepEqual(texts(mathResult).flatMap(b=>b.paragraphs.flatMap(p=>p.runs.filter(r=>r.math).map(r=>r.math))),safeIds.flatMap(id=>bodies(mathDoc.elements[id].src).filter(Boolean).flatMap(b=>b.paragraphs.flatMap(p=>p.runs.filter(r=>r.math).map(r=>r.math)))),'所有可表达 OMML 节点复制往返');
mathResult.dispose();mathEditor.dispose();mathTarget.dispose();
record();
console.log('高级文本生成/复制、原生包装、表格、历史、冷恢复、外部补丁与失败原子性通过');
