import { openFixture, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { doubleClickElement } from './browser-double-click.mjs';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { makeZip } from './ooxml.mjs';
import { withDelayedFileRead } from './file-read-boundary.mjs';

export async function runSiteI18nContentContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', '<插入 & 原文>.pptx');
  const originalCount = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await click('#addShape');
  await waitFor("document.querySelector('#statusText').textContent === 'Rounded rectangle inserted; drag to move or double-click to type'", '形状插入英文状态');
  const shapeName = await evaluate("document.querySelector('[data-pane-element][aria-selected=true] [data-pane-name]').textContent");
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '已插入圆角矩形；拖动可移动，双击可输入文字'", '形状插入状态切中文');
  await click('#undo'); await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${originalCount}`, '插入形状仅一个撤销单元');
  await click('#redo');
  const id = await evaluate("document.querySelector('[data-pane-element][aria-selected=true]').dataset.paneElement");
  await doubleClickElement(context, `[data-edit-id="${id}"]`);
  await waitFor("!!document.querySelector('[data-ppt-text-editor]')", '新增形状真实双击编辑');
  await request('Input.insertText', { text: '<形状文字 & 原文>' });
  await escape(context);
  await click('[data-site-locale="en"]');
  if (!await evaluate(`document.querySelector('[data-pane-element][aria-selected=true] [data-pane-name]').textContent === ${JSON.stringify(shapeName)}`)) throw new Error('创建后的对象名称不应随语言翻译');
  await click('#addTable');
  await waitFor("document.querySelector('#statusText').textContent === '3 × 3 table inserted; double-click a cell to type'", '表格插入英文状态');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '已插入 3 × 3 表格；双击单元格即可输入'", '表格插入切中文');
  await click('#undo'); await waitFor("!document.querySelector('[data-table-cell]')", '表格插入撤销');
  await click('#redo');
  await doubleClickElement(context, '[data-table-cell="0:1"]');
  await waitFor("document.querySelector('[data-ppt-text-editor]')?.dataset.pptTextCell === '0:1'", '真实双击命中正确单元格');
  await request('Input.insertText', { text: '<表格文字 & 原文>' });
  await escape(context);
  await click('#addSlide');
  await waitFor("document.querySelector('#statusText').textContent === '已新增幻灯片'", '新增页中文状态');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#statusText').textContent === 'Slide added'", '新增页状态切英文');
  if (!await evaluate(`document.querySelectorAll('[data-slide-id]').length === 2
    && [...document.querySelectorAll('[data-slide-id]')].map((node) => node.getAttribute('aria-label')).join('|') === 'Open slide 1|Open slide 2'
    && document.querySelector('#slideLayout').selectedOptions[0].textContent === 'Blank'`)) throw new Error('页导航名称未翻译或翻译了文稿版式原名');
  await click('#undo'); await waitFor("document.querySelectorAll('[data-slide-id]').length === 1", '新增页撤销');
  await click('#redo');
  await click('[data-slide-id]:last-child');
  await insertImage(context);
  await captureSaveAndReopen(context, 'content-language-saved.pptx');
  await click('[data-slide-id]:first-child');
  if (!await evaluate(`document.querySelector('#canvasMount').textContent.includes('<形状文字 & 原文>')
    && document.querySelector('#canvasMount').textContent.includes('<表格文字 & 原文>')
    && document.querySelector('#undo').disabled`)) throw new Error('插入内容未保留原文保存重开');
  await click('[data-slide-id]:last-child');
  if (!await evaluate("!!document.querySelector('#canvasMount image') && document.querySelector('#undo').disabled")) throw new Error('新增图片未保存到正确页面');
  const parts = unzipSync(readFileSync(new URL('../../fixtures/sample-editor-shape-format.pptx', import.meta.url)));
  const part = 'ppt/slideLayouts/slideLayout1.xml';
  const xml = new TextDecoder().decode(parts[part]);
  if (!xml.includes('<p:cSld name="Blank">')) throw new Error('无名版式负例的源固件名称已变化');
  parts[part] = new TextEncoder().encode(xml.replace('<p:cSld name="Blank">', '<p:cSld name="">'));
  const encoded = Buffer.from(makeZip(Object.entries(parts))).toString('base64');
  await openFixture(context, 'data:application/octet-stream;base64,' + encoded, '无名版式.pptx');
  await waitFor("document.querySelector('#slideLayout').selectedOptions[0].textContent === 'Layout 1'", '无名版式英文回退名称');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#slideLayout').selectedOptions[0].textContent === '版式 1'", '无名版式中文回退名称');
}

async function insertImage(context) {
  const { request, evaluate, click, waitFor } = context;
  await request('Page.setInterceptFileChooserDialog', { enabled: true });
  try {
    await withDelayedFileRead(context, '<插图 & 原文>.png', async (read) => {
      await click('#addImage');
      await waitFor("!!document.querySelector('[data-web-ppt-image-input]')", '真实图片文件选择器');
      await evaluate(`(async () => {
        const bytes = await fetch('/assets/replacement.png').then((response) => response.arrayBuffer());
        const files = new DataTransfer(); files.items.add(new File([bytes], '<插图 & 原文>.png', { type: 'image/png' }));
        const input = document.querySelector('[data-web-ppt-image-input]'); input.files = files.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, true);
      await read.wait();
      await click('[data-site-locale="zh-CN"]');
      await read.finish();
      await waitFor("document.querySelector('#statusText').textContent === '图片已插入'", '插入图片异步结果使用当前语言');
      await click('[data-site-locale="en"]');
      await waitFor("document.querySelector('#statusText').textContent === 'Image inserted'", '插入图片状态切英文');
      await click('#undo'); await waitFor("!document.querySelector('#canvasMount image')", '新增图片撤销');
      await click('#redo'); await waitFor("!!document.querySelector('#canvasMount image')", '新增图片重做');
    });
  } finally {
    await request('Page.setInterceptFileChooserDialog', { enabled: false });
  }
}

async function escape({ request }) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await request('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  }
}
