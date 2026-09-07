import { writeFileSync, mkdirSync } from 'node:fs';
import { openFixture, selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSiteChartDesignBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-chart-data.pptx', 'chart-design-ui.pptx');
  await selectPaneObject(context, '图表');
  const form = '[data-chart-design]';
  await waitFor(`!!document.querySelector('${form} select')`, '图表样式工具');
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('${form} button[type="submit"]').textContent === 'Apply chart design'`, '图表样式英文');
  for (const [name, value] of Object.entries({ type: 'line', title: '原文 & <新标题>', palette: '#D32F2F, #1565C0', legend: 'bottom', labels: 'true' })) {
    await changeValue(context, `${form} [name="${name}"]`, value);
  }
  await click(`${form} button[type="submit"]`);
  await waitFor("document.querySelector('#statusText').textContent === 'Chart design updated'", '样式已提交');
  await waitFor(`document.querySelector('${form} [name="type"]').value === 'line'`, '图表切到折线');
  await click('#undo');
  await waitFor(`document.querySelector('${form} [name="type"]').value === ''`, '样式撤销');
  await click('#redo');
  await waitFor(`document.querySelector('${form} [name="type"]').value === 'line'`, '样式重做');
  await captureSaveAndReopen(context, 'chart-design-reopened.pptx');
  await selectPaneObject(context, '图表');
  await waitFor(`!!document.querySelector('${form}') && document.querySelector('#canvasMount').textContent.includes('原文 & <新标题>')`, '原生图表样式保存重开');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('${form} button[type="submit"]').textContent === '应用图表样式'`, '图表样式中文');
  if (!await evaluate(`document.querySelector('#canvasMount').textContent.includes('原文 & <新标题>')`)) throw new Error('图表标题原文丢失');
  await runModern(context);
}

async function runModern(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-chartex-edit.pptx', 'modern-edit-ui.pptx');
  await click('#slideList [data-slide-id]:nth-child(6)');
  await waitFor(`document.querySelector('#pageIndicator').textContent === '6 / 8'`, '瀑布图页面就绪');
  await selectPaneObject(context, '图表');
  const grid = '[data-chartex-data="0"]';
  await waitFor(`!!document.querySelector('${grid} input')`, '现代图表数据工具');
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('[data-chartex-editor] h4').textContent === 'Dataset 1'`, '现代图表英文');
  const cell = `${grid} [data-dimension="1"][data-point="0"]`;
  await changeValue(context, cell, '2468');
  await waitFor(`document.querySelector('${cell}').value === '2468' && document.querySelector('#statusText').textContent === 'Chart data updated'`, '现代图表修改');
  await click('#undo');
  await waitFor(`document.querySelector('${cell}').value === '1280'`, '现代图表撤销');
  await click('#redo');
  await waitFor(`document.querySelector('${cell}').value === '2468'`, '现代图表重做');
  await evaluate(`[...document.querySelectorAll('[data-chartex-editor] button')].find((b) => b.textContent === 'Add data row').click()`);
  await waitFor(`document.querySelector('${grid}').tBodies[0].rows.length === 5`, '现代图表增加数据行');
  await changeValue(context, `${grid} [data-dimension="1"][data-point="4"]`, '42');
  await captureSaveAndReopen(context, 'modern-edit-reopened.pptx');
  await click('#slideList [data-slide-id]:nth-child(6)');
  await waitFor(`document.querySelector('#pageIndicator').textContent === '6 / 8'`, '瀑布图页面就绪');
  await selectPaneObject(context, '图表');
  await waitFor(`document.querySelector('${cell}')?.value === '2468' && document.querySelector('${grid}').tBodies[0].rows.length === 5`, '现代图表数据与工作簿保存重开');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('[data-chartex-editor] h4').textContent === '数据集 1'`, '现代图表中文');
  await openFixture(context, '/fixtures/sample-region-map.pptx', 'region-map-ui.pptx');
  await click('#slideList [data-slide-id]:nth-child(8)');
  await selectPaneObject(context, '图表');
  await waitFor(`document.querySelector('#canvasMount svg path') && document.querySelector('[data-chartex-data] input')`, '原生地图和数据工具');
  const mapCell = '[data-chartex-data="0"] [data-dimension="1"][data-point="0"]';
  await changeValue(context, mapCell, '55');
  await waitFor(`document.querySelector('${mapCell}')?.value === '55' && !document.querySelector('#chartInspector').hidden`, '地图数值编辑');
  await captureSaveAndReopen(context, 'region-map-reopened.pptx');
  await click('#slideList [data-slide-id]:nth-child(8)');
  await selectPaneObject(context, '图表');
  await waitFor(`document.querySelector('${mapCell}')?.value === '55'`, '地图原生数据保存重开');
  mkdirSync('out/region-map', { recursive: true });
  const screenshot = await context.request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('out/region-map/browser.png', Buffer.from(screenshot.result.data, 'base64'));

}
