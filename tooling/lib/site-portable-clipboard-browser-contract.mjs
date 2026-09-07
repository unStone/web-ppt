import assert from 'node:assert/strict';
import { openFixture,selectPaneObject,captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
export async function runSitePortableClipboardBrowserContract(context){
 const {evaluate,waitFor,click}=context;
 await openFixture(context,'/fixtures/sample.ppt','portable-source.ppt');await click('#editMode');
 const name=await evaluate(`document.querySelector('[data-pane-element] [data-pane-name]')?.textContent`);
 await selectPaneObject(context,name);
 const copied=await evaluate(`(()=>{const root=document.querySelector('#canvasMount').firstElementChild;root.focus();const data=new DataTransfer();const event=new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true});root.dispatchEvent(event);globalThis.__portableClipboard=data.getData('application/x-web-ppt-elements+json');return {prevented:event.defaultPrevented,bytes:globalThis.__portableClipboard.length};})()`);
 assert(copied.prevented&&copied.bytes>100,'PPT 同步 ClipboardEvent 构造可移植载荷');
 await openFixture(context,'/fixtures/sample-video-export.pptx','portable-target.pptx');
 const count=await evaluate(`document.querySelectorAll('[data-pane-element]').length`);
 await evaluate(`(()=>{const root=document.querySelector('#canvasMount').firstElementChild;root.focus();const data=new DataTransfer();data.setData('application/x-web-ppt-elements+json',globalThis.__portableClipboard);root.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
 await waitFor(`document.querySelectorAll('[data-pane-element]').length===${count+1}`,'PPT 到另一文稿直接粘贴');
 await click('#undo');await waitFor(`document.querySelectorAll('[data-pane-element]').length===${count}`,'跨文稿粘贴撤销');await click('#redo');
 await captureSaveAndReopen(context,'portable-reopened.pptx');await waitFor(`document.querySelectorAll('[data-pane-element]').length===${count+1}`,'跨文稿复制保存重开');
 console.log('  无 OOXML 来源 PPT：同步复制事件、跨文稿粘贴、撤销与保存重开通过');
}
