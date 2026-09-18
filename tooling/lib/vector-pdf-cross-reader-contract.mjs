import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

/** 核对独立阅读器是否保留组合字符、中文与多段落阅读顺序。 */
function assertRichText(label,text){
  // NFC/NFD 均可：Poppler 可能保留分解形式的组合音标
  assert.ok(/a\u0301|á/.test(text),`${label} missing á: ${JSON.stringify(text)}`);
  assert.ok(/q\u0307/.test(text)||text.includes('q̇'),`${label} missing q̇: ${JSON.stringify(text)}`);
  assert.ok(/caf[eé]\u0301?|café/.test(text),`${label} missing café: ${JSON.stringify(text)}`);
  assert.ok(text.includes('中文测试'),`${label} missing 中文测试: ${JSON.stringify(text)}`);
  const cafeAt=text.search(/caf/i);
  const zhAt=text.indexOf('中文测试');
  const abcAt=text.indexOf('ABC');
  assert.ok(cafeAt>=0&&zhAt>cafeAt&&abcAt>zhAt,`${label} paragraph order: ${JSON.stringify(text)}`);
}

function assertLatinSlice(label,text){
  assert.ok(text.includes('AV office'),`${label} missing AV office: ${JSON.stringify(text)}`);
  assert.ok(text.includes('ffi'),`${label} missing ffi: ${JSON.stringify(text)}`);
}

function normalizeJobPages(pages){
  return pages.map(t=>t.replace(/\s+/g,' ').trim()).filter(Boolean);
}

/** MuPDF 之外用 pypdf + Poppler，避免单一阅读器掩盖 ToUnicode / 阅读顺序问题。 */
export function vectorPdfCrossReaderContract(out){
  const env={...process.env,PYTHONPATH:process.env.PYTHONPATH??resolve('.','out/font-glyphs/python')};
  const script=resolve(out,'cross-reader.py');
  writeFileSync(script,`from pypdf import PdfReader
from pathlib import Path
import json,sys
root=Path(sys.argv[1])
report={}
for name in ['first-slice.pdf','text.pdf','jobs.pdf']:
  pages=[(p.extract_text() or '') for p in PdfReader(str(root/name)).pages]
  report[name]={'pages':pages,'text':'\\n'.join(pages)}
print(json.dumps(report,ensure_ascii=False))
`);
  const pypdf=JSON.parse(execFileSync('python3',[script,out],{encoding:'utf8',env}));
  assertLatinSlice('pypdf first-slice',pypdf['first-slice.pdf'].text);
  assertRichText('pypdf text',pypdf['text.pdf'].text);
  assert.deepEqual(normalizeJobPages(pypdf['jobs.pdf'].pages),['A B','B','C'],pypdf['jobs.pdf'].pages);

  const versionProbe=spawnSync('pdftotext',['-v'],{encoding:'utf8'});
  assert.equal(versionProbe.status,0,
    `需要 Poppler pdftotext（票面独立读取器）：${versionProbe.error||versionProbe.stderr||versionProbe.stdout}`);
  const popplerVersion=(versionProbe.stderr||versionProbe.stdout||'').trim().split('\n')[0];
  const poppler={version:popplerVersion};
  for(const name of ['first-slice.pdf','text.pdf','jobs.pdf']){
    const text=execFileSync('pdftotext',['-layout',resolve(out,name),'-'],{encoding:'utf8'});
    poppler[name]={text};
    if(name==='first-slice.pdf') assertLatinSlice('poppler first-slice',text);
    else if(name==='text.pdf') assertRichText('poppler text',text);
    else assert.deepEqual(normalizeJobPages(text.split('\f')),['A B','B','C'],text);
  }

  writeFileSync(resolve(out,'cross-reader.json'),JSON.stringify({pypdf,poppler},null,2)+'\n');
  console.log(`矢量 PDF 交叉阅读器：pypdf + Poppler（${popplerVersion}）核对组合字符、中文与多段落顺序通过`);
}
