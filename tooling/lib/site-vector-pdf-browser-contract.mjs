import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {openFixture,changeValue} from './site-editor-browser-helpers.mjs';

async function loadFonts({evaluate,waitFor,click},names){
  await click('#fontTools');
  await waitFor("document.querySelector('#fontDialog') && !document.querySelector('#checkFonts').disabled",'加载导出字体');
  for(const name of names){
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
}

async function captureVectorPdf({evaluate,waitFor,click},name,mode){
  await evaluate('globalThis.__pdfDownload=null');await click('#documentExportDialog [type=submit]');
  await waitFor("!!globalThis.__pdfDownload || !document.querySelector('#documentExportDialog [type=submit]').disabled",name+' 结果',400);
  assert(await evaluate('!!globalThis.__pdfDownload'),await evaluate("document.querySelector('#documentExportDialog [role=status]').textContent"));
  const result=await evaluate('globalThis.__pdfDownload',true),file=resolve(`out/pdf/${name}.pdf`);
  writeFileSync(file,new Uint8Array(result.bytes));
  if(mode) execFileSync('python3',['tooling/inspect-vector-pdf.py',file,mode],{stdio:'inherit',
    env:{...process.env,PYTHONPATH:process.env.PYTHONPATH??resolve('out/font-glyphs/python')}});
  await waitFor("!document.querySelector('#documentExportDialog [type=submit]').disabled",name+' 资源收口');
  return result;
}

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
  await click('#documentExportDialog [data-close]');await loadFonts(context,['latin','chinese']);
  await click('#exportDocument');await waitFor("document.querySelector('#documentExportDialog')?.open",'重试矢量 PDF');
  await changeValue(context,'#documentExportDialog [name=format]','vector');
  const result=await captureVectorPdf(context,'site-vector-text','text');
  assert.equal(result.name,'vector-text-edited.pdf');
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [role=status]').textContent"),'PDF exported');
  await click('#documentExportDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#documentExportDialog [role=status]').textContent==='PDF 已导出'",'矢量结果切回中文');
  await click('#documentExportDialog [data-close]');

  await openFixture(context,'/fixtures/sample-vector-pdf-jobs.pptx','vector-jobs.pptx');
  await loadFonts(context,['latin']);
  await click('#exportDocument');await waitFor("document.querySelector('#documentExportDialog')?.open",'矢量 PDF 选项');
  await changeValue(context,'#documentExportDialog [name=format]','vector');
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [name=skipHidden]').checked"),true);
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [name=animationSteps]').checked"),false);
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [name=showComments]').checked"),false);
  await click('#documentExportDialog [name=animationSteps]');await click('#documentExportDialog [name=showComments]');
  const expanded=await captureVectorPdf(context,'site-vector-jobs-expanded','site-jobs-expanded');
  assert.equal(expanded.name,'vector-jobs-edited.pdf');
  await click('#documentExportDialog [data-site-locale="en"]');
  await waitFor("document.querySelector('#documentExportDialog [data-hidden]').textContent.includes('Skip hidden slides')",'矢量选项切换英文');
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [data-steps]').textContent"),'Expand animation click groups into pages');
  assert.equal(await evaluate("document.querySelector('#documentExportDialog [data-comments]').textContent"),'Include comments in exports');
  await click('#documentExportDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#documentExportDialog [data-hidden]').textContent.includes('跳过隐藏页')",'矢量选项切回中文');
  await click('#documentExportDialog [data-close]');

  await click('#exportDocument');await waitFor("document.querySelector('#documentExportDialog')?.open",'矢量 PDF 反向选项');
  await changeValue(context,'#documentExportDialog [name=format]','vector');
  await click('#documentExportDialog [name=skipHidden]');
  const allSlides=await captureVectorPdf(context,'site-vector-jobs-all-slides','site-jobs-all-slides');
  assert.equal(allSlides.name,'vector-jobs-edited.pdf');
  await click('#documentExportDialog [data-close]');

  await openFixture(context,'/fixtures/sample-vector-pdf-effects.pptx','vector-effects.pptx');
  await loadFonts(context,['latin']);
  await click('#exportDocument');await waitFor("document.querySelector('#documentExportDialog')?.open",'矢量 PDF 回退说明');
  await changeValue(context,'#documentExportDialog [name=format]','vector');
  await captureVectorPdf(context,'site-vector-effects');
  await waitFor("!document.querySelector('#documentExportDialog [data-export-issues]').hidden",'矢量 PDF 回退列表');
  const chineseNotice=await evaluate("document.querySelector('#documentExportDialog [data-export-issues]').textContent");
  assert(chineseNotice.includes('滤镜效果无法直接写入 PDF，已用局部图片保留外观'),chineseNotice);
  await click('#documentExportDialog [data-site-locale="en"]');
  await waitFor("document.querySelector('#documentExportDialog [data-export-issues]').textContent.includes('Filter effects cannot be written directly to PDF')",'回退说明切换英文');
  await click('#documentExportDialog [data-site-locale="zh-CN"]');await click('#documentExportDialog [data-close]');
  console.log('  Cordis 矢量 PDF：缺字体、本机字体、隐藏页、动画、批注、回退说明、中英文与独立读取通过');
}
