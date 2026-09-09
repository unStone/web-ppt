import assert from 'node:assert/strict';
import { openFixture, selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSiteChartJointBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  const ready = async () => {
    await selectPaneObject(context, '图表');
    await waitFor("!document.querySelector('#chartInspector').hidden && !!document.querySelector('[data-chart-grid=\"bubble\"]')", '共同记录网格加载');
  };
  const count = async expected => {
    await waitFor(`document.querySelectorAll('[data-chart-category]').length === ${expected}
      && document.querySelectorAll('[data-chart-grid="bubble"] tbody tr').length === ${expected}`, '类别与 XY 共同记录数');
  };
  const add = label => evaluate(`[...document.querySelectorAll('[data-chart-table] button')]
    .find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  const category = index => `[data-chart-category="${index}"] input[type="number"]`;
  const point = (index, field) => `[data-chart-grid="bubble"] tbody tr:nth-child(${index + 1}) td:nth-child(${field + 1}) input`;
  const values = async (index, expected) => {
    const selectors = [category(index), ...[0, 1, 2].map(field => point(index, field))];
    await waitFor(`!document.querySelector('#chartInspector').hidden && JSON.stringify(${JSON.stringify(selectors)}
      .map(selector => document.querySelector(selector)?.value)) === ${JSON.stringify(JSON.stringify(expected))}`, '共同记录三维值已刷新');
    assert.deepEqual(await evaluate(`${JSON.stringify(selectors)}.map(selector => document.querySelector(selector).value)`), expected);
  };
  for (const locale of ['zh-CN', 'en']) {
    await click(`[data-site-locale="${locale}"]`);
    await waitFor(`document.documentElement.lang === '${locale}'`, '共同记录界面语言');
    for (const name of ['mixed-records', 'mixed-records-horizontal', 'mixed-records-flat-horizontal']) {
      await openFixture(context, `/fixtures/sample-chart-shared-${name}.pptx`, `${name}-${locale}-ui.pptx`);
      await click('#editMode'); await ready(); await count(5);
      await add(locale === 'en' ? 'Add category' : '增加类别'); await count(6);
      await changeValue(context, category(5), '614');
      await waitFor(`document.querySelector('${point(5, 0)}')?.value === '614'`, '类别数值同步 X');
      await changeValue(context, point(5, 1), '728');
      await changeValue(context, point(5, 2), '729');
      await values(5, ['614', '614', '728', '729']);
      await add(locale === 'en' ? 'Add point' : '增加数据点'); await count(7);
      await changeValue(context, point(6, 0), '815');
      await click('#slideList [data-slide-id]:nth-child(2)'); await ready();
      await values(5, ['614', '614', '728', '729']); await values(6, ['815', '815', '0', '1']);
      await click('[data-chart-category="0"] button'); await count(6);
      await click('[data-chart-grid="bubble"] tbody tr:first-child button'); await count(5);
      await click('#undo'); await count(6); await click('#redo'); await count(5);
      await captureSaveAndReopen(context, `${name}-${locale}-reopened.pptx`);
      await click('#editMode'); await ready(); await count(5);
      await values(3, ['614', '614', '728', '729']); await values(4, ['815', '815', '0', '1']);
      if (!name.includes('flat')) continue;
      for (let remaining = 4; remaining >= 0; remaining--) {
        await click('[data-chart-grid="bubble"] tbody tr:first-child button'); await count(remaining);
      }
      await captureSaveAndReopen(context, `${name}-${locale}-empty.pptx`);
      await click('#editMode'); await ready(); await count(0);
      await add(locale === 'en' ? 'Add category' : '增加类别'); await count(1);
      await changeValue(context, point(0, 0), '916');
      await captureSaveAndReopen(context, `${name}-${locale}-rebuilt.pptx`);
      await click('#editMode'); await ready(); await count(1);
      await values(0, ['916', '916', '', '']);
    }
  }
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.documentElement.lang === 'zh-CN'", '共同记录流程归还页面语言');
  console.log('共同记录：纵横向、平面/层级、中英文双入口增删、跨页联动、三维数值、撤销重做及空保存重建通过');
}
