import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';

export async function vectorPdfImagePatternsContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-image-patterns.pptx')));
  try{
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[]);
    writeFileSync(resolve(out,'image-patterns.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    const inspect=(...args)=>execFileSync('python3',['tooling/inspect-vector-pdf-image-patterns.py',resolve(out,'image-patterns.pdf'),...args],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
    inspect('--prepare');
    const encoded=new Map();
    for(const [i,slide] of pres.slides.entries()){
      let svg=api.renderSlideToSvg(pres,slide,{textMode:'svg',idPrefix:'reference'});
      // 原图仍来自公开解析结果；跨 Node / Chrome 进程不能共用 blob URL。
      for(const match of svg.matchAll(/href="(blob:[^"]+)"/g)){
        const url=match[1];
        if(!encoded.has(url))encoded.set(url,`data:image/png;base64,${Buffer.from(await(await fetch(url)).arrayBuffer()).toString('base64')}`);
        svg=svg.replaceAll(url,encoded.get(url));
      }
      writeFileSync(resolve(out,`image-patterns-reference-${i+1}.svg`),svg);
    }
    const names=['reference','reader'].flatMap(kind=>pres.slides.map((_,i)=>`image-patterns-${kind}-${i+1}`));
    const reference=await withChartBrowser(root,async browser=>browser.evaluate(`(async()=>{
      const images=[];
      for(const name of ${JSON.stringify(names)}){
        let svg=await(await fetch('/out/vector-pdf/'+name+'.svg')).text();
        svg=svg.replace(/ width="[^"]*"| height="[^"]*"/g,(match,at)=>at<svg.indexOf('>')?'':match).replace('<svg ','<svg width="960" height="540" ');
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,960,540);ctx.drawImage(image,0,0);
        images.push(canvas.toDataURL('image/png').split(',')[1]);
      }return images;
    })()`));
    reference.forEach((png,i)=>writeFileSync(resolve(out,names[i]+'.png'),Buffer.from(png,'base64')));
    inspect();
  }finally{pres.dispose();}
}
