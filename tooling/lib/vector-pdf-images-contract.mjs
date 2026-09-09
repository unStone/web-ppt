import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';
import {vectorPdfImageLifetimeContract} from './vector-pdf-image-lifetime-contract.mjs';

export async function vectorPdfImagesContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-images.pptx')));
  try{
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[]);
    writeFileSync(resolve(out,'images.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    let svg=api.renderSlideToSvg(pres,pres.slides[0],{textMode:'svg',idPrefix:'reference'});
    // Node 的 blob URL 不能交给另一个 Chrome 进程；按公开图片资源实际字节内联。
    for(const el of pres.slides[0].elements.filter(el=>el.kind==='image')){
      const response=await fetch(el.src),bytes=Buffer.from(await response.arrayBuffer());
      svg=svg.replaceAll(el.src,`data:image/png;base64,${bytes.toString('base64')}`);
    }
    // 图片区域对照不包含文字，避免参考页的系统字体影响测量。
    writeFileSync(resolve(out,'images.svg'),svg.replace('<svg ','<svg width="960" height="540" '));
    const reference=await withChartBrowser(root,async browser=>browser.evaluate(`(async()=>{
      const svg=await (await fetch('/out/vector-pdf/images.svg')).text();
      const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
      canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
    })()`));
    writeFileSync(resolve(out,'images-reference.png'),Buffer.from(reference,'base64'));
    execFileSync('python3',['tooling/inspect-vector-pdf.py',resolve(out,'images.pdf'),'images'],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
    await vectorPdfImageLifetimeContract(api,pres,fonts);
  }finally{pres.dispose();}
}
