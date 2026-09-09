import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';
import {vectorPdfNormalizationSamples} from './vector-pdf-normalization-samples.mjs';
import {vectorPdfNormalizationBoundaries} from './vector-pdf-normalization-boundaries.mjs';

export async function vectorPdfNormalizationContract(api,fonts,root,out){
  const samples=vectorPdfNormalizationSamples();
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-normalization.pptx')));
  const inspect=(...args)=>execFileSync('python3',['tooling/inspect-vector-pdf-normalization.py',out,...args],{
    stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
  });
  try{
    await withChartBrowser(root,async browser=>{
      // 参考值来自独立 HTML 图片路径，不能拿规范化函数自己的返回值当预期。
      const reference=await browser.evaluate(`(async()=>{
        const samples=${JSON.stringify(samples.map(s=>({name:s.name,url:`data:${s.mime};base64,${Buffer.from(s.bytes).toString('base64')}`})))};
        const results=[];
        for(const sample of samples){
          const image=new Image();image.src=sample.url;await image.decode();
          const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          const ctx=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});ctx.drawImage(image,0,0);
          results.push({name:sample.name,width:canvas.width,height:canvas.height,rgba:[...ctx.getImageData(0,0,canvas.width,canvas.height).data]});
          image.removeAttribute('src');canvas.width=canvas.height=0;
        }return results;
      })()`);
      writeFileSync(resolve(out,'normalization-reference.json'),JSON.stringify({browser:browser.version.product,images:reference},null,2)+'\n');
      if(process.argv.includes('--normalization-before')){
        const before=await api.presentationToVectorPdf({...pres,slides:[pres.slides[0]]},{fonts});
        writeFileSync(resolve(out,'normalization-before.pdf'),new Uint8Array(await before.blob.arrayBuffer()));inspect('--before');
      }
      for(const [i,sample] of samples.entries()){
        const image=pres.slides[i].elements.find(el=>el.kind==='image');assert(image,sample.name);
        await assert.rejects(()=>api.presentationToVectorPdf({...pres,slides:[pres.slides[i]]},{fonts}),error=>{
          assert(error instanceof api.VectorPdfError,sample.name);assert.deepEqual(error.issue,{slideNumber:1,elementId:image.id,reason:sample.reason});return true;
        },sample.name+' 必须显式请求规范化');
      }
      let calls=0;
      const normalizeImage=async request=>{
        calls++;
        const value=await browser.evaluate(`(async()=>{
          const {normalizeVectorPdfImage}=await import('/out/vector-pdf/contract.mjs');
          const result=await normalizeVectorPdfImage({bytes:new Uint8Array(${JSON.stringify([...request.bytes])}),mimeType:${JSON.stringify(request.mimeType)}});
          return {...result,rgba:[...result.rgba]};
        })()`);
        return {...value,rgba:new Uint8Array(value.rgba)};
      };
      const result=await api.presentationToVectorPdf(pres,{fonts,normalizeImage});assert.deepEqual(result.issues,[]);assert.equal(calls,samples.length);
      const bytes=new Uint8Array(await result.blob.arrayBuffer());writeFileSync(resolve(out,'normalization.pdf'),bytes);inspect();
      const repeated=await api.presentationToVectorPdf(pres,{fonts,normalizeImage});
      assert.deepEqual(new Uint8Array(await repeated.blob.arrayBuffer()),bytes);
      await vectorPdfNormalizationBoundaries(api,pres,fonts,samples,browser,out);
    });
  }finally{pres.dispose();}
  console.log('矢量 PDF 图片规范化：真实浏览器、独立 PDF 像素、EXIF 八方向、色彩及透明度通过');
}
