import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';

export async function vectorPdfPaintsContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-paints.pptx')));
  try{
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[]);
    writeFileSync(resolve(out,'paints.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    await withChartBrowser(root,async browser=>{
      for(let i=0;i<pres.slides.length;i++){
        let svg=api.renderSlideToSvg(pres,pres.slides[i],{textMode:'svg',idPrefix:'reference'})
          .replace('<svg ','<svg width="960" height="540" ');
        for(const el of pres.slides[i].elements.filter(el=>el.kind==='image')){
          const bytes=Buffer.from(await (await fetch(el.src)).arrayBuffer());svg=svg.replaceAll(el.src,'data:image/png;base64,'+bytes.toString('base64'));
        }
        const png=await browser.evaluate(`(async()=>{
          const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(${JSON.stringify(svg)});await image.decode();
          const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
          canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
        })()`);
        writeFileSync(resolve(out,`paints-${i+1}-reference.png`),Buffer.from(png,'base64'));
      }
    });
    execFileSync('python3',['tooling/inspect-vector-pdf-paints.py',resolve(out,'paints.pdf')],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
  }finally{pres.dispose();}
}
