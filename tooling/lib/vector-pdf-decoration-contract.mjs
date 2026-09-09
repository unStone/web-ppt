import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';

export async function vectorPdfDecorationContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-decoration.pptx')));
  try{
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[]);
    writeFileSync(resolve(out,'decoration.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    const family='WebPPT Glyph Latin',src='data:font/ttf;base64,'+readFileSync('tooling/font-glyph-samples/latin.ttf').toString('base64');
    const reference=await withChartBrowser(root,async browser=>browser.evaluate(`(async()=>{
      const {renderSlideToSvg}=await import('/out/vector-pdf/contract.mjs');
      const font=new FontFace(${JSON.stringify(family)},'url('+${JSON.stringify(src)}+')');await font.load();document.fonts.add(font);
      const pres=${JSON.stringify({...pres,embeddedFonts:[{family,src,bold:false,italic:false}]})};
      const images=[];
      for(const slide of pres.slides){
        const svg=renderSlideToSvg(pres,slide,{textMode:'svg',idPrefix:'reference'}).replace('<svg ','<svg width="960" height="540" ');
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        canvas.getContext('2d').drawImage(image,0,0);images.push(canvas.toDataURL('image/png').split(',')[1]);
      }
      document.fonts.delete(font);return images;
    })()`));
    writeFileSync(resolve(out,'decoration-reference.png'),Buffer.from(reference[0],'base64'));
    writeFileSync(resolve(out,'decoration-descenders-reference.png'),Buffer.from(reference[1],'base64'));
    execFileSync('python3',['tooling/inspect-vector-pdf-decoration.py',resolve(out,'decoration.pdf')],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
  }finally{pres.dispose();}
}
