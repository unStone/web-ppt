import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

/**
 * 多样式装饰线契约：DrawingML dash/dot/dbl/wavy → CSS → PDF dash 模式 / 双线 / 波浪路径。
 * 字节级验证 PDF 内容流中的关键操作符（d = dash、J = cap、c = curve、双 S = double）；
 * MuPDF 像素级验证装饰区域可见（非全白）且不同样式的墨迹量有区分。
 */
export async function vectorPdfDecorationStylesContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-decoration-styles.pptx')));
  try{
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[],`不应有回退：${JSON.stringify(result.issues)}`);
    writeFileSync(join(out,'decoration-styles.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    execFileSync('python3',['tooling/inspect-vector-pdf-decoration-styles.py',join(out,'decoration-styles.pdf')],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? join(root,'out/font-glyphs/python')},
    });
  }finally{pres.dispose();}
}
