import { openFixture, selectPaneObject, changeValue, saveAndReopen } from './site-editor-browser-helpers.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';
import { runSiteI18nChartLoadingContract } from './site-i18n-chart-loading-contract.mjs';
import { runSiteI18nChartReadonlyContract } from './site-i18n-chart-readonly-contract.mjs';

export async function runSiteI18nChartContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await waitFor("document.documentElement.lang === 'en'", '图表使用英文');
  await openFixture(context, '/fixtures/sample-chart-data.pptx', '<图表 & 原文>.pptx');
  await selectPaneObject(context, '图表');
  await waitFor(`!document.querySelector('#chartInspector').hidden && !!document.querySelector('[data-chart-grid="category"]')`, '图表数据按需加载');
  await waitFor("document.querySelector('[data-chart-status]').textContent === 'Saving synchronizes the chart and embedded workbook'", '图表工作簿英文提示');
  if (!await evaluate(`[...document.querySelectorAll('#chartInspector button')].some((node) => node.textContent === 'Add category')
    && [...document.querySelectorAll('#chartInspector button')].some((node) => node.textContent === 'Add series')
    && document.querySelector('[data-chart-grid] thead input').value === '2024 年'
    && document.querySelector('[data-chart-grid] tbody input').value === '第一季度'`)) {
    throw new Error('图表操作未翻译或图表原始数据被翻译');
  }
  if (!await evaluate(`document.querySelector('[data-chart-grid] thead input').getAttribute('aria-label') === 'Series name: 2024 年'
    && document.querySelector('[data-chart-grid] thead button').getAttribute('aria-label') === 'Remove series: 2024 年'
    && document.querySelector('[data-chart-grid] tbody input').getAttribute('aria-label') === 'Category name: 第一季度'
    && document.querySelector('[data-chart-grid] tbody button').getAttribute('aria-label') === 'Remove category: 第一季度'
    && document.querySelector('[data-chart-grid] tbody input[type="number"]').getAttribute('aria-label') === 'Value — 第一季度 / 2024 年'`)) {
    throw new Error('图表输入和符号删除按钮缺少带原文上下文的英文可访问名称');
  }
  await evaluate(`(() => {
    globalThis.__languageChartGrid = document.querySelector('[data-chart-grid]');
    globalThis.__languageChartCanvas = document.querySelector('#canvasMount').firstElementChild;
    const input = globalThis.__languageChartGrid.querySelector('thead input');
    input.focus(); input.select();
  })()`);
  await request('Input.insertText', { text: '<复制 & 未提交>' });
  await evaluate("document.activeElement.setSelectionRange(1, 3)");
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.documentElement.lang === 'zh-CN'", '图表输入中切中文');
  if (!await evaluate(`globalThis.__languageChartGrid === document.querySelector('[data-chart-grid]')
    && globalThis.__languageChartCanvas === document.querySelector('#canvasMount').firstElementChild
    && document.activeElement === globalThis.__languageChartGrid.querySelector('thead input')
    && document.activeElement.value === '<复制 & 未提交>' && document.activeElement.selectionStart === 1
    && document.activeElement.selectionEnd === 3
    && document.querySelector('#undo').disabled
    && document.querySelector('[data-chart-status]').textContent === '保存时同步图表与内嵌工作簿'`)) {
    throw new Error('切语言重建图表、丢失输入/光标或未刷新状态');
  }
  await request('Emulation.setTouchEmulationEnabled', { enabled: true });
  try {
    const point = await evaluate(`(() => {
      const rect = document.querySelector('[data-site-locale="en"]').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor("document.documentElement.lang === 'en'", '真实输入后触屏切英文');
    if (!await evaluate(`globalThis.__languageChartGrid === document.querySelector('[data-chart-grid]')
      && document.activeElement === globalThis.__languageChartGrid.querySelector('thead input')
      && document.activeElement.value === '<复制 & 未提交>' && document.activeElement.selectionStart === 1
      && document.activeElement.selectionEnd === 3 && document.querySelector('#undo').disabled`)) throw new Error('触屏语言切换不应提交或丢失真实输入');
  } finally { await request('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  await runSiteLanguageInputContract(context, '图表数据工具');
  await runCategoryEdits(context);
  await runXYAndCombo(context);
  await runSiteI18nChartReadonlyContract(context);
  await runSiteI18nChartLoadingContract(context);
}

async function runXYAndCombo(context) {
  const { evaluate, click, waitFor } = context;
  await click('#slideList [data-slide-id]:nth-child(5)');
  await selectPaneObject(context, '图表');
  await waitFor(`!!document.querySelector('[data-chart-grid="scatter"]')`, '散点数据表');
  await waitFor("document.querySelector('[data-chart-status]').textContent === 'This chart has no embedded workbook; only its cached data is updated'", '无工作簿英文说明');
  if (!await evaluate(`document.querySelector('[data-chart-grid="scatter"] input').getAttribute('aria-label') === 'X — A 组, point 1'
    && document.querySelector('[data-chart-grid="scatter"] button').getAttribute('aria-label') === 'Remove point — A 组, point 1'`)) throw new Error('散点字段与删除按钮缺少英文上下文');
  await click('#slideList [data-slide-id]:nth-child(7)');
  await selectPaneObject(context, '图表');
  await waitFor(`!!document.querySelector('[data-chart-grid="bubble"]')`, '气泡数据表');
  const size = '[data-chart-grid="bubble"] tbody tr:first-child td:nth-child(3) input';
  if (!await evaluate(`document.querySelector('[data-chart-grid="bubble"] th:nth-child(3)').textContent === 'Size'
    && document.querySelector(${JSON.stringify(size)}).getAttribute('aria-label') === 'Size — 直营, point 1'`)) throw new Error('气泡大小表头或名称未翻译');
  await changeValue(context, size, '625');
  await waitFor("document.querySelector('#statusText').textContent === 'Chart data updated'", '气泡真实修改');
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.querySelector(${JSON.stringify(size)}).value === '625'
    && document.querySelector(${JSON.stringify(size)}).getAttribute('aria-label') === '大小 — 直营，第 1 个数据点'`)) throw new Error('气泡切中文丢失值或名称上下文');
  await click('[data-site-locale="en"]');
  await evaluate("[...document.querySelectorAll('#chartInspector button')].find((node) => node.textContent === 'Add point').click()");
  await waitFor(`document.querySelectorAll('[data-chart-grid="bubble"]')[0].tBodies[0].rows.length === 5`, '英文新增气泡数据点');
  await click('[data-chart-grid="bubble"] tbody tr:last-child button');
  await waitFor(`document.querySelectorAll('[data-chart-grid="bubble"]')[0].tBodies[0].rows.length === 4`, '英文删除气泡数据点');
  await click('#slideList [data-slide-id]:nth-child(8)');
  await selectPaneObject(context, '图表');
  await waitFor("[...document.querySelectorAll('#chartInspector button')].some((node) => node.textContent === 'Add bar series') && [...document.querySelectorAll('#chartInspector button')].some((node) => node.textContent === 'Add line series')", '组合图按图种区分新增操作');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("[...document.querySelectorAll('#chartInspector button')].some((node) => node.textContent === '增加折线系列')", '组合图嵌套词条切中文');
}

