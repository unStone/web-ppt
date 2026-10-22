import {core,edit,lint,sampler} from '/out/agent-lint/runtime.mjs';
const fontBytes=await fetch('/tooling/font-glyph-samples/latin.ttf').then(r=>r.arrayBuffer());
const face=await new FontFace('WebPPT Glyph Latin',fontBytes).load();document.fonts.add(face);
const fontUrl='data:font/ttf;base64,'+btoa(String.fromCharCode(...new Uint8Array(fontBytes)));
const sampleKey=c=>JSON.stringify([c.slideNumber,c.elementId,c.textIndex,c.paragraphIndex,c.runIndex]);
const rasterize=(svg,width,height,signal)=>new Promise((resolve,reject)=>{
 const image=new Image();image.onload=()=>{if(signal?.aborted){reject(new Error('aborted'));return;}const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.drawImage(image,0,0,width,height);resolve(x.getImageData(0,0,width,height).data);};image.onerror=()=>reject(new Error('SVG decode failed'));image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
});
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
const key=(text,run,scale)=>JSON.stringify([text,run.fonts,run.size,!!run.b,!!run.i,run.baseline??0,run.spacing??0,scale]);
const width=(text,run,scale)=>{ctx.font=`${run.i?'italic ':''}${run.b?'700 ':'400 '}${run.size*scale*(run.baseline?.65:1)}px 'WebPPT Glyph Latin'`;return ctx.measureText(text).width+(run.spacing??0)*text.length;};
window.lintWidths=queries=>Object.fromEntries(queries.map(q=>[key(q.text,q.run,q.scale),width(q.text,q.run,q.scale)]));
window.runLintFixture=async file=>{
 const p=await core.parse(new Uint8Array(await fetch('/fixtures/'+file).then(r=>r.arrayBuffer())),{edit:true,keepPackage:true,lazy:false,...(file.includes('encrypted')?{password:'web-ppt-2024'}:{})});
 const doc=edit.createDoc(p,{idPrefix:'lint-'}),metrics={},samples={},imageInfo={};
 const sample=sampler.createSvgContrastSampler({rasterize,fontFamily:'WebPPT Glyph Latin',embeddedFonts:[{family:'WebPPT Glyph Latin',src:fontUrl,bold:false,italic:false}]});
 try{
  const report=await lint.lintPresentation(doc,{measureText:(t,r,s)=>{const v=width(t,r,s);metrics[key(t,r,s)]=v;return v;},fonts:{available:['WebPPT Glyph Latin'],embedded:(p.embeddedFontSources??p.embeddedFonts??[]).map(f=>f.family)},
   resolveContrast:async c=>{try{const value=await sample(c);samples[sampleKey(c)]=value;return value;}catch(e){samples[sampleKey(c)]={error:{reason:e.reason??'contrast-resolver-failed',message:e.message,slideNumber:e.slideNumber,elementId:e.elementId}};throw e;}},
   resolveImageMetadata:async c=>{if(c.element.kind==='image'&&c.element.src.includes('image-zip-external.png')){const info=core.readImageMetadata(new Uint8Array(await fetch('/fixtures/image-zip-external.png').then(r=>r.arrayBuffer())));if(info){imageInfo[c.elementId]=info;return info;}}},
  });
  return {report,metrics,samples,imageInfo};
 }catch(e){return {error:{reason:e.reason??'unexpected',slideNumber:e.slideNumber??null,elementId:e.elementId??null,message:e.message},metrics,samples,imageInfo};}
 finally{edit.disposeDoc(doc);p.dispose();}
};
window.testLintOcclusion=async()=>{
 const p=await core.parse(new Uint8Array(await fetch('/fixtures/sample-agent-lint.pptx').then(r=>r.arrayBuffer())),{edit:true,keepPackage:true,lazy:false});
 const doc=edit.createDoc(p),editor=new edit.Editor(doc),slideId=doc.slideOrder[6],id=doc.slides[slideId].children[0];
 try{
  editor.exec({type:'AddShape',slideId,preset:'rect',rect:{x:30,y:30,w:240,h:110}});
  const cover=editor.selection.ids[0];editor.exec({type:'SetFill',id:cover,fill:{type:'solid',color:'#ffffff'}});
  editor.exec({type:'SetRunProps',id:doc.slides[doc.slideOrder[7]].children[0],range:{from:{p:0,r:0,off:0},to:{p:0,r:0,off:5}},props:{size:14*(96/72),b:true,color:'#888888'}});
  const svgs=[];
  const report=await lint.lintPresentation(doc,{checks:['low-contrast'],measureText:width,resolveContrast:sampler.createSvgContrastSampler({rasterize:(...args)=>{svgs.push(args[0]);return rasterize(...args);},fontFamily:'WebPPT Glyph Latin',embeddedFonts:[{family:'WebPPT Glyph Latin',src:fontUrl,bold:false,italic:false}]})});
  return {issues:report.issues.filter(i=>i.slideNumber===7||i.slideNumber===8),svgs};
 }finally{editor.dispose();edit.disposeDoc(doc);p.dispose();}
};
