import {createFontProvider,segmentFontText} from '@web-ppt/fonts/glyphs';
import {createWorkerFontShaper} from '@web-ppt/fonts/glyphs/worker';
import {fontProofPdf} from './font-proof-pdf.mjs';

const requireResult=result=>{if(!result.ok)throw new Error(JSON.stringify(result));return result.value;};
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

/** 通过正式 Provider 和产品 Worker 得到定位字形；证明编码不进入生产 PDF 实现。 */
export async function fontProofBrowser(){
  const inputs=await fetch('/out/font-glyphs/proof-inputs.json').then(response=>response.json());
  const worker=createWorkerFontShaper(()=>new Worker(new URL('../../packages/site/src/editor-font-worker.ts',import.meta.url),{type:'module'}));
  const provider=createFontProvider({loadShaper:async()=>worker});
  const rows=[];
  try{
    for(const [sourceFile,text] of [['latin.ttf','AV office ffi ﬃ'],['latin.ttf','á q̇'],
      ['chinese.ttf','中文 ABC 你好，世界。'],['no-subset.ttf','AV office']]){
      let face=await provider.faceInfo(sourceFile,{purpose:'view-print'});
      if(!face.ok){
        const bytes=new Uint8Array(await fetch(`/tooling/font-glyph-samples/${sourceFile}`).then(response=>response.arrayBuffer()));
        if(await sha(bytes)!==inputs[sourceFile].sha256)throw new Error('证明输入与独立 cmap 字节 hash 不同');
        face=await provider.register({id:sourceFile,bytes,origin:'explicit',embeddingEvidence:'OFL-1.1'},{purpose:'view-print'});
      }
      const info=requireResult(face),segments=requireResult(segmentFontText(text,{direction:'ltr',language:'und'}));
      const runs=[],glyphs=[];let x=0,y=0;
      for(const segment of segments){
        const run=requireResult(await provider.shape(sourceFile,segment.text,{purpose:'view-print',script:segment.script,direction:'ltr',language:'und'}));
        runs.push({start:segment.start,run});
        for(const cluster of run.clusters){
          const points=[...cluster.text],count=cluster.glyphEnd-cluster.glyphStart;
          if(count>1&&(points.length!==count||points.some((point,index)=>inputs[sourceFile].cmap[point.codePointAt(0)]!==run.glyphs[cluster.glyphStart+index].id))){
            throw new Error('此证明仅编码名义映射可一一核对的多字形簇');
          }
          for(let index=cluster.glyphStart;index<cluster.glyphEnd;index++){
            const glyph=run.glyphs[index],path=requireResult(await provider.outline(sourceFile,glyph.id,{purpose:'view-print'}));
            glyphs.push({...glyph,x:x+glyph.xOffset,y:y+glyph.yOffset,path,start:segment.start+cluster.start,end:segment.start+cluster.end,
              unicode:count===1?cluster.text:points[index-cluster.glyphStart]});
            x+=glyph.xAdvance;y+=glyph.yAdvance;
          }
        }
      }
      const embedding=requireResult(await provider.embedding(sourceFile,{purpose:'view-print'}));
      rows.push({sourceFile,text,info,runs,glyphs,bytes:embedding.bytes,sha256:await sha(embedding.bytes)});
    }
    const pdf=fontProofPdf(rows),toUnicode=fontProofPdf(rows,{actualText:false});
    const paths=rows.flatMap((row,index)=>row.glyphs.map(glyph=>`<path d="${glyph.path}" transform="translate(${40+glyph.x*24/row.info.unitsPerEm} ${60+index*60-glyph.y*24/row.info.unitsPerEm}) scale(${24/row.info.unitsPerEm} ${-24/row.info.unitsPerEm})"/>`));
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="300" viewBox="0 0 720 300"><rect width="720" height="300" fill="white"/>${paths.join('')}</svg>`;
    return {rows:rows.map(({bytes,...row})=>row),pdf:Array.from(pdf),toUnicode:Array.from(toUnicode),svg};
  }finally{worker.dispose();provider.dispose();}
}
