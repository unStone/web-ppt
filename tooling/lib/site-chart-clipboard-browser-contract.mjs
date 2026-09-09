import assert from 'node:assert/strict';
import { openFixture, selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSiteChartClipboardBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  const cell = '[data-chart-category="1"] input[type="number"]';
  const chartRows = "[...document.querySelectorAll('[data-pane-element]')].filter(row => row.querySelector('[data-pane-name]')?.textContent === '图表')";
  await openFixture(context, '/fixtures/sample-chart-shared.pptx', 'clipboard-chart-source.pptx');
  await click('#editMode');
  await selectPaneObject(context, '图表');
  await waitFor(`!document.querySelector('#chartInspector').hidden && !!document.querySelector('${cell}')`, '复制源图表就绪');
  await changeValue(context, cell, '671');
  await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加类别').click()");
  await waitFor("document.querySelectorAll('[data-chart-category]').length === 6", '复制前新增类别');
  const copied = await evaluate(`(() => {
    const root = document.querySelector('#canvasMount').firstElementChild;
    root.focus(); const data = new DataTransfer();
    const event = new ClipboardEvent('copy', {clipboardData:data,bubbles:true,cancelable:true});
    root.dispatchEvent(event);
    globalThis.__chartClipboard = data.getData('application/x-web-ppt-elements+json');
    return {prevented:event.defaultPrevented,bytes:globalThis.__chartClipboard.length};
  })()`);
  assert(copied.prevented && copied.bytes > 100, '未保存的图表结构编辑可同步复制');
  await captureSaveAndReopen(context, 'clipboard-chart-target.pptx');
  await click('#editMode');
  const count = await evaluate(`${chartRows}.length`);
  const originalId = await evaluate(`${chartRows}[0].dataset.paneElement`);
  await evaluate(`(() => {
    const root = document.querySelector('#canvasMount').firstElementChild;
    root.focus(); const data = new DataTransfer();
    data.setData('application/x-web-ppt-elements+json',globalThis.__chartClipboard);
    root.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  })()`);
  await waitFor(`${chartRows}.length === ${count + 1}`, '匹配当前原生资源的文稿接收图表');
  await evaluate(`${chartRows}.find(row => row.dataset.paneElement !== ${JSON.stringify(originalId)}).click()`);
  await waitFor(`!document.querySelector('#chartInspector').hidden && document.querySelector('${cell}')?.value === '671'`, '粘贴图表立即显示数据网格');
  assert.equal(await evaluate("document.querySelectorAll('[data-chart-category]').length"), 6);
  await changeValue(context, cell, '782');
  await evaluate(`${chartRows}.find(row => row.dataset.paneElement === ${JSON.stringify(originalId)}).click()`);
  await waitFor(`document.querySelector('${cell}')?.value === '782'`, '从粘贴图表编辑同步到原框架');
  await click('#undo');
  await waitFor(`document.querySelector('${cell}')?.value === '671'`, '撤销粘贴图表的数据编辑');
  await click('#undo');
  await waitFor(`${chartRows}.length === ${count}`, '撤销图表粘贴');
  await click('#redo'); await click('#redo');
  await captureSaveAndReopen(context, 'clipboard-chart-reopened.pptx');
  await click('#editMode');
  await waitFor(`${chartRows}.length === ${count + 1}`, '重开保留粘贴框架');
  await evaluate(`${chartRows}.at(-1).click()`);
  await waitFor(`!document.querySelector('#chartInspector').hidden && document.querySelector('${cell}')?.value === '782'`, '粘贴、联动与历史保留到保存重开');
  await openFixture(context, '/fixtures/sample-chart-shared.pptx', 'clipboard-obsolete-target.pptx');
  await click('#editMode');
  await evaluate(`(() => {
    const root = document.querySelector('#canvasMount').firstElementChild;
    root.focus(); const data = new DataTransfer();
    data.setData('application/x-web-ppt-elements+json',globalThis.__chartClipboard);
    root.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  })()`);
  await waitFor("document.querySelector('#statusText').dataset.tone === 'error' && document.querySelector('#statusText').textContent.includes('OPC')", '目标资源过期时显示原子拒绝原因');
  assert.equal(await evaluate(`${chartRows}.length`), 1, '粘贴失败不增加图表框架');
  assert.equal(await evaluate("document.querySelector('#fileName').textContent"), 'clipboard-obsolete-target.pptx', '失败不把文稿标为已修改');
  console.log('图表剪贴板：未保存结构编辑、跨文稿粘贴、即时网格、共享编辑、撤销重做与原生保存通过');
}
