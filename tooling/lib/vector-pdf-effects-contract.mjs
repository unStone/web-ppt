import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';
import {vectorPdfImageLifetimeContract} from './vector-pdf-image-lifetime-contract.mjs';

export async function vectorPdfEffectsContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-effects.pptx')));
  try{
    const elementId=pres.slides[0].elements[0].id;
    const groupedId=pres.slides[1].elements[0].children[0].id;
    const imageId=pres.slides[2].elements[0].id;
    const cssId=pres.slides[3].elements[0].id;
    await withChartBrowser(root,async browser=>{
      let firstRequest;
      const rasterize=async request=>{
        firstRequest ??= {...request,signal:undefined};
        const result=await browser.evaluate(`(async()=>{
          const {rasterizeVectorPdfObject}=await import('/out/vector-pdf/contract.mjs');
          const result=await rasterizeVectorPdfObject(${JSON.stringify({...request,signal:undefined})});
          return result && {...result,bytes:Array.from(result.bytes)};
        })()`);
        return result && {...result,bytes:new Uint8Array(result.bytes)};
      };
      const result=await api.presentationToVectorPdf(pres,{fonts,rasterize});
      assert.deepEqual(result.issues,[{slideNumber:1,elementId,reason:'svg-filter'},
        {slideNumber:2,elementId:groupedId,reason:'svg-filter'},{slideNumber:3,elementId:imageId,reason:'svg-filter'},
        {slideNumber:4,elementId:cssId,reason:'svg-css-filter'}]);
      writeFileSync(resolve(out,'effects.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
      const cancelled=await browser.evaluate(`(async()=>{
        const {rasterizeVectorPdfObject}=await import('/out/vector-pdf/contract.mjs');
        const controller=new AbortController(),request=${JSON.stringify(firstRequest)};
        const job=rasterizeVectorPdfObject({...request,signal:controller.signal});controller.abort();
        let name;try{await job;}catch(error){name=error.name;}
        const retry=await rasterizeVectorPdfObject(request);return {name,retried:retry?.bytes.length > 0};
      })()`);
      assert.deepEqual(cancelled,{name:'AbortError',retried:true});
      const controller=new AbortController(),progress=[];
      await assert.rejects(()=>api.presentationToVectorPdf(pres,{fonts,signal:controller.signal,onProgress:p=>progress.push(p),
        rasterize:async request=>{const image=await rasterize(request);controller.abort();return image;}}),{name:'AbortError'});
      assert.deepEqual(progress,[]);
      const repeated=await api.presentationToVectorPdf(pres,{fonts,rasterize});
      assert.deepEqual(new Uint8Array(await repeated.blob.arrayBuffer()),new Uint8Array(await result.blob.arrayBuffer()));
      await vectorPdfImageLifetimeContract(api,{...pres,slides:[pres.slides[2]]},fonts,
        {options:{rasterize},issues:[{slideNumber:1,elementId:imageId,reason:'svg-filter'}]});
      const source=pres.slides[1],group=source.elements[0];
      const anonymous={...pres,slides:[{...source,elements:[{...group,id:undefined,
        children:group.children.map(child=>({...child,id:undefined}))},...source.elements.slice(1)]}]};
      const located=await api.presentationToVectorPdf(anonymous,{fonts,rasterize});
      assert.deepEqual(located.issues,[{slideNumber:1,elementPath:[0,0],reason:'svg-filter'}]);
      assert.equal(anonymous.slides[0].elements[0].children[0].id,undefined);
      await assert.rejects(()=>api.presentationToVectorPdf(pres,{fonts}),error=>{
        assert.equal(error.name,'VectorPdfError');
        assert.deepEqual(error.issue,{slideNumber:1,elementId,reason:'svg-filter'});return true;
      });
      const svg=api.renderSlideToSvg(pres,pres.slides[0],{textMode:'svg',idPrefix:'reference'})
        .replace('<svg ','<svg width="960" height="540" ');
      const png=await browser.evaluate(`(async()=>{
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(${JSON.stringify(svg)});await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      writeFileSync(resolve(out,'effects-reference.png'),Buffer.from(png,'base64'));
      const family='WebPPT Glyph Latin',src='data:font/ttf;base64,'+readFileSync('tooling/font-glyph-samples/latin.ttf').toString('base64');
      const groupedPng=await browser.evaluate(`(async()=>{
        const {renderSlideToSvg}=await import('/out/vector-pdf/contract.mjs');
        const font=new FontFace(${JSON.stringify(family)},'url('+${JSON.stringify(src)}+')');await font.load();document.fonts.add(font);
        const pres=${JSON.stringify({...pres,embeddedFonts:[{family,src,bold:false,italic:false}]})};
        const svg=renderSlideToSvg(pres,pres.slides[1],{textMode:'svg',idPrefix:'reference'}).replace('<svg ','<svg width="960" height="540" ');
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);document.fonts.delete(font);return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      writeFileSync(resolve(out,'effects-group-reference.png'),Buffer.from(groupedPng,'base64'));
      const imageSource=pres.slides[2].elements[0].src;
      const imageBytes=Buffer.from(await (await fetch(imageSource)).arrayBuffer());
      const imageSvg=api.renderSlideToSvg(pres,pres.slides[2],{textMode:'svg',idPrefix:'reference'})
        .replaceAll(imageSource,'data:image/png;base64,'+imageBytes.toString('base64')).replace('<svg ','<svg width="960" height="540" ');
      const imagePng=await browser.evaluate(`(async()=>{
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(${JSON.stringify(imageSvg)});await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      writeFileSync(resolve(out,'effects-image-reference.png'),Buffer.from(imagePng,'base64'));
      const cssSvg=api.renderSlideToSvg(pres,pres.slides[3],{textMode:'svg',idPrefix:'reference'})
        .replaceAll(pres.slides[3].elements[0].src,'data:image/png;base64,'+imageBytes.toString('base64')).replace('<svg ','<svg width="960" height="540" ');
      const cssPng=await browser.evaluate(`(async()=>{
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(${JSON.stringify(cssSvg)});await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      writeFileSync(resolve(out,'effects-css-reference.png'),Buffer.from(cssPng,'base64'));
    });
    execFileSync('python3',['tooling/inspect-vector-pdf-effects.py',resolve(out,'effects.pdf')],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
  }finally{pres.dispose();}
}