async function runCategoryEdits(context) {
  const { evaluate, click, waitFor } = context;
  const series = '[data-chart-grid="category"] thead input';
  const category = '[data-chart-grid="category"] tbody input';
  const number = '[data-chart-grid="category"] tbody input[type="number"]';
  await changeValue(context, series, '<复制 & 系列>');
  await waitFor("document.querySelector('#statusText').textContent === 'Chart data updated'", '图表修改英文成功提示');
  await changeValue(context, category, '复制');
  await waitFor(`document.querySelector(${JSON.stringify(category)}).getAttribute('aria-label') === 'Category name: 复制'`, '修改类别后名称包含原文');
  await changeValue(context, number, '321.5');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '图表数据已更新'", '成功状态切中文');
  if (!await evaluate(`document.querySelector(${JSON.stringify(series)}).value === '<复制 & 系列>'
    && document.querySelector(${JSON.stringify(number)}).value === '321.5'
    && document.querySelector(${JSON.stringify(category)}).value === '复制'`)) throw new Error('界面语言改写了图表编辑值');
  await click('#undo');
  await waitFor(`document.querySelector(${JSON.stringify(number)}).value === '1280'`, '图表语言切换后撤销');
  await click('#redo');
  await waitFor(`document.querySelector(${JSON.stringify(number)}).value === '321.5'`, '图表语言切换后重做');
  await click('[data-site-locale="en"]');
  await changeValue(context, series, '\u0000');
  await waitFor("document.querySelector('#statusText').textContent === 'Could not update chart data: 系列名称无效'", '非法 XML 字符由真实引擎拒绝并保留诊断');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '无法更新图表数据：系列名称无效'", '图表失败摘要切中文');
  await click('#undo');
  await waitFor(`document.querySelector(${JSON.stringify(number)}).value === '1280'
    && document.querySelector(${JSON.stringify(series)}).value === '<复制 & 系列>'`, '无效输入不增加历史或改变真实系列');
  await click('#redo');
  await waitFor(`document.querySelector(${JSON.stringify(number)}).value === '321.5'`, '失败后仍能重做');
  await click('[data-site-locale="en"]');
  await evaluate("[...document.querySelectorAll('#chartInspector button')].find((node) => node.textContent === 'Add category').click()");
  await waitFor("[...document.querySelectorAll('[data-chart-grid] tbody tr')].at(-1).querySelector('input').value === 'New category'", '默认类别在创建时选择英文');
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate("[...document.querySelectorAll('[data-chart-grid] tbody tr')].at(-1).querySelector('input').value === 'New category'")) throw new Error('已创建的类别被追溯翻译');
  await evaluate("[...document.querySelectorAll('#chartInspector button')].find((node) => node.textContent === '增加系列').click()");
  await waitFor("[...document.querySelectorAll('[data-chart-grid] thead input')].at(-1).value === '新系列'", '中文创建默认系列');
  await click('[data-site-locale="en"]');
  await evaluate(`(() => {
    globalThis.__chartDownloadClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) globalThis.__capturedDownload = { name: this.download, href: this.href };
      else globalThis.__chartDownloadClick.call(this);
    };
  })()`);
  try { await saveAndReopen(context, 'chart-language-saved.pptx'); }
  finally { await evaluate('HTMLAnchorElement.prototype.click = globalThis.__chartDownloadClick'); }
  await selectPaneObject(context, '图表');
  await waitFor(`!document.querySelector('#chartInspector').hidden && document.querySelector(${JSON.stringify(series)})?.value === '<复制 & 系列>'`, '保存重开保留原始系列');
  if (!await evaluate(`document.querySelector(${JSON.stringify(category)}).value === '复制'
    && document.querySelector(${JSON.stringify(number)}).value === '321.5'
    && [...document.querySelectorAll('[data-chart-grid] thead input')].at(-1).value === '新系列'
    && [...document.querySelectorAll('[data-chart-grid] tbody tr')].at(-1).querySelector('input').value === 'New category'`)) throw new Error('双语编辑保存重开丢失数据或改写了创建时的默认名称');
}
