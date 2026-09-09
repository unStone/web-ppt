import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openFixture, selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { runSiteChartClipboardBrowserContract } from './site-chart-clipboard-browser-contract.mjs';
import { runSiteChartMixedBrowserContract } from './site-chart-mixed-browser-contract.mjs';
import { runSiteChartLegacyBrowserContract } from './site-chart-legacy-browser-contract.mjs';

export async function runSiteChartSharedBrowserContract(context) {
  await runSiteChartLegacyBrowserContract(context);
  const { evaluate, waitFor, click, request } = context;
  const cell = '[data-chart-category="1"] input[type="number"]';
  const page = async (index, selector = cell) => {
    await click(`#slideList [data-slide-id]:nth-child(${index})`);
    await waitFor(`document.querySelector('#pageIndicator').textContent === '${index} / 3'`, '共享图表切换页面');
    await selectPaneObject(context, '图表');
    // 切页时旧网格仍留在隐藏面板中；节点存在不代表当前图表已完成异步渲染。
    await waitFor(`!document.querySelector('#chartInspector').hidden && !!document.querySelector('${selector}')`, '共享图表网格');
  };
  for (const cache of [false, true]) {
    await openFixture(context, `/fixtures/sample-chart-shared${cache ? '-cache' : ''}.pptx`, 'shared-ui.pptx');
    await click('#editMode');
    await selectPaneObject(context, '图表');
    await waitFor(`!document.querySelector('#chartInspector').hidden && !!document.querySelector('${cell}') && !document.querySelector('${cell}').disabled`, '共享图表可写');
    await changeValue(context, cell, '729');
    await page(2);
    assert.equal(await evaluate(`document.querySelector('${cell}').value`), cache ? '10' : '729');
    await page(3);
    assert.equal(await evaluate(`document.querySelector('${cell}').value`), '729', '同一图表部件的另一框架即时读取共享值');
    await click('#undo');
    await waitFor(`document.querySelector('${cell}').value === '10'`, '从另一框架撤销共享事务');
    await page(1);
    assert.equal(await evaluate(`document.querySelector('${cell}').value`), '10');
    await click('#redo');
    await waitFor(`document.querySelector('${cell}').value === '729'`, '共享事务重做');
    await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加类别').click()");
    await waitFor("document.querySelectorAll('[data-chart-category]').length === 6", '新增共享类别');
    const newCategory = '[data-chart-category="5"] input[type="number"]';
    await changeValue(context, newCategory, '971');
    await page(2);
    assert.equal(await evaluate("document.querySelectorAll('[data-chart-category]').length"), cache ? 5 : 6);
    await page(3);
    assert.equal(await evaluate(`document.querySelector('${newCategory}').value`), '971', '新增类别和数值同步到另一框架');
    await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加系列').click()");
    await waitFor("document.querySelectorAll('[data-chart-grid] thead input').length === 3", '新增共享系列');
    const added = '[data-chart-category="1"] td:last-child input';
    await changeValue(context, added, '847');
    await page(3);
    assert.equal(await evaluate(`document.querySelector('${added}').value`), '847', '新系列值同步到另一框架');
    await click('[data-chart-category="0"] button[aria-label^="删除类别"]');
    await waitFor("document.querySelectorAll('[data-chart-category]').length === 5", '删除共享类别');
    assert.equal(await evaluate("document.querySelector('[data-chart-category=\"0\"] td:last-child input').value"), '847');
    await click('#undo');
    await waitFor("document.querySelectorAll('[data-chart-category]').length === 6", '撤销共享删行');
    await click('[data-chart-grid] thead th:last-child button');
    await waitFor("document.querySelectorAll('[data-chart-grid] thead input').length === 2", '删除新增共享系列');
    await click('#undo');
    await waitFor("document.querySelectorAll('[data-chart-grid] thead input').length === 3", '撤销共享系列删除');
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('[data-chart-grid] th').textContent === 'Level 1'", '共享图表英文网格');
    await captureSaveAndReopen(context, 'shared-reopened.pptx');
    await page(3);
    assert.equal(await evaluate(`document.querySelector('${cell}').value`), '729');
    assert.equal(await evaluate(`document.querySelector('${added}').value`), '847', '新系列的编辑和结构撤销保存重开保持');
    assert.equal(await evaluate(`document.querySelector('${newCategory}').value`), '971', '新增类别保存重开保持稳定寻址');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('[data-chart-grid] th').textContent === '第 1 级'", '共享图表中文网格');
    await evaluate("document.querySelector('[data-chart-grid]').scrollIntoView({block:'center'})");
    mkdirSync('out/chart-shared', { recursive: true });
    const screenshot = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(`out/chart-shared/browser-${cache ? 'cache' : 'workbook'}.png`, Buffer.from(screenshot.result.data, 'base64'));
  }
  await openFixture(context, '/fixtures/sample-chart-shared-xy.pptx', 'shared-xy-ui.pptx');
  await click('#editMode'); await selectPaneObject(context, '图表');
  await waitFor("document.querySelectorAll('.chart-xy-series').length === 2", '共享气泡系列就绪');
  const sourceXY = '.chart-xy-series:first-of-type';
  await evaluate("document.querySelector('.chart-xy-series').lastElementChild.click()");
  await waitFor(`document.querySelectorAll('${sourceXY} tbody tr').length === 5`, '原有 XY 系列新增共享点');
  for (const [index, value] of ['41', '42', '43'].entries()) {
    await changeValue(context, `${sourceXY} tbody tr:last-child td:nth-child(${index + 1}) input`, value);
  }
  await page(2, '[data-chart-grid="bubble"]');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${sourceXY} tbody tr:last-child input')].map(input => input.value)`), ['41', '42', '43']);
  await click(`${sourceXY} tbody tr:first-child button`);
  await waitFor(`document.querySelectorAll('${sourceXY} tbody tr').length === 4`, '原有共享点删除');
  await page(3, '[data-chart-grid="bubble"]');
  await click('#undo');
  await waitFor(`document.querySelectorAll('${sourceXY} tbody tr').length === 5`, '跨框架撤销来源点删除');
  await click('#redo');
  await waitFor(`document.querySelectorAll('${sourceXY} tbody tr').length === 4`, '重做来源点删除');
  await page(1, '[data-chart-grid="bubble"]');
  await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加气泡系列').click()");
  await waitFor("document.querySelectorAll('.chart-xy-series').length === 3", '新增共享气泡系列');
  const addPoint = () => evaluate("[...document.querySelectorAll('.chart-xy-series')].at(-1).lastElementChild.click()");
  await addPoint();
  await waitFor("[...document.querySelectorAll('.chart-xy-series')].at(-1).querySelectorAll('tbody tr').length === 1", '新增共享 XY 点');
  const lastXY = '[data-chart-table] .chart-xy-series:nth-last-child(2)';
  for (const [index, value] of ['31', '32', '33'].entries()) {
    await changeValue(context, `${lastXY} tbody tr:first-child td:nth-child(${index + 1}) input`, value);
  }
  await addPoint();
  await page(3, '[data-chart-grid="bubble"]');
  await waitFor("document.querySelectorAll('.chart-xy-series').length === 3", '另一框架读取新增气泡系列');
  await click(`${lastXY} tbody tr:first-child button`);
  await waitFor(`document.querySelectorAll('${lastXY} tbody tr').length === 1`, '共享 XY 点删除');
  await click('#undo');
  await waitFor(`document.querySelectorAll('${lastXY} tbody tr').length === 2`, '共享 XY 点删除撤销');
  await click('[data-site-locale="en"]');
  await captureSaveAndReopen(context, 'shared-xy-reopened.pptx');
  await page(3, '[data-chart-grid="bubble"]');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${lastXY} tbody tr:first-child input')].map(input => input.value)`), ['31', '32', '33']);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${sourceXY} tbody tr:last-child input')].map(input => input.value)`), ['41', '42', '43'],
    '原有 XY 系列的点增删和数值编辑保存重开保持');
  await click('[data-site-locale="zh-CN"]');
  let xySeries = await evaluate("document.querySelectorAll('.chart-xy-series').length");
  while (xySeries) {
    await click('.chart-xy-series .chart-series-heading button'); xySeries--;
    await waitFor(`document.querySelectorAll('.chart-xy-series').length === ${xySeries}`, '删空共享 XY 系列');
  }
  await captureSaveAndReopen(context, 'shared-empty-xy.pptx');
  await page(3, '[data-chart-table] > .inspector-actions');
  await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加气泡系列').click()");
  await waitFor("document.querySelectorAll('.chart-xy-series').length === 1", '保存模板重建共享 XY 系列');
  await evaluate("document.querySelector('.chart-xy-series').lastElementChild.click()");
  await waitFor("document.querySelectorAll('.chart-xy-series tbody tr').length === 1", '重建 XY 系列添加数据点');
  for (const [index, value] of ['141', '142', '143'].entries()) {
    await changeValue(context, `${sourceXY} tbody tr:first-child td:nth-child(${index + 1}) input`, value);
  }
  await click('[data-site-locale="en"]');
  await captureSaveAndReopen(context, 'shared-rebuilt-xy.pptx');
  await page(3, '[data-chart-grid="bubble"]');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${sourceXY} tbody tr:first-child input')].map(input => input.value)`), ['141', '142', '143']);
  await click('[data-site-locale="zh-CN"]');
  await openFixture(context, '/fixtures/sample-chart-shared-cache-horizontal.pptx', 'shared-square-ui.pptx');
  await click('#editMode'); await selectPaneObject(context, '图表');
  await waitFor("!!document.querySelector('[data-chart-category]')", '横向共享层级就绪');
  let categories = await evaluate("document.querySelectorAll('[data-chart-category]').length");
  while (categories > 2) {
    await click(`[data-chart-category="${categories - 1}"] button[aria-label^="删除类别"]`);
    categories--;
    await waitFor(`document.querySelectorAll('[data-chart-category]').length === ${categories}`, '缩为方形类别范围');
  }
  let seriesCount = await evaluate("document.querySelectorAll('[data-chart-grid] thead input').length");
  while (seriesCount) {
    await click('[data-chart-grid] thead th:last-child button'); seriesCount--;
    await waitFor(`document.querySelectorAll('[data-chart-grid] thead input').length === ${seriesCount}`, '删空层级系列');
  }
  await captureSaveAndReopen(context, 'shared-empty-series.pptx');
  await page(3, '[data-chart-category]');
  await click('.chart-table-wrap > .inspector-actions button:last-child');
  await waitFor("document.querySelectorAll('[data-chart-grid] thead input').length === 1", '重开后重建层级系列');
  const firstValue = '[data-chart-category="0"] input[type="number"]';
  await changeValue(context, firstValue, '431');
  await changeValue(context, cell, '0');
  await click('[data-site-locale="en"]');
  await captureSaveAndReopen(context, 'shared-square-reopened.pptx');
  await page(3, firstValue);
  assert.equal(await evaluate(`document.querySelector('${firstValue}').value`), '431');
  assert.equal(await evaluate(`document.querySelector('${cell}').value`), '0');
  assert.equal(await evaluate(`document.querySelector('${firstValue}').disabled`), false, '方形 literal 层级重开仍可编辑');
  assert.equal(await evaluate("document.querySelectorAll('[data-chart-category]').length"), 2);
  await click('[data-site-locale="zh-CN"]');
  await openFixture(context, '/fixtures/sample-chart-hierarchy.pptx', 'shared-before-copy.pptx');
  await click('#editMode');
  await selectPaneObject(context, '图表');
  await waitFor(`!!document.querySelector('${cell}')`, '单框架图表数据');
  await changeValue(context, cell, '835');
  await click('#duplicateSlide');
  await waitFor("document.querySelector('#pageIndicator').textContent === '2 / 4'", '编辑后复制页面');
  await selectPaneObject(context, '图表');
  await waitFor(`document.querySelector('${cell}')?.value === '835'`, '副本保留复制前的数据');
  await changeValue(context, cell, '937');
  await click('#slideList [data-slide-id]:nth-child(1)');
  await selectPaneObject(context, '图表');
  await waitFor(`document.querySelector('${cell}')?.value === '937'`, '从副本编辑同步到原图表');
  await click('#undo');
  await waitFor(`document.querySelector('${cell}')?.value === '835'`, '复制后编辑撤销');
  await click('#redo');
  await captureSaveAndReopen(context, 'shared-before-copy-saved.pptx');
  await click('#editMode');
  await selectPaneObject(context, '图表');
  await waitFor(`document.querySelector('${cell}')?.value === '937'`, '复制过渡保存重开');
  console.log('共享图表：工作簿/缓存、类别与系列新增、XY 点与删空重建、方形层级重建、跨框架联动、撤销、重做、中英文与保存重开通过');
  await runSiteChartClipboardBrowserContract(context);
  await runSiteChartMixedBrowserContract(context);
}
