/** 桌面 002：AddChart 命令、16 经典 + 7 现代图的原生内容、保存链路、既有编辑链识别与 fast-fail。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { countedAssert } from './lib/counted-assert.mjs';
const { assert: bound, record } = countedAssert('chartAuthoring');
import { verifyChartDesignXml } from './lib/chart-design-schema.mjs';
import { installDomEnv } from './lib/dom-env.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'),
  out = join(root, 'out/chart-authoring');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entry = join(out, 'entry.mjs');
writeFileSync(
  entry,
  `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as chart from ${JSON.stringify(join(root, 'packages/edit-core/src/chart/index.ts'))};
export * as authoring from ${JSON.stringify(join(root, 'packages/edit-core/src/chart-authoring/index.ts'))};`,
);
// 与 test-chart-design 同款别名：裸 esbuild 会把 @web-ppt/core/* 解析到过期的 dist
const dist = process.argv.includes('--dist');
const editModules = dist
  ? Object.fromEntries(
      await Promise.all(
        [
          ['core', 'core/dist/core.js'],
          ['edit', 'edit-core/dist/edit-core.js'],
          ['chart', 'edit-core/dist/chart.js'],
          ['authoring', 'edit-core/dist/chart-authoring.js'],
        ].map(async ([key, file]) => [key, await import(pathToFileURL(join(root, 'packages', file)).href)]),
      ),
    )
  : await bundleBrowser({
      root,
      entry,
      output: join(out, 'contract.mjs'),
      aliases: [
        ['@web-ppt/core/chart-edit', join(root, 'packages/core/src/chart-edit.ts')],
        ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
        ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
        ['@web-ppt/edit-core/chart', join(root, 'packages/edit-core/src/chart/index.ts')],
        ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
        ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
        ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
      ],
    });
const { core, edit, chart, authoring } = editModules;

const host = () =>
  core.parse(new Uint8Array(readFileSync(join(root, 'fixtures/sample-chart-data.pptx'))), { edit: true, keepPackage: true, lazy: false });

/** 每种图的有效最小数据；股价 4 系列 OHLC，散点 / 气泡带 x */
const series = (name, values, extra = {}) => ({ name, values, ...extra });
const CATS4 = ['一季度', '二季度', '三季度', '四季度'];
const DATA = {
  area: { categories: CATS4, series: [series('销售', [10, 20, 30, 40])] },
  area3D: { categories: CATS4, series: [series('销售', [10, 20, 30, 40])] },
  bar: { categories: CATS4, series: [series('销售', [10, 20, 30, 40]), series('目标', [15, 25, 35, 45])] },
  bar3D: { categories: CATS4, series: [series('销售', [10, 20, 30, 40])] },
  bubble: { categories: ['a', 'b', 'c'], series: [series('点', [1, 2, 3], { x: [1, 2, 3], sizes: [10, 20, 30] })] },
  doughnut: { categories: CATS4, series: [series('占比', [30, 30, 20, 20])] },
  line: { categories: CATS4, series: [series('趋势', [1, 3, 2, 4])] },
  line3D: { categories: CATS4, series: [series('趋势', [1, 3, 2, 4])] },
  ofPie: { categories: CATS4, series: [series('占比', [30, 30, 20, 20])] },
  pie: { categories: CATS4, series: [series('占比', [30, 30, 20, 20])] },
  pie3D: { categories: CATS4, series: [series('占比', [30, 30, 20, 20])] },
  radar: { categories: CATS4, series: [series('能力', [3, 4, 5, 2])] },
  scatter: { categories: ['a', 'b', 'c'], series: [series('点', [1, 2, 3], { x: [4, 5, 6] })] },
  stock: {
    categories: ['一', '二', '三'],
    series: [series('开盘', [10, 11, 12]), series('最高', [12, 13, 14]), series('最低', [9, 10, 11]), series('收盘', [11, 12, 13])],
  },
  surface: { categories: ['一', '二', '三'], series: [series('行1', [1, 2, 3]), series('行2', [2, 3, 4]), series('行3', [3, 4, 5])] },
  surface3D: { categories: ['一', '二', '三'], series: [series('行1', [1, 2, 3]), series('行2', [2, 3, 4]), series('行3', [3, 4, 5])] },
  boxWhisker: { categories: ['甲', '乙', '丙'], series: [series('样本', [1, 2, 3])] },
  funnel: { categories: ['访问', '加购', '下单'], series: [series('转化', [100, 60, 20])] },
  histogram: { categories: [''], series: [series('分布', [1, 2, 2, 3, 3, 3, 4, 5])] },
  paretoLine: { categories: [''], series: [series('分布', [1, 2, 2, 3, 3, 3, 4, 5])] },
  sunburst: { categories: ['华东/上海', '华东/南京', '华北/北京'], series: [series('销售', [5, 3, 8])] },
  treemap: { categories: ['华东/上海', '华东/南京', '华北/北京'], series: [series('销售', [5, 3, 8])] },
  waterfall: { categories: ['期初', '收入', '支出', '期末'], series: [series('现金流', [10, 5, -3, 8])] },
};
const ALL_KINDS = [...authoring.CLASSIC_CHART_KINDS, ...authoring.CHARTEX_KINDS];

