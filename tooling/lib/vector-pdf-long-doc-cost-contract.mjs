import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

/** 无强制栅格回退的长文稿成本采样，锁住页均耗时上界；含中文页与已知局部回退。 */
export async function vectorPdfLongDocCostContract(api,fonts,root=resolve('.'),out=resolve('out/vector-pdf')){
  mkdirSync(out,{recursive:true});
  const keep=[]; const slides=[];
  // coverage 含小型大写 / textPath 等稳定回退；其余为纯矢量路径
  for(const f of [
    'fixtures/sample-vector-pdf-markers.pptx',
    'fixtures/sample-vector-pdf-patterns.pptx',
    'fixtures/sample-vector-pdf-geometry.pptx',
    'fixtures/sample-vector-pdf-decoration.pptx',
    'fixtures/sample-vector-pdf-coverage.pptx',
  ]){
    const p=await api.parse(new Uint8Array(readFileSync(resolve(root,f)))); keep.push(p); slides.push(...p.slides);
  }
  const long={width:keep[0].width,height:keep[0].height,slides:[...slides,...slides],dispose(){for(const p of keep)p.dispose();}};
  try{
    const before=process.memoryUsage();
    const t0=performance.now();
    // coverage 的局部回退需要栅格器；无浏览器时跳过该固件的回退页会失败，故注入占位 PNG
    // 占位 1×1 PNG：只验证回退定位与吞吐，不代替浏览器像素对照
    const tinyPng=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
    const result=await api.presentationToVectorPdf(long,{
      fonts,
      rasterize:async()=>({bytes:tinyPng,x:0,y:0,width:1,height:1}),
    });
    const ms=performance.now()-t0;
    const after=process.memoryUsage();
    assert.ok(result.issues.length>=2&&result.issues.length<=12,result.issues);
    assert.ok(result.issues.every(i=>i.reason&&(i.elementId!=null||i.elementPath!=null||i.slideNumber!=null)),result.issues);
    const report={pages:long.slides.length,ms:Math.round(ms),msPerPage:Math.round(ms/long.slides.length*10)/10,
      heapUsedDeltaMB:Math.round((after.heapUsed-before.heapUsed)/1048576*10)/10,
      pdfKB:Math.round((await result.blob.arrayBuffer()).byteLength/1024),issues:result.issues.length,
      issueReasons:[...new Set(result.issues.map(i=>i.reason))].sort()};
    writeFileSync(resolve(out,'long-doc-cost.json'),JSON.stringify(report,null,2)+'\n');
    assert.ok(report.pages>=30,report.pages);
    assert.ok(report.msPerPage<50,report);
    assert.ok(report.pdfKB>10&&report.pdfKB<2048,report);
    console.log(`矢量 PDF 长文稿成本：${report.pages} 页、${report.msPerPage} ms/页、${report.pdfKB} KB、${report.issues} 条定位回退`);
  }finally{long.dispose();}
}
