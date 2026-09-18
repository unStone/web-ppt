import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('oleEdit');
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';
const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/ole-edit'); mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root,'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root,'packages/edit-core/src/index.ts'))};
export * as ole from ${JSON.stringify(join(root,'packages/edit-core/src/ole/index.ts'))};
export * as cfb from ${JSON.stringify(join(root,'packages/edit-core/src/cfb/index.ts'))};`);
const { core, edit, ole, cfb } = process.argv.includes('--dist') ? Object.fromEntries(await Promise.all([
 ['core','core/dist/core.js'],['edit','edit-core/dist/edit-core.js'],['ole','edit-core/dist/ole.js'],['cfb','edit-core/dist/cfb.js']
].map(async([key,file])=>[key,await import(pathToFileURL(join(root,'packages',file)))]))) : await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[
 ['@web-ppt/edit-core/cfb',join(root,'packages/edit-core/src/cfb/index.ts')],['@web-ppt/edit-core/xml',join(root,'packages/edit-core/src/xml/index.ts')],['@web-ppt/edit-core/opc',join(root,'packages/edit-core/src/opc/index.ts')],['@web-ppt/edit-core',join(root,'packages/edit-core/src/index.ts')],['@web-ppt/core/geometry',join(root,'packages/core/src/geometry/index.ts')],['@web-ppt/core',join(root,'packages/core/src/index.ts')],
]});
const input = readFileSync(join(root,'fixtures/sample-ole-edit.pptx')), originalParts=unzipSync(input);
const make = async(bytes=input,options={})=>{const p=await core.parse(bytes,{edit:true,keepPackage:true,lazy:false}); const editor=new edit.Editor(edit.createDoc(p,{idPrefix:'ole-'}),options);return {p,editor,api:ole.createOleEditor(editor)};};
for(const generated of [false,true]) {
 const {p,editor,api}=await make(), frames=[]; editor.subscribeRecovery(f=>frames.push(f));
 const items=ole.listEditableOle(editor.doc);assert.equal(items.length,3);
 for(const item of items) {
  const content=api.query(item.id);
  if(content.kind==='xlsx') {
   assert.equal(content.sheets[0].cells.find(c=>c.ref==='A1').value,'季度');
   const styled=content.sheets[0].cells.find(c=>c.ref==='A1');
   assert.equal(styled.style?.font?.bold,true);
   assert.equal(styled.style?.fill?.color,'FFF2CC');
   assert.equal(styled.style?.border?.style,'thin');
   const rich=content.sheets[0].cells.find(c=>c.ref==='D2');
   assert.equal(rich.value,'保留富文本');
   assert.equal(rich.richText?.length,2);
   assert.equal(rich.richText[0].bold,true);
   assert.equal(rich.richText[1].italic,true);
   api.setCell(item.id,'1','B2',4321);api.setCell(item.id,'1','D4',' 新单元格 & <test> ');api.setCell(item.id,'2','A2',true);
   api.setCellStyle(item.id,'1','B2',{font:{bold:true,color:'FF0000',size:14},fill:{color:'E2EFDA'}});
   api.setCellRichText(item.id,'1','E2',[{text:'新',bold:true},{text:'富文本',italic:true,color:'0070C0'}]);
   assert.throws(()=>api.setCell(item.id,'1','XFE1',1),/越界/);
   assert.throws(()=>api.setCell(item.id,'1','B2',Infinity),/值无效/);
  } else {
   assert.equal(content.paragraphs[0].text,'粗斜标题');
   assert.equal(content.paragraphs[0].runs.length,2);
   assert.equal(content.paragraphs[0].runs[0].format.bold,true);
   assert.equal(content.paragraphs[0].runs[1].format.italic,true);
   const tableCell=content.paragraphs.find(p=>p.table && p.table.row===0 && p.table.col===0);
   assert.equal(tableCell.text,'单元格甲');
   const tableRich=content.paragraphs.find(p=>p.table && p.table.col===1);
   assert.equal(tableRich.runs.length,2);
   api.setRun(item.id,0,0,'新粗');
   api.setParagraph(item.id,1,'新的正文');
   api.setParagraph(item.id,tableCell.index,'新单元格甲');
   api.setRun(item.id,tableRich.index,1,'丙');
   assert.throws(()=>api.setParagraph(item.id,2,'破坏域'),/不能/);
   const after=api.query(item.id);
   assert.equal(after.paragraphs[0].text,'新粗斜标题');
   assert.equal(after.paragraphs[0].runs[0].format.bold,true);
   assert.equal(after.paragraphs[0].runs[1].format.italic,true);
   assert.equal(after.paragraphs[0].runs[1].text,'斜标题');
  }
  const projected=editor.effectiveElement(item.id);assert.equal(projected.kind,'image');assert(projected.src.includes('data:image/svg+xml'));
 }
 const before=items.map(item=>api.query(item.id));editor.undo();editor.redo();assert.deepEqual(items.map(item=>api.query(item.id)),before);
 if(generated)p.dispose();
 const saved=await editor.save();writeFileSync(join(out,`${generated?'generated':'patched'}.pptx`),saved);
 const parts=unzipSync(saved);assert(!Object.entries(parts).some(([p,b])=>p.endsWith('.xml')&&new TextDecoder().decode(b).includes('webPptOleEdit=')));
 const nativeParts=Object.keys(parts).filter(p=>p.startsWith('ppt/embeddings/web-ppt-ole-'));assert.equal(nativeParts.length,3);
 assert.equal(Object.keys(parts).filter(p=>p.startsWith('ppt/media/web-ppt-ole-')).length,2);
 const fresh=await make(saved), reopened=ole.listEditableOle(fresh.editor.doc);assert.equal(reopened.length,3);
 assert.deepEqual(reopened.map(item=>fresh.api.query(item.id)),before);
 for(const item of reopened) assert.equal(fresh.editor.effectiveElement(item.id).kind,'image');
 const word=nativeParts.map(part=>parts[part]).filter(cfb.isCompoundFile).map(cfb.readCompoundFile).find(file=>file.entries.some(e=>e.path==='Package'));
 assert.deepEqual(word.entries.find(e=>e.path==='PrivateStorage/state').bytes,new Uint8Array([5,4,3]));
 const docParts=unzipSync(word.entries.find(e=>e.path==='Package').bytes);
 const docXml=new TextDecoder().decode(docParts['word/document.xml']);
 assert(docXml.includes('<w:b/>'));assert(docXml.includes('<w:i/>'));
 assert(docXml.includes('新粗'));assert(docXml.includes('斜标题'));assert(docXml.includes('新单元格甲'));assert(docXml.includes('丙'));
 assert(docParts['custom/unknown.xml']);
 const workbook=unzipSync(parts[nativeParts.find(p=>p.endsWith('.xlsx'))]);
 const sheet1=new TextDecoder().decode(workbook['xl/worksheets/sheet1.xml']);
 assert(sheet1.includes('未知工作表扩展'));
 assert(sheet1.includes('s="'));
 const styles=new TextDecoder().decode(workbook['xl/styles.xml']);
 assert(styles.includes('E2EFDA')||styles.includes('e2efda')||styles.includes('FF0000')||styles.includes('ff0000'));
 const shared=new TextDecoder().decode(workbook['xl/sharedStrings.xml']);
 assert(shared.includes('<r>')&&shared.includes('新')&&shared.includes('富文本'));
 assert.deepEqual(await editor.save(),saved,'重复保存稳定');
 const recovered=await make(input,{recoveryFrames:frames});assert.deepEqual(ole.listEditableOle(recovered.editor.doc).map(item=>recovered.api.query(item.id)),before);
 while(editor.history.undoCount)editor.undo();const undone=unzipSync(await editor.save());
 assert(!Object.keys(undone).some(p=>p.includes('/web-ppt-ole-')),'撤销清理创建部件');
 if(!generated)for(const part of ['ppt/embeddings/oleEdit1.xlsx','ppt/embeddings/oleEdit2.bin','ppt/embeddings/oleEdit3.bin'])assert.deepEqual(undone[part],originalParts[part]);
 for(const value of [{p,editor},fresh,recovered]){value.p.dispose();value.editor.dispose();}
}
record();
console.log('OLE：run/表格/样式/富文本、大小流、原生文件与预览、历史恢复、重复保存、源释放保存通过');
