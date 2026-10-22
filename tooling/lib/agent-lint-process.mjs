import {readFileSync} from 'node:fs';
import {core,edit,lint} from '../../out/agent-lint/runtime.mjs';
const data=JSON.parse(readFileSync('out/agent-lint/corpus-input.json','utf8')),out={};
for(const [file,input]of Object.entries(data)){
 const p=await core.parse(readFileSync('fixtures/'+file),{edit:true,keepPackage:true,lazy:false,...(file.includes('encrypted')?{password:'web-ppt-2024'}:{})}),doc=edit.createDoc(p,{idPrefix:'lint-'});
 try{out[file]=await lint.lintPresentation(doc,{fonts:{available:['WebPPT Glyph Latin'],embedded:(p.embeddedFontSources??p.embeddedFonts??[]).map(f=>f.family)},resolveContrast:c=>{const v=input.samples[JSON.stringify([c.slideNumber,c.elementId,c.textIndex,c.paragraphIndex,c.runIndex])];if(v?.error)throw new lint.LayoutLintError(v.error.reason,v.error.message,v.error.slideNumber,v.error.elementId);return v;},resolveImageMetadata:c=>input.imageInfo[c.elementId],measureText:(t,r,s)=>{
  const key=JSON.stringify([t,r.fonts,r.size,!!r.b,!!r.i,r.baseline??0,r.spacing??0,s]);
  if(input.metrics[key]===undefined)throw new Error('缺少真实字宽 '+key);return input.metrics[key];
 }});}catch(e){out[file]={reason:e.reason,slideNumber:e.slideNumber,elementId:e.elementId};}
 edit.disposeDoc(doc);p.dispose();
}
process.stdout.write(JSON.stringify(out));
