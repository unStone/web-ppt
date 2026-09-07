import assert from 'node:assert/strict';
import { openFixture, selectPaneObject, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSitePortableClipboardBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  const cases = [
    ['sample.ppt', null],
    ['sample-portable-rich-text.pptx', '嵌套公式混排'],
    ['sample-portable-rich-text.pptx', '艺术字调整值'],
    ['sample-portable-rich-text.pptx', '渐变描边阴影与独立下划线'],
  ];
  for (const [index, [fixture, objectName]] of cases.entries()) {
    await click(`[data-site-locale="${index % 2 ? 'en' : 'zh-CN'}"]`);
    await openFixture(context, `/fixtures/${fixture}`, `portable-source-${index}.${fixture.endsWith('.ppt') ? 'ppt' : 'pptx'}`);
    if (index === 0) await click('#editMode');
    const name = objectName ?? await evaluate(`document.querySelector('[data-pane-element] [data-pane-name]')?.textContent`);
    await selectPaneObject(context, name);
    const copied = await evaluate(`(() => {
      const root = document.querySelector('#canvasMount').firstElementChild;
      root.focus(); const data = new DataTransfer();
      const event = new ClipboardEvent('copy', {clipboardData:data,bubbles:true,cancelable:true});
      root.dispatchEvent(event);
      globalThis.__portableClipboard = data.getData('application/x-web-ppt-elements+json');
      return {prevented:event.defaultPrevented,bytes:globalThis.__portableClipboard.length};
    })()`);
    assert(copied.prevented && copied.bytes > 100, `${name} 同步复制产生独立载荷`);
    await openFixture(context, '/fixtures/sample-video-export.pptx', `portable-target-${index}.pptx`);
    const count = await evaluate(`document.querySelectorAll('[data-pane-element]').length`);
    await evaluate(`(() => {
      const root = document.querySelector('#canvasMount').firstElementChild;
      root.focus(); const data = new DataTransfer();
      data.setData('application/x-web-ppt-elements+json',globalThis.__portableClipboard);
      root.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    })()`);
    await waitFor(`document.querySelectorAll('[data-pane-element]').length===${count+1}`, `${name} 跨文稿粘贴`);
    await click('#undo');
    await waitFor(`document.querySelectorAll('[data-pane-element]').length===${count}`, '粘贴撤销');
    await click('#redo');
    await captureSaveAndReopen(context, `portable-reopened-${index}.pptx`);
    await waitFor(`document.querySelectorAll('[data-pane-element]').length===${count+1}`, '保存重开');
    if (objectName) await selectPaneObject(context, objectName);
  }
  await click('[data-site-locale="zh-CN"]');
  console.log('  PPT 无来源复制与原生公式/艺术字/文字效果：同步复制、跨文稿粘贴、撤销与保存重开通过');
}
