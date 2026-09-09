import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {bundleBrowser} from './lib/bundle-browser.mjs';
import {withChartBrowser} from './lib/chart-browser-lab.mjs';
import {vectorPdfImagesContract} from './lib/vector-pdf-images-contract.mjs';
import {vectorPdfEffectsContract} from './lib/vector-pdf-effects-contract.mjs';
import {vectorPdfPaintsContract} from './lib/vector-pdf-paints-contract.mjs';
import {vectorPdfDecorationContract} from './lib/vector-pdf-decoration-contract.mjs';
import {vectorPdfFontErrorsContract} from './lib/vector-pdf-font-errors-contract.mjs';
import {vectorPdfCoverageContract} from './lib/vector-pdf-coverage-contract.mjs';
import {vectorPdfMarkersContract} from './lib/vector-pdf-markers-contract.mjs';
import {vectorPdfPatternsContract} from './lib/vector-pdf-patterns-contract.mjs';
import {vectorPdfImagePatternsContract} from './lib/vector-pdf-image-patterns-contract.mjs';
import {vectorPdfNormalizationContract} from './lib/vector-pdf-normalization-contract.mjs';

const root=resolve('.'),out=resolve(root,'out/vector-pdf');mkdirSync(out,{recursive:true});
const entry=resolve(out,'entry.mjs');
writeFileSync(entry,`export {parse,renderSlideToSvg} from '@web-ppt/core';
export {presentationToVectorPdf,VectorPdfError} from '@web-ppt/core/pdf/vector';
export {rasterizeVectorPdfObject,normalizeVectorPdfImage} from '@web-ppt/core/pdf/vector/browser';
export {createFontProvider,segmentFontText} from '@web-ppt/fonts/glyphs';
export {createHarfBuzzShaper} from '@web-ppt/fonts/glyphs/harfbuzz';`);
const api=await bundleBrowser({root,entry,output:resolve(out,'contract.mjs'),aliases:process.argv.includes('--dist')?[]:[
  ['@web-ppt/core',resolve(root,'packages/core/src/index.ts')],
  ['@web-ppt/core/pdf/vector',resolve(root,'packages/core/src/pdf/vector.ts')],
  ['@web-ppt/fonts/glyphs',resolve(root,'packages/fonts/src/glyphs/index.ts')],
  ['@web-ppt/fonts/glyphs/harfbuzz',resolve(root,'packages/fonts/src/glyphs/harfbuzz.ts')],
]});
const hb=await import('harfbuzzjs'),provider=api.createFontProvider({loadShaper:async()=>api.createHarfBuzzShaper(hb)});
const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf.pptx')));
try{
  const face=await provider.register({id:'latin',origin:'explicit',bytes:new Uint8Array(readFileSync('tooling/font-glyph-samples/latin.ttf'))},{purpose:'view-print'});
  assert(face.ok);
  const result=await api.presentationToVectorPdf(pres,{fonts:{provider,segmentText:api.segmentFontText}});
  assert.equal(result.blob.type,'application/pdf');assert.deepEqual(result.issues,[]);
  writeFileSync(resolve(out,'first-slice.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
  execFileSync('python3',['tooling/inspect-vector-pdf.py',resolve(out,'first-slice.pdf')],{
    stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
  });
  const chinese=await provider.register({id:'chinese',origin:'explicit',bytes:new Uint8Array(readFileSync('tooling/font-glyph-samples/chinese.ttf'))},{purpose:'view-print'});
  assert(chinese.ok);
  await vectorPdfNormalizationContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfImagePatternsContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfPatternsContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfMarkersContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfCoverageContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfFontErrorsContract(api,{provider,segmentText:api.segmentFontText},out);
  await vectorPdfDecorationContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfPaintsContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfEffectsContract(api,{provider,segmentText:api.segmentFontText},root,out);
  await vectorPdfImagesContract(api,{provider,segmentText:api.segmentFontText},root,out);
  const textPres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-text.pptx')));
  try{
    const textResult=await api.presentationToVectorPdf(textPres,{fonts:{provider,segmentText:api.segmentFontText}});
    assert.deepEqual(textResult.issues,[]);
    writeFileSync(resolve(out,'text.pdf'),new Uint8Array(await textResult.blob.arrayBuffer()));
    execFileSync('python3',['tooling/inspect-vector-pdf.py',resolve(out,'text.pdf'),'text'],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
  }finally{textPres.dispose();}
  const jobsPres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-jobs.pptx')));
  try{
    const progress=[];
    jobsPres.slides[0].comments=[{id:'first',author:'作者',text:'批注',x:40,y:40},
      {id:'reply',parentId:'first',author:'B',text:'回复',x:40,y:40}];
    const options={fonts:{provider,segmentText:api.segmentFontText},skipHidden:true,animationSteps:true,showComments:true};
    const jobsResult=await api.presentationToVectorPdf(jobsPres,{...options,onProgress:p=>progress.push(p)});
    assert.deepEqual(progress,[{completed:1,total:3,slideNumber:1},{completed:2,total:3,slideNumber:1},{completed:3,total:3,slideNumber:3}]);
    writeFileSync(resolve(out,'jobs.pdf'),new Uint8Array(await jobsResult.blob.arrayBuffer()));
    execFileSync('python3',['tooling/inspect-vector-pdf.py',resolve(out,'jobs.pdf'),'jobs'],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
    const repeated=await api.presentationToVectorPdf(jobsPres,options);
    assert.deepEqual(new Uint8Array(await repeated.blob.arrayBuffer()),new Uint8Array(await jobsResult.blob.arrayBuffer()));
    const cancelled=new AbortController(),cancelProgress=[];
    await assert.rejects(()=>api.presentationToVectorPdf(jobsPres,{...options,signal:cancelled.signal,onProgress:p=>{cancelProgress.push(p);cancelled.abort();}}),{name:'AbortError'});
    assert.equal(cancelProgress.length,1);
    assert.equal(provider.state().faces,2);
    jobsPres.slides[0].elements.find(el=>el.text?.paragraphs[0]?.runs[0]?.text==='A').text.paragraphs[0].runs[0].fonts=['Unavailable'];
    const finalOnly=await api.presentationToVectorPdf(jobsPres,{fonts:options.fonts,skipHidden:true});
    writeFileSync(resolve(out,'final-only.pdf'),new Uint8Array(await finalOnly.blob.arrayBuffer()));
    execFileSync('python3',['tooling/inspect-vector-pdf.py',resolve(out,'final-only.pdf'),'final-only'],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
    await assert.rejects(()=>api.presentationToVectorPdf(jobsPres,options),/face-unavailable/);
  }finally{jobsPres.dispose();}
  const geometryPres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-geometry.pptx')));
  try{
    const geometry=await api.presentationToVectorPdf(geometryPres,{fonts:{provider,segmentText:api.segmentFontText}});
    assert.deepEqual(geometry.issues,[]);
    writeFileSync(resolve(out,'geometry.pdf'),new Uint8Array(await geometry.blob.arrayBuffer()));
    writeFileSync(resolve(out,'geometry.svg'),api.renderSlideToSvg(geometryPres,geometryPres.slides[0],{textMode:'svg',idPrefix:'reference'})
      .replace('<svg ','<svg width="480" height="270" '));
    const reference=await withChartBrowser(root,async browser=>({browser:browser.version.product,
      png:await browser.evaluate(`(async()=>{
        const svg=(await (await fetch('/out/vector-pdf/geometry.svg')).text()).replace('width="480" height="270"','width="960" height="540"');
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
      })()`)}));
    writeFileSync(resolve(out,'geometry-reference.png'),Buffer.from(reference.png,'base64'));
    writeFileSync(resolve(out,'geometry-browser.json'),JSON.stringify({browser:reference.browser},null,2)+'\n');
    execFileSync('python3',['tooling/inspect-vector-pdf.py',resolve(out,'geometry.pdf'),'geometry'],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
  }finally{geometryPres.dispose();}
}finally{provider.dispose();pres.dispose();}
console.log(`矢量 PDF ${process.argv.includes('--dist')?'dist':'source'}：公开导出、文字、动画批次、批注、取消、重复调用与独立图形对照通过`);
