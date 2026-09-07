import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { recordCount } from './lib/measured.mjs';
const root=resolve('.'),out=join(root,'out/portable-clipboard');mkdirSync(out,{recursive:true});
const entry=join(out,'entry.mjs');writeFileSync(entry,`export * as core from '${root}/packages/core/src/index.ts';export * as edit from '${root}/packages/edit-core/src/index.ts';export * as generate from '${root}/packages/edit-core/src/generate/index.ts';`);
const {core,edit,generate}= process.argv.includes('--dist') ? Object.fromEntries(await Promise.all([["core", "@web-ppt/core"], ["edit", "@web-ppt/edit-core"], ["generate", "@web-ppt/edit-core/generate"]].map(async ([key, path]) => [key, await import(path)]))) : await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[['@web-ppt/core/geometry',join(root,'packages/core/src/geometry/index.ts')],['@web-ppt/core',join(root,'packages/core/src/index.ts')],['@web-ppt/edit-core',join(root,'packages/edit-core/src/index.ts')]]});
let count=0;const check=(value,label)=>{assert(value,label);count++;};
for(const fixture of['sample.ppt','sample-edit-basic.pptx','sample-editor-image-content.pptx','sample-editor-format-painter.pptx']){
 const p=await core.parse(readFileSync(`fixtures/${fixture}`),{edit:true,keepPackage:true,lazy:false}),doc=edit.createDoc(p),editor=new edit.Editor(doc);
 const roots=doc.slides[doc.slideOrder[0]].children.filter(id=>doc.elements[id].meta.editable!=='none'&&!doc.elements[id].meta.locked);
 check(roots.length>0,`${fixture} 有可复制元素`);
 p.dispose();
 const before=JSON.stringify(doc),payload=generate.copyPortableElements(doc,roots);check(JSON.stringify(doc)===before,'复制不改变源文档');
 check(payload.roots.length===roots.length,'全部选中根');check(payload.roots.every(id=>payload.ooxml.roots[id].markup.startsWith('<')),'原生元素宿主');
 editor.dispose();p.dispose();
 const target=await core.parse(generate.createBlankPptx({width:1280,height:720}),{edit:true,keepPackage:true,lazy:false}),dest=new edit.Editor(edit.createDoc(target));
 dest.exec({type:'PasteElements',payload:JSON.parse(JSON.stringify(payload)),at:{parentId:dest.doc.slideOrder[0],x:100,y:100}});
 check(dest.doc.slides[dest.doc.slideOrder[0]].children.length===roots.length,'不同文档粘贴');
 dest.undo();check(dest.doc.slides[dest.doc.slideOrder[0]].children.length===0,'粘贴撤销');dest.redo();
 const bytes=await dest.save();writeFileSync(join(out,fixture.replace(/\.pptx?$/,'.pptx')),bytes);
 const reopened=await core.parse(bytes,{edit:true,keepPackage:true,lazy:false});check(reopened.slides[0].elements.length===roots.length,'原生保存重开');
 const sourceTexts=Object.values(payload.records).filter(r=>r.src.kind==='shape'&&r.src.text).map(r=>r.src.text.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'));
 const actualTexts=[];const walk=els=>{for(const e of els){if(e.kind==='group')walk(e.children);if(e.kind==='shape'&&e.text)actualTexts.push(e.text.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'));}};walk(reopened.slides[0].elements);
 check(sourceTexts.every(t=>actualTexts.includes(t)),'原生文字保留');reopened.dispose();dest.dispose();target.dispose();
}
recordCount('portableClipboard',count);console.log(`无来源复制 ${count} 项通过`);
