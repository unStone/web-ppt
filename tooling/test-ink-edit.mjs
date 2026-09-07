import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('inkEdit');
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'out/ink-edit');mkdirSync(out,{recursive:true});
const entry=join(out,'entry.mjs');writeFileSync(entry,`export * as core from ${JSON.stringify(join(root,'packages/core/src/index.ts'))};export * as edit from ${JSON.stringify(join(root,'packages/edit-core/src/index.ts'))};export * as ink from ${JSON.stringify(join(root,'packages/edit-core/src/ink/index.ts'))};export * as native from ${JSON.stringify(join(root,'packages/core/src/ink-edit.ts'))};`);
const {core,edit,ink,native}=process.argv.includes('--dist')?Object.fromEntries(await Promise.all([['core','core/dist/core.js'],['edit','edit-core/dist/edit-core.js'],['ink','edit-core/dist/ink.js'],['native','core/dist/ink-edit.js']].map(async([key,file])=>[key,await import(pathToFileURL(join(root,'packages',file)))]))):await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[
 ['@web-ppt/core/ink-edit',join(root,'packages/core/src/ink-edit.ts')],['@web-ppt/core/geometry',join(root,'packages/core/src/geometry/index.ts')],['@web-ppt/core',join(root,'packages/core/src/index.ts')],['@web-ppt/edit-core/cfb',join(root,'packages/edit-core/src/cfb/index.ts')],['@web-ppt/edit-core/xml',join(root,'packages/edit-core/src/xml/index.ts')],['@web-ppt/edit-core/opc',join(root,'packages/edit-core/src/opc/index.ts')],['@web-ppt/edit-core',join(root,'packages/edit-core/src/index.ts')],
]});
const input=readFileSync(join(root,'fixtures/sample-ink-edit.pptx'));
const make=async(bytes=input,options={})=>{const p=await core.parse(bytes,{edit:true,keepPackage:true,lazy:false});const editor=new edit.Editor(edit.createDoc(p,{idPrefix:'ink-'}),options);return{p,editor,api:ink.createInkEditor(editor)};};
assert.deepEqual(native.decodeInkPoints('100 100 0.2,\'20\'10\'0.1,"0"0"0',['X','Y','F']).map(p=>[p.x,p.y]),[[100,100],[120,110],[140,120]]);
for(const generated of [false,true]) {
 const{p,editor,api}=await make(),frames=[];editor.subscribeRecovery(f=>frames.push(f));
 const items=ink.listEditableInk(editor.doc);assert.equal(items.length,1);const id=items[0].id;
 const original=api.query(id);assert.equal(original.strokes.length,2);assert.equal(original.strokes[0].channels[2],'F');
 assert(Math.abs(original.strokes[0].points[2].values[2]-0.4)<1e-9);
 api.setStyle(id,'stroke1',{color:'#ff3300',width:7});
 const unchanged=editor.effectiveElement(id).children[0];api.removeStroke(id,'stroke2');assert.deepEqual(editor.effectiveElement(id).children[0],unchanged,'删除边缘笔画不拉伸其余笔画');editor.undo();
 api.translate(id,'stroke1',10,20);assert.equal(api.query(id).strokes[0].points[0].x,110);
 assert.deepEqual(api.query(id).strokes[0].points.map(p=>p.values[2]),original.strokes[0].points.map(p=>p.values[2]));
 api.addStroke(id,[{x:180,y:150,pressure:0.3},{x:210,y:180,pressure:0.7}],{color:'#008844',width:3},'new-stroke');
 assert.throws(()=>api.setPoints(id,'stroke1',[{x:NaN,y:1,values:[]}]),/采样/);
 const before=api.query(id);if(generated)p.dispose();
 const saved=await editor.save();writeFileSync(join(out,`${generated?'generated':'patched'}.pptx`),saved);
 const parts=unzipSync(saved),dataPart=Object.keys(parts).find(p=>p.startsWith('ppt/ink/web-ppt-ink-'));assert(dataPart);
 const xml=new TextDecoder().decode(parts[dataPart]);assert(xml.includes('未知墨迹扩展'));assert(xml.includes('保留识别信息'));assert(xml.includes('canvasRef'));
 assert(Object.keys(parts).some(p=>p.startsWith('ppt/media/web-ppt-ink-')),'更新兼容分支预览');
 const fresh=await make(saved),freshId=ink.listEditableInk(fresh.editor.doc)[0].id;assert.deepEqual(fresh.api.query(freshId),before);
 assert.deepEqual(await editor.save(),saved,'重复保存稳定');
 const recovered=await make(input,{recoveryFrames:frames});assert.deepEqual(recovered.api.query(ink.listEditableInk(recovered.editor.doc)[0].id),before);
 while(editor.history.undoCount)editor.undo();const undone=unzipSync(await editor.save());assert(!Object.keys(undone).some(p=>p.includes('/web-ppt-ink-')));
 for(const value of [{p,editor},fresh,recovered]){value.p.dispose();value.editor.dispose();}
}
record();
console.log('墨迹：紧凑差分、压力保留、样式/移动/增删、稳定画布、原生和兼容保存、源释放与恢复通过');