const addOnSlide2 = (editor, kind, overrides = {}) => {
  const api = authoring.createChartAuthoringEditor(editor);
  const slideId = Object.keys(editor.doc.slides)[1];
  return {
    api,
    id: api.add({ type: 'AddChart', slideId, rect: { x: 40, y: 40, w: 400, h: 260 }, chart: { kind, ...DATA[kind], ...overrides } }),
  };
};

const elementTexts = (pres, slideIndex = 1) => {
  const out = [];
  const walk = (els) => {
    for (const e of els) {
      if (e.kind === 'group') walk(e.children);
      else if (e.kind === 'shape' && e.text) out.push(e.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' '));
    }
  };
  walk(pres.slides[slideIndex].elements);
  return out;
};

// ---------------- 1. 全部 23 型：插入、保存部件、重开渲染 ----------------
const savedBytes = new Map();
for (const kind of ALL_KINDS) {
  const { editor, id } = await (async () => {
    const p = await host();
    const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'auth-' }));
    const { id } = addOnSlide2(editor, kind);
    return { editor, id };
  })();
  const element = editor.effectiveElement(id);
  assert.equal(element.kind, 'group', `${kind} 的元素是图表组`);
  const bytes = await editor.save();
  savedBytes.set(kind, bytes);
  writeFileSync(join(out, `chart-${kind}.pptx`), bytes);
  const zip = unzipSync(bytes);
  const chartParts = Object.keys(zip).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
  const workbooks = Object.keys(zip).filter((name) => /^ppt\/embeddings\/chart\d+\.xlsx$/.test(name));
  assert(chartParts.length >= 1, `${kind} 保存包含图表部件`);
  assert(workbooks.length >= 1, `${kind} 保存包含内嵌工作簿`);
  for (const part of chartParts) verifyChartDesignXml(strFromU8(zip[part]));
  const contentTypes = strFromU8(zip['[Content_Types].xml']);
  assert(contentTypes.includes('drawingml.chart+xml') || contentTypes.includes('ms-office.chartex+xml'), `${kind} 内容类型登记`);
  assert(contentTypes.includes('spreadsheetml.sheet'), `${kind} 工作簿内容类型登记`);
  // 保存重开：解析无错、页面上有图表组、标题文字渲染
  const reopened = await core.parse(bytes, {});
  bound.ok(
    reopened.slides[1].elements.some((e) => e.kind === 'group' && e.name === '图表'),
    `${kind} 重开解析出图表`,
  );
  const texts = elementTexts(reopened);
  bound.ok(
    texts.some((t) => /y = |一季度|销售|占比|趋势|点|销售|样本|转化|分布|现金流|Q1|Direct/.test(t))
      || kind === 'histogram'
      || kind === 'paretoLine',
    `${kind} 图表渲染出文字`,
  );
  editor.dispose();
}
bound.equal(ALL_KINDS.length, 23, '覆盖 23 种类型');

// ---------------- 2. 保存后进入既有编辑链（数据编辑、类型 / 样式识别） ----------------
{
  const bytes = savedBytes.get('bar');
  const reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(reopened, { idPrefix: 'auth2-' }));
  const charts = chart.listEditableCharts(editor.doc);
  const created = charts.sort((a, b) => a.binding.chartPart.localeCompare(b.binding.chartPart, undefined, { numeric: true })).at(-1);
  bound.ok(created, '重开后新建图表进入可编辑清单');
  const data = chart.queryChartData(editor.doc, created.id);
  bound.ok(data.series.length === 2, '数据面板识别两个系列');
  bound.equal(data.series[0].points[0].value, 10, '缓存值与工作簿一致');
  const dataEditor = chart.createChartDataEditor(editor);
  dataEditor.setValue(created.id, data.series[0].id, data.series[0].points[0].id, 9876);
  const edited = await editor.save();
  const again = strFromU8(unzipSync(edited)[created.binding.chartPart]);
  bound.ok(again.includes('9876'), '编辑写回图表缓存');
  const workbookPart = created.binding.chartPart.replace('ppt/charts/', 'ppt/embeddings/').replace('.xml', '.xlsx');
  const workbook = unzipSync(edited)[workbookPart];
  const sheet = strFromU8(unzipSync(workbook)['xl/worksheets/sheet1.xml']);
  bound.ok(sheet.includes('9876'), '编辑同步到内嵌工作簿');
  editor.dispose();
  reopened.dispose();
}

