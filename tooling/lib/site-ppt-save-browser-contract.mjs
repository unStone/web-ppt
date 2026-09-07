import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openFixture,changeValue} from './site-editor-browser-helpers.mjs';
export async function runSitePptSaveBrowserContract(context){
 const {evaluate,waitFor,click}=context;
 await openFixture(context,'/fixtures/sample-ppt-edit.pptx','native-source.pptx');
 await evaluate(`(()=>{const original=HTMLAnchorElement.prototype.click;globalThis.__restorePptDownload=()=>HTMLAnchorElement.prototype.click=original;
 HTMLAnchorElement.prototype.click=function(){if(this.download)globalThis.__pptDownload=fetch(this.href).then(r=>r.arrayBuffer()).then(b=>({name:this.download,bytes:Array.from(new Uint8Array(b))}));else original.call(this);};})()`);
 try{
  await click('#exportDocument');await waitFor(`document.querySelector('#documentExportDialog')?.open`,'原生 PPT 导出窗口');
  await changeValue(context,'#documentExportDialog [name=format]','ppt');
  assert(await evaluate(`document.querySelector('#documentExportDialog [name=scale]').closest('label').hidden`));
  await click('#documentExportDialog [type=submit]');await waitFor('!!globalThis.__pptDownload','原生 PPT 下载');
  const result=await evaluate('globalThis.__pptDownload',true),bytes=Buffer.from(result.bytes);
  assert.equal(result.name,'native-source-edited.ppt');assert.equal(bytes.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
  mkdirSync('out/ppt-save',{recursive:true});writeFileSync('out/ppt-save/browser.ppt',bytes);
  await waitFor(`!document.querySelector('#documentExportDialog [type=submit]').disabled`,'原生 PPT 任务结束');await click('#documentExportDialog [data-close]');
  await evaluate(`(()=>{const file=new File([Uint8Array.from(${JSON.stringify(result.bytes)})],'reopened.ppt',{type:'application/vnd.ms-powerpoint'});const d=new DataTransfer();d.items.add(file);const input=document.querySelector('input[type=file]');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('#canvasMount')?.textContent.includes('原生 PPT Native')`,'原生 PPT 在产品中重开');
  await openFixture(context,'/fixtures/sample-three-d.pptx','unsupported-native.pptx');
  await click('#exportDocument');await waitFor(`document.querySelector('#documentExportDialog')?.open`,'PPT 能力边界');
  await changeValue(context,'#documentExportDialog [name=format]','ppt');await evaluate('globalThis.__pptDownload=null');await click('#documentExportDialog [type=submit]');
  await waitFor(`document.querySelector('#documentExportDialog [role=status]')?.textContent.includes('三维')`,'不支持时明确阻止导出');
  assert.equal(await evaluate('globalThis.__pptDownload'),null);await click('#documentExportDialog [data-close]');
 }finally{await evaluate('globalThis.__restorePptDownload()');}
 console.log('  原生 PPT 浏览器下载、魔数、重开及不支持内容拒绝通过');
}
