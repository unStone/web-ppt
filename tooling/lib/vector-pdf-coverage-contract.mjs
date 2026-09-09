import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withChartBrowser} from './chart-browser-lab.mjs';

export async function vectorPdfCoverageContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-coverage.pptx')));
  try{
    const reasons=['svg-attribute-font-variant','svg-node-textPath'];
    assert(api.renderSlideToSvg(pres,pres.slides[1],{textMode:'svg'}).includes('<textPath'));
    assert(api.renderSlideToSvg(pres,pres.slides[4],{textMode:'svg'}).includes('<circle'));
    const borders=pres.slides[5].elements[0].rows[0].cells[0].borders;
    assert.equal(borders.b.width,0);
    // 宿主通过公开 Schema 提供全零虚线，SVG 将其视为实线；PDF 不能写非法的全零 dash 数组。
    borders.t.dash=[0,0];assert(api.renderSlideToSvg(pres,pres.slides[5],{textMode:'svg'}).includes('stroke-dasharray="0 0"'));
    const line=pres.slides[2].elements[0],malformed={...pres,slides:[{...pres.slides[2],elements:[{...line,
      stroke:{...line.stroke,tail:undefined},path:'M0 0 L50 0 @ L50 50'}]}]};
    await assert.rejects(()=>api.presentationToVectorPdf(malformed,{fonts}),error=>{
      assert(error instanceof api.VectorPdfError);assert.deepEqual(error.issue,{slideNumber:1,elementId:line.id,reason:'svg-geometry'});return true;
    });
    const formula=structuredClone(pres.slides[3].elements[1]);
    formula.text.paragraphs[0].runs[0].math=[{kind:'run',text:'ABC',sty:'p'}];
    const math={...pres,slides:[{...pres.slides[3],elements:[formula]}]};
    assert(api.renderSlideToSvg(math,math.slides[0],{textMode:'svg'}).includes('style="font-family:'));
    // 公式用 CSS 声明字体；忽略 style 会错误地借到已注册的正文 Latin 字体并假装成功。
    await assert.rejects(()=>api.presentationToVectorPdf(math,{fonts}),error=>{
      assert(error instanceof api.VectorPdfError);assert.deepEqual(error.issue,{slideNumber:1,elementId:formula.id,
        reason:'face-unavailable',fontFamilies:['Cambria Math','Latin Modern Math','STIX Two Math','Times New Roman','serif'],text:'ABC'});return true;
    });
    for(const [i,reason] of reasons.entries()) await assert.rejects(()=>api.presentationToVectorPdf({...pres,slides:[pres.slides[i]]},{fonts}),error=>{
      assert(error instanceof api.VectorPdfError);assert.deepEqual(error.issue,{slideNumber:1,elementId:pres.slides[i].elements[0].id,reason});return true;
    });
    await withChartBrowser(root,async browser=>{
      const rasterize=async request=>{
        const value=await browser.evaluate(`(async()=>{
          const {rasterizeVectorPdfObject}=await import('/out/vector-pdf/contract.mjs');
          const image=await rasterizeVectorPdfObject(${JSON.stringify({...request,signal:undefined})});
          return image && {...image,bytes:Array.from(image.bytes)};
        })()`);
        return value && {...value,bytes:new Uint8Array(value.bytes)};
      };
      const result=await api.presentationToVectorPdf(pres,{fonts,rasterize});
      assert.deepEqual(result.issues,reasons.map((reason,i)=>({slideNumber:i+1,elementId:pres.slides[i].elements[0].id,reason})));
      writeFileSync(resolve(out,'coverage.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
      const family='WebPPT Glyph Latin',src='data:font/ttf;base64,'+readFileSync('tooling/font-glyph-samples/latin.ttf').toString('base64');
      const reference=await browser.evaluate(`(async()=>{
        const {renderSlideToSvg}=await import('/out/vector-pdf/contract.mjs');
        const font=new FontFace(${JSON.stringify(family)},'url('+${JSON.stringify(src)}+')');await font.load();document.fonts.add(font);
        const pres=${JSON.stringify({...pres,embeddedFonts:[{family,src,bold:false,italic:false}]})},images=[];
        for(const slide of pres.slides){
          const svg=renderSlideToSvg(pres,slide,{textMode:'svg',idPrefix:'reference'}).replace('<svg ','<svg width="960" height="540" ');
          const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
          const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
          canvas.getContext('2d').drawImage(image,0,0);images.push(canvas.toDataURL('image/png').split(',')[1]);
        }
        document.fonts.delete(font);return images;
      })()`);
      reference.forEach((png,i)=>writeFileSync(resolve(out,`coverage-reference-${i+1}.png`),Buffer.from(png,'base64')));
    });
    execFileSync('python3',['tooling/inspect-vector-pdf-coverage.py',resolve(out,'coverage.pdf')],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? resolve(root,'out/font-glyphs/python')},
    });
  }finally{pres.dispose();}
}
