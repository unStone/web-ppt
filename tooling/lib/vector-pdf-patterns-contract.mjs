import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';

export async function vectorPdfPatternsContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-patterns.pptx')));
  try{
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[]);
    writeFileSync(resolve(out,'patterns.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    const inspect=(...args)=>execFileSync('python3',['tooling/inspect-vector-pdf-patterns.py',resolve(out,'patterns.pdf'),...args],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
    inspect('--prepare');
    const fromPdf=pres.slides.map((_,i)=>readFileSync(resolve(out,`patterns-reader-${i+1}.svg`),'utf8'));
    const reference=await withChartBrowser(root,async browser=>browser.evaluate(`(async()=>{
      const {renderSlideToSvg}=await import('/out/vector-pdf/contract.mjs');
      const pres=${JSON.stringify(pres)},fromPdf=${JSON.stringify(fromPdf)},images=[];
      const source=pres.slides.map(slide=>renderSlideToSvg(pres,slide,{textMode:'svg',idPrefix:'reference'}));
      for(let svg of [...source,...fromPdf]){
        svg=svg.replace(/ width="[^"]*"| height="[^"]*"/g,(match,at)=>at<svg.indexOf('>')?'':match).replace('<svg ','<svg width="960" height="540" ');
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);images.push(canvas.toDataURL('image/png').split(',')[1]);
      }
      return images;
    })()`));
    reference.forEach((png,i)=>writeFileSync(resolve(out,`patterns-${i<pres.slides.length?'reference':'reader'}-${i%pres.slides.length+1}.png`),Buffer.from(png,'base64')));
    inspect();
  }finally{pres.dispose();}
}
