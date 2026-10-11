import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

/**
 * 文字描边契约：OOXML rPr a:ln 轮廓 → SVG stroke + paint-order:stroke → PDF 双轨渲染
 * （stroke-only 轨在下方 + fill 轨在上方）。MuPDF 验证：文字可搜索、描边红 + 填色深蓝。
 */
export async function vectorPdfTextStrokeContract(api,fonts,root,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-text-stroke.pptx')));
  try{
    const result=await api.presentationToVectorPdf(pres,{fonts});
    assert.deepEqual(result.issues,[],`不应回退：${JSON.stringify(result.issues)}`);
    writeFileSync(join(out,'text-stroke.pdf'),new Uint8Array(await result.blob.arrayBuffer()));
    execFileSync('python3',['tooling/inspect-vector-pdf-text-stroke.py',join(out,'text-stroke.pdf')],{
      stdio:'inherit',env:{...process.env,PYTHONPATH:process.env.PYTHONPATH ?? join(root,'out/font-glyphs/python')},
    });
  }finally{pres.dispose();}
}
