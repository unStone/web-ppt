import { captureSaveAndReopen, changeValue, openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteResizeBrowserContract(context) {
  const { evaluate, click, waitFor } = context;
  const viewBox = "document.querySelector('#canvasMount [data-ppt-layer=static] svg')?.getAttribute('viewBox')";
  await openFixture(context, '/fixtures/sample-editor-resize.pptx', 'resize.pptx');
  await click('#slideSizeTools');
  await waitFor("document.querySelector('#slideSizeDialog')?.open", '页面尺寸弹窗就绪');
  await waitFor("document.querySelector('#slideSizeDialog')?.open", '页面尺寸弹窗');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#slideSizeTitle')?.textContent === 'Slide size'", '页面尺寸切英文');
  await changeValue(context, '#slideSizeDialog [name=width]', '640');
  await changeValue(context, '#slideSizeDialog [name=height]', '400');
  await click('#slideSizeDialog [data-apply]');
  await waitFor(`${viewBox} === '0 0 640 400' && !document.querySelector('#slideSizeDialog')`, '适配后画布');
  await click('#undo'); await waitFor(`${viewBox} === '0 0 1280 720'`, '撤销画布尺寸');
  await click('#redo'); await waitFor(`${viewBox} === '0 0 640 400'`, '重做画布尺寸');
  await click('#slideSizeTools');
  await waitFor("document.querySelector('#slideSizeDialog')?.open", '页面尺寸弹窗就绪');
  if (!await evaluate("document.querySelector('#slideSizeDialog [name=width]').value === '640' && document.querySelector('#slideSizeDialog [name=height]').value === '400'")) throw new Error('页面尺寸弹窗未同步当前值');
  await changeValue(context, '#slideSizeDialog [name=width]', '0');
  await click('#slideSizeDialog [data-apply]');
  if (!await evaluate(`document.querySelector('#slideSizeDialog')?.open && ${viewBox} === '0 0 640 400'`)) throw new Error('非法页面尺寸未拦截');
  await click('#slideSizeDialog [data-cancel]');
  await captureSaveAndReopen(context, 'resize-saved.pptx');
  await waitFor(`${viewBox} === '0 0 640 400'`, '保存重开保持画布');
  await click('#slideSizeTools');
  await waitFor("document.querySelector('#slideSizeDialog')?.open", '页面尺寸弹窗就绪');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#slideSizeTitle')?.textContent === '页面尺寸'", '页面尺寸切中文');
  await openFixture(context, '/fixtures/sample-editor-resize.pptx', 'resize-replacement.pptx');
  if (await evaluate("!!document.querySelector('#slideSizeDialog')")) throw new Error('换文稿未释放页面尺寸弹窗');
  console.log('  页面尺寸：比例适配、历史、校验、中英文、保存重开与释放通过');
}
