import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openFixture,changeValue } from './site-editor-browser-helpers.mjs';
export async function runSitePdfBrowserContract(context) {
 const {evaluate,waitFor,click}=context;mkdirSync('out/pdf',{recursive:true});
 await evaluate(`(() => { const original=HTMLAnchorElement.prototype.click;
 globalThis.__restorePdfDownload=()=>HTMLAnchorElement.prototype.click=original;
 HTMLAnchorElement.prototype.click=function(){if(this.download)globalThis.__pdfDownload=fetch(this.href).then(r=>r.arrayBuffer()).then(b=>({name:this.download,bytes:Array.from(new Uint8Array(b))}));else original.call(this);}; })()`);
 try{
  for(const name of ['sample-three-d','sample-comment-edit']){
   await openFixture(context,`/fixtures/${name}.pptx`,`${name}.pptx`);
   await click('#exportDocument');await waitFor(`document.querySelector('#documentExportDialog')?.open`,'PDF 导出窗口');
   if(name.includes('comment'))await click('#documentExportDialog [name=showComments]');
   await evaluate('globalThis.__pdfDownload=null');await click('#documentExportDialog [type=submit]');
   await waitFor('!!globalThis.__pdfDownload','PDF 下载');
   const result=await evaluate('globalThis.__pdfDownload',true),bytes=Buffer.from(result.bytes);
   assert.equal(result.name,`${name}-edited.pdf`);assert(bytes.subarray(0,8).toString().startsWith('%PDF-1.4'));assert(bytes.length>5000);
   if(name.includes('comment'))assert(bytes.includes('/IRT '));
   writeFileSync(`out/pdf/${name}.pdf`,bytes);
   await waitFor(`!document.querySelector('#documentExportDialog [type=submit]').disabled`,'PDF 清理资源');
   await click('#documentExportDialog [data-close]');
  }
  await click('#exportDocument');await waitFor(`document.querySelector('#documentExportDialog')?.open`,'PDF 取消窗口');
  await evaluate(`(() => { globalThis.__pdfDownload=null; document.querySelector('#documentExportDialog [type=submit]').click();document.querySelector('#documentExportDialog [data-close]').click(); })()`);
  await waitFor(`document.querySelector('#documentExportDialog [role=status]')?.textContent==='导出已取消'`,'取消后无半成品');
  assert.equal(await evaluate('globalThis.__pdfDownload'),null);await click('#documentExportDialog [data-close]');
 }finally{await evaluate('globalThis.__restorePdfDownload()');}
 console.log('  PDF 浏览器导出、三维投影、原生批注与取消通过');
}
