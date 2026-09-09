import assert from 'node:assert/strict';
import { openFixture, selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { runSiteChartJointBrowserContract } from './site-chart-joint-browser-contract.mjs';

export async function runSiteChartMixedBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  for (const name of ['mixed', 'mixed-horizontal', 'mixed-crossed']) {
    const category = '[data-chart-category="5"] input[type="number"]';
    const xy = '[data-chart-grid="bubble"] tbody tr:nth-child(5) td:nth-child(2) input';
    const ready = async () => {
      await selectPaneObject(context, '图表');
      await waitFor("!document.querySelector('#chartInspector').hidden && !!document.querySelector('[data-chart-grid=\"bubble\"]')", '混合图网格加载');
    };
    const counts = () => evaluate(`({categories:document.querySelectorAll('[data-chart-category]').length,
      points:document.querySelectorAll('[data-chart-grid="bubble"] tbody tr').length})`);
    await openFixture(context, `/fixtures/sample-chart-shared-${name}.pptx`, `${name}-ui.pptx`);
    await click('#editMode'); await ready();
    assert.deepEqual(await counts(), { categories: 5, points: 4 });
    await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加类别').click()");
    await waitFor("document.querySelectorAll('[data-chart-category]').length === 6", '混合图新增类别');
    assert.deepEqual(await counts(), { categories: 6, points: 4 });
    await changeValue(context, category, '614');
    await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加数据点').click()");
    await waitFor("document.querySelectorAll('[data-chart-grid=\"bubble\"] tbody tr').length === 5", '混合图新增 XY 点');
    await changeValue(context, xy, '728');
    await click('#slideList [data-slide-id]:nth-child(2)'); await ready();
    await waitFor(`document.querySelector('${category}')?.value === '614' && document.querySelector('${xy}')?.value === '728'`, '另一部件共享两条记录轴');
    await click('#undo');
    await waitFor(`document.querySelector('${xy}')?.value === '0'`, '从另一框架撤销 XY 编辑');
    assert.equal(await evaluate(`document.querySelector('${category}').value`), '614');
    await click('#redo');
    await captureSaveAndReopen(context, `${name}-reopened.pptx`);
    await click('#editMode'); await ready();
    await waitFor(`document.querySelector('${category}')?.value === '614' && document.querySelector('${xy}')?.value === '728'`, '混合图保存重开保留两个独立区域');
    assert.deepEqual(await counts(), { categories: 6, points: 5 });
  }
  await runSiteChartJointBrowserContract(context);
  await openFixture(context, '/fixtures/sample-chart-shared-mixed-overlap-crossed.pptx', 'mixed-overlap-ui.pptx');
  await click('#editMode'); await selectPaneObject(context, '图表');
  const x = '[data-chart-grid="bubble"] tbody tr:first-child td:first-child input';
  await waitFor(`!document.querySelector('#chartInspector').hidden && !!document.querySelector('${x}')`, '交叠区域混合图加载');
  await changeValue(context, x, '921');
  await waitFor("document.querySelector('[data-chart-category=\"0\"] input[type=\"number\"]').value === '921'", 'XY 与类别共用单元格的标量联动');
  await evaluate("[...document.querySelectorAll('[data-chart-table] button')].find(button => button.textContent === '增加类别').click()");
  await waitFor("document.querySelector('#statusText').dataset.tone === 'error' && /XY|记录轴/.test(document.querySelector('#statusText').textContent)", '无法解释的跨记录轴增删显示具体原因');
  assert.equal(await evaluate("document.querySelectorAll('[data-chart-category]').length"), 5);
  assert.equal(await evaluate("document.querySelectorAll('[data-chart-grid=\"bubble\"] tbody tr').length"), 5);
  console.log('混合图表：独立区域新增类别与 XY 点、跨页联动、撤销及保存重开；交叠区域标量联动与歧义增删反馈通过');
}
