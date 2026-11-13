/** 桌面 003：趋势线 / 误差线 / 数据表的解析、六种拟合、两条文本路径与 chart-design 编辑闭环。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { countedAssert } from './lib/counted-assert.mjs';
const { assert, record } = countedAssert('chartAnalysis');
import { verifyChartDesignXml } from './lib/chart-design-schema.mjs';
import { installDomEnv } from './lib/dom-env.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'),
  out = join(root, 'out/chart-analysis');
mkdirSync(out, { recursive: true });

// ---------------- 源码 bundle（与 test-core 同路径，core 全量） ----------------
const dist = process.argv.includes('--dist');
const bundle = join(out, 'src-bundle.mjs');
if (dist) {
  installDomEnv();
} else {
  execFileSync(
    'npx',
    [
      'esbuild',
      join(root, 'packages/core/src/index.ts'),
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--log-level=error',
      `--outfile=${bundle}`,
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
installDomEnv();
const lib = dist ? await import(pathToFileURL(join(root, 'packages/core/dist/core.js')).href) : await import(pathToFileURL(bundle).href);

// ---------------- 编辑面 bundle（chart-design 扩展，模式同 test-chart-design） ----------------
// bundleBrowser 带源码别名：裸 esbuild 会把 @web-ppt/core/* 解析到过期的 dist，
// 投影里的 renderChartXml 会用旧图表代码渲染（趋势线静默丢失）。
const editEntry = join(out, 'entry.mjs');
writeFileSync(
  editEntry,
  `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as chart from ${JSON.stringify(join(root, 'packages/edit-core/src/chart/index.ts'))};
export * as design from ${JSON.stringify(join(root, 'packages/edit-core/src/chart-design/index.ts'))};`,
);
const editModules = dist
  ? Object.fromEntries(
      await Promise.all(
        [
          ['core', 'core/dist/core.js'],
          ['edit', 'edit-core/dist/edit-core.js'],
          ['chart', 'edit-core/dist/chart.js'],
          ['design', 'edit-core/dist/chart-design.js'],
        ].map(async ([key, file]) => [key, await import(pathToFileURL(join(root, 'packages', file)).href)]),
      ),
    )
  : await bundleBrowser({
      root,
      entry: editEntry,
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
const { core, edit, chart, design } = editModules;

// ---------------- 1. 六种拟合与标签（渲染产物即拟合断言） ----------------
const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-chart-analysis.pptx')));
const pres = await lib.parse(bytes, {});

{
  const textsOf = (slide) => {
    const out = [];
    const walk = (els) => {
      for (const e of els) {
        if (e.kind === 'group') walk(e.children);
        else if (e.kind === 'shape' && e.text) out.push(e.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' '));
      }
    };
    walk(slide.elements);
    return out;
  };
  const all = pres.slides.flatMap(textsOf);
  // 六种拟合的确定性方程（系数由固件数据唯一决定）
  assert.equal(all.filter((t) => t === 'y = 1,272ln(x) + 555').length, 1, '对数拟合');
  assert.equal(all.filter((t) => t === 'y = 0.46764x^0.124341').length, 1, '幂拟合（百分比堆叠按占比）');
  assert.equal(all.filter((t) => t === 'y = 24x + 98').length, 1, '线性拟合');
  assert.equal(all.filter((t) => t === 'y = −0.03x^2 + 0.69x + 0.77').length, 1, '多项式拟合（散点实际 x）');
  assert.equal(all.filter((t) => t === 'y = 21.178973e^0.094937x').length, 1, '指数拟合');
  assert.ok(all.filter((t) => /^R² = 0?\./.test(t) || t === 'R² = 1').length >= 3, 'R² 标签');
  // 图例自动命名（c:name 缺省 → 类型 (系列名)）
  for (const name of ['对数 (2024 年)', 'Power', '线性 (新增用户)', '移动平均 (新增用户)', '多项式 (A 组)', '指数 (CPU)'])
    assert.ok(all.includes(name), `图例条目 ${name}`);
  // 移动平均不提供公式与 R²（PowerPoint 同口径）
  assert.ok(!all.some((t) => t.includes('移动平均') && t.startsWith('y =')), '移动平均无公式');
  // 数据表：表头行 + 各系列行
  assert.ok(all.includes('1月'), '数据表首行类目');
}

// ---------------- 2. 两条文本路径 ----------------
{
  const slide = pres.slides[2]; // chart4：线性 + 移动平均
  const svgText = lib.renderSlideToSvg(pres, slide, { textMode: 'svg' });
  const htmlText = lib.renderSlideToSvg(pres, slide, { textMode: 'html' });
  for (const [label, svg] of [
    ['原生 <text> 路径', svgText],
    ['foreignObject 路径', htmlText],
  ]) {
    assert.ok(svg.includes('y = 24x + 98'), `${label}含公式`);
    assert.ok(svg.includes('线性 (新增用户)'), `${label}含图例名`);
  }
  assert.ok(!svgText.includes('<foreignObject'), '原生路径不用 foreignObject');
  assert.ok(htmlText.includes('<foreignObject'), 'html 路径用 foreignObject');
}

// ---------------- 3. chart-design 编辑闭环 ----------------
const makeEditor = async () => {
  const p = await core.parse(new Uint8Array(readFileSync(join(root, 'fixtures/sample-chart-data.pptx'))), {
    edit: true,
    keepPackage: true,
    lazy: false,
  });
  const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'analysis-' }));
  const id = chart.listEditableCharts(editor.doc).find((c) => c.binding.chartPart === 'ppt/charts/chart1.xml').id;
  return { p, editor, api: design.createChartDesignEditor(editor), id };
};

{
  const { p, editor, api, id } = await makeEditor();
  const before = JSON.stringify(editor.effectiveElement(id).children);

  // 写入趋势线 + 误差线 + 数据表
  api.set(id, {
    trendlines: [{ series: 0, type: 'poly', order: 2, forward: 0.5, equation: true, rSquare: true, color: '#D32F2F', name: '二次拟合' }],
    errorBars: [{ series: 0, valueType: 'fixedVal', value: 40, amount: 'both', color: '#1565C0' }],
    dataTable: { horizontalBorders: true, verticalBorders: true, outline: true, keys: true },
  });
  const projected = editor.effectiveElement(id).children;
  const flat = [];
  const walk = (els) => {
    for (const e of els) {
      if (e.kind === 'group') walk(e.children);
      else if (e.kind === 'shape' && e.text) flat.push(e.text.paragraphs.map((r) => r.runs.map((x) => x.text).join('')).join(' '));
    }
  };
  walk(projected);
  assert.ok(
    flat.some((t) => t.startsWith('y = ')),
    '投影出现趋势线公式',
  );
  assert.ok(flat.includes('二次拟合'), '显式图例名生效');
  assert.ok(
    flat.some((t) => /^(第一季度|2024 年)/.test(t)),
    '投影出现数据表表头',
  );

  // 序列合法性（含 ser/trendline/errBars/dTable 扩展）
  const saved = await editor.save();
  const xml = strFromU8(unzipSync(saved)['ppt/charts/chart1.xml']);
  verifyChartDesignXml(xml);
  // 序列化器输出展开形态（<c:x val="y"></c:x>），断言不假设自闭合
  assert.ok(xml.includes('<c:trendlineType val="poly">'), '写出 trendlineType');
  assert.ok(xml.includes('<c:errBarType val="both">'), '写出 errBarType');
  assert.ok(xml.includes('<c:dTable'), '写出 dTable');
  writeFileSync(join(out, 'analysis-designed.pptx'), saved);

  // 保存重开：解析产物仍含公式与数据表
  const reopened = await core.parse(saved, {});
  const reopenTexts = [];
  const walk2 = (els) => {
    for (const e of els) {
      if (e.kind === 'group') walk2(e.children);
      else if (e.kind === 'shape' && e.text) reopenTexts.push(e.text.paragraphs.map((r) => r.runs.map((x) => x.text).join('')).join(' '));
    }
  };
  for (const s of reopened.slides) walk2(s.elements);
  assert.ok(
    reopenTexts.some((t) => t.startsWith('y = ')),
    '重开仍渲染趋势线',
  );
  assert.ok(reopenTexts.includes('第一季度'), '重开仍渲染数据表');

  // 幂等保存
  assert.deepEqual(await editor.save(), saved, '重复保存稳定');

  // 撤销回到原状，重做恢复
  editor.undo();
  editor.undo();
  editor.undo();
  assert.equal(JSON.stringify(editor.effectiveElement(id).children), before, '三次撤销恢复投影');
  editor.redo();
  editor.redo();
  editor.redo();
  assert.ok(flat.length > 0 && JSON.stringify(editor.effectiveElement(id).children) !== before, '三次重做恢复设计');

  // 空数组 / null = 移除（undefined = 保持）
  api.set(id, { trendlines: [], errorBars: [], dataTable: null });
  const cleared = strFromU8(unzipSync(await editor.save())['ppt/charts/chart1.xml']);
  verifyChartDesignXml(cleared);
  assert.ok(!cleared.includes('<c:trendline'), '移除趋势线');
  assert.ok(!cleared.includes('<c:errBars'), '移除误差线');
  assert.ok(!cleared.includes('<c:dTable'), '移除数据表');

  // fast-fail：非法输入原子拒绝
  for (const [label, bad] of [
    ['poly 阶数越界', { trendlines: [{ type: 'poly', order: 7 }] }],
    ['周期过小', { trendlines: [{ type: 'movingAvg', period: 1 }] }],
    ['非法类型', { trendlines: [{ type: 'cubic' }] }],
    ['负值量', { errorBars: [{ valueType: 'fixedVal', value: -1 }] }],
    ['cust 数组含非数值', { errorBars: [{ valueType: 'cust', plus: ['x'] }] }],
    ['未知字段', { dataTable: { keys: 1 } }],
    ['非法颜色', { trendlines: [{ type: 'linear', color: 'red' }] }],
  ]) {
    assert.throws(() => api.set(id, bad), Error, label);
  }
  assert.ok(api.query(id).trendlines === undefined || api.query(id).trendlines.length === 0, '非法输入不污染状态');

  editor.dispose();
  p.dispose();
}

record();
console.log('图表分析元素：六种拟合、图例、两条文本路径、编辑写入、序列校验、保存重开、历史与拒绝通过');
