import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {openFixture,changeValue} from './site-editor-browser-helpers.mjs';

export async function runSiteVectorPdfBrowserContract(context){
  const {evaluate,waitFor,click}=context;
  await openFixture(context,'/fixtures/sample-vector-pdf-text.pptx','vector-text.pptx');
  await click('#exportDocument');await waitFor("document.querySelector('#documentExportDialog')?.open",'矢量 PDF 选择');
  assert.equal(await evaluate("!!document.querySelector('#documentExportDialog option[value=vector]')"),true,'Cordis 文件服务应提供矢量 PDF');
  await changeValue(context,'#documentExportDialog [name=format]','vector');
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [name=scale]').closest('label').hidden"),true);
  await evaluate('globalThis.__pdfDownload=null');await click('#documentExportDialog [type=submit]');
  await waitFor("!document.querySelector('#documentExportDialog [type=submit]').disabled",'缺字体有明确结果');
  const missing=await evaluate("document.querySelector('#documentExportDialog [role=status]').textContent");
  assert(missing.includes('第 1 页')&&missing.includes('WebPPT Glyph Latin'),missing);
  assert.equal(await evaluate('globalThis.__pdfDownload'),null);
  await click('#documentExportDialog [data-site-locale="en"]');
  await waitFor("document.querySelector('#documentExportDialog [role=status]').textContent.includes('Slide 1')",'导出错误切换英文');
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [role=status]').textContent.includes('face-unavailable')"),false);
  await click('#documentExportDialog [data-close]');await click('#fontTools');
  await waitFor("document.querySelector('#fontDialog') && !document.querySelector('#checkFonts').disabled",'加载导出字体');
  for(const name of ['latin','chinese']){
    await evaluate(`(async()=>{
      const bytes=await fetch('/fixtures/font-${name}.ttf').then(r=>r.arrayBuffer());
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],'${name}.ttf',{type:'font/ttf'}));
      document.querySelector('#fontFile').files=transfer.files;document.querySelector('#fontFamily').value='';
      document.querySelector('#fontFileForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    })()`,true);
    await waitFor("!document.querySelector('#applyFontFile').disabled",name+' 字体已应用');
    assert.equal(await evaluate("document.querySelector('#fontError').textContent"),'');
  }
  await click('#closeFontDialog');
  await click('#exportDocument');await waitFor("document.querySelector('#documentExportDialog')?.open",'重试矢量 PDF');
  await changeValue(context,'#documentExportDialog [name=format]','vector');
  await evaluate('globalThis.__pdfDownload=null');await click('#documentExportDialog [type=submit]');
  await waitFor("!!globalThis.__pdfDownload || !document.querySelector('#documentExportDialog [type=submit]').disabled",'矢量 PDF 结果',400);
  assert(await evaluate('!!globalThis.__pdfDownload'),await evaluate("document.querySelector('#documentExportDialog [role=status]').textContent"));
  const result=await evaluate('globalThis.__pdfDownload',true);
  assert.equal(result.name,'vector-text-edited.pdf');
  const file=resolve('out/pdf/site-vector-text.pdf');writeFileSync(file,new Uint8Array(result.bytes));
  execFileSync('python3',['tooling/inspect-vector-pdf.py',file,'text'],{stdio:'inherit',
    env:{...process.env,PYTHONPATH:process.env.PYTHONPATH??resolve('out/font-glyphs/python')}});
  await waitFor("!document.querySelector('#documentExportDialog [type=submit]').disabled",'矢量导出资源收口');
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [role=status]').textContent"),'PDF exported');
  await click('#documentExportDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#documentExportDialog [role=status]').textContent==='PDF 已导出'",'矢量结果切回中文');
  await click('#documentExportDialog [data-close]');
  console.log('  Cordis 矢量 PDF：缺字体定位、中英文切换、本机字体、真实 Worker 及独立文字 / 字体读取通过');
}
