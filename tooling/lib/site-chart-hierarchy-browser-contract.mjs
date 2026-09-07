import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openFixture, selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSiteChartHierarchyBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-chart-hierarchy.pptx', 'hierarchy-ui.pptx');
  await click('#editMode');
  await selectPaneObject(context, '图表');
  const cell = (row, level) => `[data-chart-category="${row}"] [data-chart-level="${level}"]`;
  const empty = (row, level) => `[data-chart-category="${row}"] [data-chart-empty="${level}"]`;
  await waitFor(`document.querySelectorAll('[data-chart-level]').length === 10`, '层级编辑网格');
  assert.equal(await evaluate(`document.querySelector('${empty(1,0)}').checked`), true);
  assert.equal(await evaluate(`document.querySelector('${empty(2,1)}').checked`), false, '显式空串不是空槽');
  assert.equal(await evaluate(`document.querySelector('${empty(3,1)}').checked`), true, '缺失叶标签保留空槽');
  await changeValue(context, cell(0,0), 'West');
  await waitFor(`document.querySelector('${cell(0,0)}').value === 'West'`, '父组改名');
  await click('#undo');
  await waitFor(`document.querySelector('${cell(0,0)}').value === 'North'`, '层级撤销');
  await click('#redo');
  await waitFor(`document.querySelector('${cell(0,0)}').value === 'West'`, '层级重做');
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('[data-chart-grid] th').textContent === 'Level 1'`, '层级英文');
  await click(empty(3,1));
  await waitFor(`document.querySelector('${cell(3,1)}').disabled === false`, '缺失标签改成显式空串');
  await changeValue(context, cell(3,1), 'New leaf');
  await captureSaveAndReopen(context, 'hierarchy-reopened.pptx');
  await selectPaneObject(context, '图表');
  await waitFor(`document.querySelector('${cell(0,0)}')?.value === 'West' && document.querySelector('${cell(3,1)}')?.value === 'New leaf'`, '层级保存重开');
  assert.equal(await evaluate(`document.querySelector('${cell(4,1)}').value`), '0');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('[data-chart-grid] th').textContent === '第 1 级'`, '层级中文');
  await evaluate("document.querySelector('[data-chart-grid]').scrollIntoView({block:'center'})");
  mkdirSync('out/chart-hierarchy', { recursive: true });
  const screenshot = await context.request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('out/chart-hierarchy/browser.png', Buffer.from(screenshot.result.data, 'base64'));
}