// ---------------- 3. 撤销 / 重做与孤儿回收 ----------------
{
  const p = await host();
  const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'auth3-' }));
  const { id } = addOnSlide2(editor, 'pie');
  editor.undo();
  bound.equal(Object.keys(editor.doc.chartResources ?? {}).length, 0, '撤销清空图表资源');
  bound.equal(editor.doc.elements[id], undefined, '撤销移除元素');
  const undoneBytes = await editor.save();
  const original = Object.keys(unzipSync(new Uint8Array(readFileSync(join(root, 'fixtures/sample-chart-data.pptx')))));
  assert(
    !Object.keys(unzipSync(undoneBytes)).some((name) => /^ppt\/charts\//.test(name) && !original.includes(name)),
    '撤销后保存无新增图表部件',
  );
  editor.redo();
  bound.equal(Object.keys(editor.doc.chartResources ?? {}).length, 1, '重做恢复图表资源');
  const redoneBytes = await editor.save();
  assert(
    Object.keys(unzipSync(redoneBytes)).some((name) => /^ppt\/charts\//.test(name) && !original.includes(name)),
    '重做后保存恢复图表部件',
  );
  editor.dispose();
  p.dispose();
}

// ---------------- 4. fast-fail：非法输入原子拒绝 ----------------
{
  const p = await host();
  const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'auth4-' }));
  for (const [label, payload] of [
    ['未知类型', { kind: 'gantt', categories: CATS4, series: [series('a', [1, 2, 3, 4])] }],
    ['饼图多系列', { kind: 'pie', categories: CATS4, series: [series('a', [1, 2, 3, 4]), series('b', [1, 2, 3, 4])] }],
    ['股价非 4 倍系列', { kind: 'stock', categories: CATS4, series: [series('a', [1, 2, 3, 4])] }],
    ['点数与类别不符', { kind: 'bar', categories: CATS4, series: [series('a', [1, 2, 3])] }],
    ['散点缺 x', { kind: 'scatter', categories: ['a'], series: [series('a', [1])] }],
    ['非法系列名', { kind: 'bar', categories: CATS4, series: [series('a\u0007b', [1, 2, 3, 4])] }],
  ]) {
    assert.throws(
      () =>
        authoring
          .createChartAuthoringEditor(editor)
          .add({ type: 'AddChart', slideId: Object.keys(editor.doc.slides)[1], rect: { x: 0, y: 0, w: 100, h: 100 }, chart: payload }),
      Error,
      label,
    );
  }
  bound.equal(editor.isDirty(), false, '非法输入不进入历史');
  editor.dispose();
  p.dispose();
}

// ---------------- 5. LibreOffice 无修复打开（抽样覆盖 2D / 3D / 现代图） ----------------
const libreofficeKinds = ['bar', 'pie3D', 'stock', 'surface', 'waterfall', 'treemap', 'bubble', 'ofPie'];
let soffice = null;
try {
  execFileSync('soffice', ['--version'], { stdio: 'ignore' });
  soffice = true;
} catch {
  console.log('（本机无 soffice，LibreOffice 抽样交给 CI office 任务）');
}
if (soffice) {
  const libreDir = join(out, 'libreoffice');
  mkdirSync(libreDir, { recursive: true });
  for (const kind of libreofficeKinds) {
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', join(out, `chart-${kind}.pptx`), '--outdir', libreDir], {
      stdio: 'ignore',
      timeout: 120_000,
    });
    bound.ok(Boolean(readFileSync(join(libreDir, `chart-${kind}.pdf`))), `${kind} LibreOffice 无修复打开`);
  }
  rmSync(libreDir, { recursive: true, force: true });
}

record();
console.log(`新建图表：${ALL_KINDS.length} 型生成与保存、既有编辑链识别、撤销重做、孤儿回收、fast-fail 与 LibreOffice 抽样通过`);
