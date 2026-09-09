import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';

export async function vectorPdfMarkersContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-markers.pptx')));
  try{
    // 公开 Schema 也接受 SVG path；用零段、多子路径和闭合路径验证箭头并非只看最后两个端点。
    const edge=pres.slides[3].elements;
    edge[0].path='M0 0 L0 0 L200 80 L200 80';
    edge[1].path='m0 0 80 0 m40 40 80 0';
    edge[2].path='M0 0 H100 V60 H0 Z';
    pres.slides[4].elements[0].path='m0 60 30 -40 h30 v40 q30 -40 60 0 t60 0 c20 40 40 40 60 0 s40 -40 60 0 a30 30 0 0160 0 l0 70 -360 0 z';
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[]);
    writeFileSync(resolve(out,'markers.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    const reference=await withChartBrowser(root,async browser=>browser.evaluate(`(async()=>{
      const {renderSlideToSvg}=await import('/out/vector-pdf/contract.mjs');
      const pres=${JSON.stringify(pres)},images=[];
      for(const slide of pres.slides){
        const svg=renderSlideToSvg(pres,slide,{textMode:'svg',idPrefix:'reference'}).replace('<svg ','<svg width="960" height="540" ');
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);images.push(canvas.toDataURL('image/png').split(',')[1]);
      }
      return images;
    })()`));
    reference.forEach((png,i)=>writeFileSync(resolve(out,`markers-reference-${i+1}.png`),Buffer.from(png,'base64')));
    execFileSync('python3',['tooling/inspect-vector-pdf-markers.py',resolve(out,'markers.pdf')],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
  }finally{pres.dispose();}
}
