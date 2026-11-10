import packageAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import Ajv from 'ajv';
import { sourceAliasArgs } from './lib/bundle-browser.mjs';
import { countedAssert } from './lib/counted-assert.mjs';
import { createTemplateFillOutline, TEMPLATE_FILL_GEOMETRY_CHECKS } from './lib/template-fill-cases.mjs';
import { createTemplateFillMeasurement, verifyTemplateFillFonts } from './lib/template-fill-measurement.mjs';
import { inspectTemplateFillChartParts, inspectTemplateFillSlideNumbers } from './lib/template-fill-chart-parts.mjs';
import { runTemplateFillRegressions } from './lib/template-fill-regressions.mjs';
import { inspectTemplateFillNotes, inspectTemplateFillWithoutNotes, runTemplateFillNotesReuse } from './lib/template-fill-notes-parts.mjs';
import { runTemplateFillPackageContract } from './lib/template-fill-package-contract.mjs';

const root = resolve(import.meta.dirname, '..'),
  out = join(root, 'out/template-fill');
mkdirSync(out, { recursive: true });
const dist = process.argv.includes('--dist');
const { assert, record } = countedAssert('templateFill');
const modules = {
  core: ['@web-ppt/core', 'packages/core/src/index.ts'],
  edit: ['@web-ppt/edit-core', 'packages/edit-core/src/index.ts'],
  describe: ['@web-ppt/edit-core/describe', 'packages/edit-core/src/describe/index.ts'],
  templates: ['@web-ppt/edit-core/templates', 'packages/edit-core/src/templates/index.ts'],
  chart: ['@web-ppt/edit-core/chart', 'packages/edit-core/src/chart/index.ts'],
  fill: ['@web-ppt/edit-core/fill', 'packages/edit-core/src/fill/index.ts'],
};
const entry = join(out, dist ? 'dist-entry.mjs' : 'entry.mjs');
const runtime = join(out, dist ? 'runtime-dist.mjs' : 'runtime.mjs');
const metadata = join(out, dist ? 'dist-meta.json' : 'meta.json');
writeFileSync(
  entry,
  Object.entries(modules)
    .map(([name, [publicName, source]]) => `export * as ${name} from ${JSON.stringify(dist ? publicName : join(root, source))};`)
    .join('\n'),
);
execFileSync(
  'npx',
  [
    'esbuild',
    entry,
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--log-level=error',
    ...(dist ? [`--tsconfig=${join(root, 'tooling/tsconfig.template-fill-dist.json')}`] : sourceAliasArgs(root)),
    `--metafile=${metadata}`,
    `--outfile=${runtime}`,
  ],
  { cwd: root, stdio: 'inherit' },
);
if (dist)
  for (const input of Object.keys(JSON.parse(readFileSync(metadata, 'utf8')).inputs)) {
    packageAssert(!/(?:^|\/)packages\/[^/]+\/src\//.test(input), `发布入口复验不能混入源码：${input}`);
  }
const api = await import(pathToFileURL(runtime).href);
assert.equal(typeof api.fill.fillTemplate, 'function');
assert.equal(typeof api.fill.TemplateFillError, 'function');
const schema = JSON.parse(readFileSync(join(root, 'packages/edit-core/schemas/template-fill.schema.json'), 'utf8'));
assert.deepEqual(api.fill.templateFillSchema, schema);
const validate = new Ajv({ strict: true }).compile(schema);
const template = new Uint8Array(readFileSync(join(root, 'fixtures/sample-template-fill.pptx')));
const replacement = new Uint8Array(readFileSync(join(root, 'fixtures/agent-mcp-replacement.png')));
const outline = createTemplateFillOutline(Buffer.from(replacement).toString('base64'));
const original = new Uint8Array(template),
  originalOutline = structuredClone(outline);
const options = {
  idPrefix: 'fill-contract-',
  lint: { checks: TEMPLATE_FILL_GEOMETRY_CHECKS, measureText: createTemplateFillMeasurement(root) },
};
verifyTemplateFillFonts(root, assert);
const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join('');
for (const b of [false, true]) {
  assert(
    options.lint.measureText(`${printable}•`, { fonts: ['WebPPT Template Fill Latin'], size: 16, b, i: false }, 1) > 0,
    '真实字体必须覆盖全部 printable ASCII 和项目符号，不能回退到缺字方框',
  );
}
assert(validate(outline), JSON.stringify(validate.errors));

const result = await api.fill.fillTemplate(template, outline, options);
assert(result.bytes instanceof Uint8Array && result.bytes.length > 0);
assert.deepEqual(template, original, '填充不能改变调用方的模板字节');
assert.deepEqual(outline, originalOutline, '填充不能改变调用方的大纲对象');
assert.equal(result.description.totalSlides, outline.slides.length);
assert.deepEqual(result.lint.issues, [], '干净模板的适用检查必须零问题');
assert(Array.isArray(result.bindings) && result.bindings.length >= outline.slides.length);
assert(
  result.description.slides.every((slide) => slide.layout?.id && slide.master?.id),
  '每页保留真实模板版式与母版关系',
);
assert.equal(result.description.slides[0].notes, 'Speaker notes');
const texts = result.description.slides.flatMap((slide) => slide.elements.flatMap((element) => element.paragraphs.map((p) => p.text)));
for (const text of ['Template acceptance', 'Revenue grows', 'Previous period', 'Current period', 'Native image caption']) {
  assert(texts.includes(text), `生成内容必须含 ${text}`);
}
assert(!texts.some((text) => text.includes('Original Example') || text.includes('Replace this original')), '原始示例页必须被新大纲替换');
const beforeParts = unzipSync(template),
  afterParts = unzipSync(result.bytes);
for (const part of ['ppt/theme/theme1.xml', 'ppt/slideMasters/slideMaster1.xml', 'customXml/template-fill.xml']) {
  assert.deepEqual(afterParts[part], beforeParts[part], `${part} 必须保留原始字节`);
}
assert(
  Object.entries(afterParts).some(([name, bytes]) => name.startsWith('ppt/media/') && Buffer.from(bytes).equals(Buffer.from(replacement))),
  '生成包必须保留调用方图片的完整字节',
);
const chartParts = inspectTemplateFillChartParts(afterParts, assert);
const notesParts = inspectTemplateFillNotes(afterParts, assert);
writeFileSync(join(out, 'fixture-filled.pptx'), result.bytes);
writeFileSync(join(out, 'fixture-outline.json'), `${JSON.stringify(outline, null, 2)}\n`);
writeFileSync(join(out, 'fixture-description.json'), `${JSON.stringify(result.description, null, 2)}\n`);
writeFileSync(join(out, 'fixture-chart-parts.json'), `${JSON.stringify(chartParts, null, 2)}\n`);
writeFileSync(join(out, 'fixture-notes-parts.json'), `${JSON.stringify(notesParts, null, 2)}\n`);

const reopenedPresentation = await api.core.parse(result.bytes, { edit: true, keepPackage: true, lazy: false });
const reopened = api.edit.createDoc(reopenedPresentation, { idPrefix: options.idPrefix });
try {
  assert.deepEqual(api.describe.describePresentation(reopened), result.description, '返回 describe 必须与最终字节真实重开逐字段一致');
  const charts = api.chart.listEditableCharts(reopened);
  assert.equal(charts.length, 1);
  const data = api.chart.queryChartData(reopened, charts[0].id);
  assert.deepEqual(
    data.categories.map((category) => category.label),
    ['North', 'South'],
  );
  assert.deepEqual(
    data.series.map((series) => ({ name: series.name, values: series.points.map((point) => point.value) })),
    [
      { name: 'Actual', values: [4, 7] },
      { name: 'Budget', values: [3, 5] },
    ],
  );
} finally {
  api.edit.disposeDoc(reopened);
}

for (const type of ['line', 'pie', 'doughnut', 'area', 'scatter', 'radar', 'bubble']) {
  const xy = type === 'scatter' || type === 'bubble';
  const series = { name: 'Actual', values: [4, 7], ...(xy ? { x: [1, 2] } : {}), ...(type === 'bubble' ? { sizes: [10, 20] } : {}) };
  const generated = await api.fill.fillTemplate(
    template,
    {
      version: 1,
      slides: [{ type: 'chart', title: `Native ${type}`, chart: { type, categories: xy ? [] : ['North', 'South'], series: [series] } }],
    },
    options,
  );
  assert.deepEqual(generated.lint.issues, []);
  inspectTemplateFillChartParts(unzipSync(generated.bytes), assert, { series: 1, categories: xy ? 0 : 1 });
  if (type === 'line') inspectTemplateFillWithoutNotes(unzipSync(generated.bytes), assert);
  const presentation = await api.core.parse(generated.bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = api.edit.createDoc(presentation, { idPrefix: options.idPrefix });
  try {
    const charts = api.chart.listEditableCharts(doc);
    assert.equal(charts.length, 1);
    const data = api.chart.queryChartData(doc, charts[0].id);
    assert.equal(data.kind, xy ? 'xy' : 'category');
    assert.equal(data.series[0].plotKind, type);
    assert.deepEqual(
      data.series[0].points.map((point) => point.value),
      [4, 7],
    );
    if (xy)
      assert.deepEqual(
        data.series[0].points.map((point) => point.x),
        [1, 2],
      );
    if (type === 'bubble')
      assert.deepEqual(
        data.series[0].points.map((point) => point.size),
        [10, 20],
      );
  } finally {
    api.edit.disposeDoc(doc);
  }
  writeFileSync(join(out, `chart-${type}.pptx`), generated.bytes);
}

for (const [invalid, reason] of [
  [{ version: 1, slides: [{ type: 'unknown', title: 'Invalid' }] }, 'invalid-outline'],
  [{ version: 1, slides: [{ type: 'image', title: 'Invalid' }] }, 'invalid-outline'],
  [{ version: 1, slides: [{ type: 'image', title: 'Invalid', image: { bytes: 'not base64!', mime: 'image/png' } }] }, 'invalid-image'],
  [
    { version: 1, slides: [{ type: 'content', title: 'Invalid', body: [{ text: 'Body' }], layoutId: 'missing-layout' }] },
    'layout-not-found',
  ],
  [
    {
      version: 1,
      slides: [{ type: 'content', title: 'Invalid', body: [{ text: 'Body' }], layoutId: 'ppt/slideLayouts/slideLayout1.xml' }],
    },
    'layout-role-mismatch',
  ],
  [
    {
      version: 1,
      slides: [{ type: 'chart', title: 'Invalid', chart: { type: 'bar', categories: ['Q1', 'Q2'], series: [{ name: 'A', values: [1] }] } }],
    },
    'invalid-chart-data',
  ],
  [
    {
      version: 1,
      slides: [{ type: 'chart', title: 'Invalid', chart: { type: 'scatter', categories: [], series: [{ name: 'A', values: [1] }] } }],
    },
    'invalid-chart-data',
  ],
  [
    {
      version: 1,
      slides: [
        {
          type: 'chart',
          title: 'Invalid',
          chart: { type: 'bubble', categories: [], series: [{ name: 'A', values: [1], x: [1], sizes: [-1] }] },
        },
      ],
    },
    'invalid-chart-data',
  ],
]) {
  const snapshot = structuredClone(invalid);
  await assert.rejects(
    () => api.fill.fillTemplate(template, invalid, options),
    (error) => error instanceof api.fill.TemplateFillError && error.reason === reason,
  );
  assert.deepEqual(template, original, `${reason} 必须保留调用方原始模板`);
  assert.deepEqual(invalid, snapshot, `${reason} 必须保留调用方原始大纲`);
}
const aborted = new AbortController();
aborted.abort();
await assert.rejects(
  () => api.fill.fillTemplate(template, outline, { ...options, signal: aborted.signal }),
  (error) => error.reason === 'aborted',
);
await assert.rejects(
  () => api.fill.fillTemplate(template, outline, { ...options, lint: {} }),
  (error) => error.reason === 'measurement-required',
);
const cancelling = new AbortController();
await assert.rejects(
  () =>
    api.fill.fillTemplate(template, outline, {
      ...options,
      signal: cancelling.signal,
      lint: { ...options.lint, onProgress: () => cancelling.abort() },
    }),
  (error) => error.reason === 'aborted',
);
await runTemplateFillRegressions({ api, template, options, assert });
await runTemplateFillNotesReuse({ api, bytes: result.bytes, options, assert });
const packageContract = await runTemplateFillPackageContract({ api, template, outline, baseline: result, options, assert });
writeFileSync(join(out, 'potx-filled.pptx'), packageContract.bytes);
writeFileSync(join(out, 'package-contract.json'), `${JSON.stringify(packageContract.report, null, 2)}\n`);

const editorial = await api.fill.fillTemplate('editorial', outline, options);
assert.deepEqual(editorial.lint.issues, []);
assert.equal(editorial.description.totalSlides, 6);
for (const [index, slide] of editorial.description.slides.entries()) {
  const numbers = slide.elements.filter((element) => element.placeholder?.type === 'sldNum');
  assert.equal(numbers.length, 1);
  assert.equal(numbers[0].paragraphs.map((p) => p.text).join(''), String(index + 1), '生成页的动态页码必须按最终顺序求值');
}
const fieldParts = inspectTemplateFillSlideNumbers(unzipSync(editorial.bytes), assert);
assert.equal(fieldParts.length, 6);
assert.deepEqual(
  fieldParts.map((field) => field.cachedText),
  ['1', '2', '3', '4', '5', '6'],
  '原生 slidenum 缓存必须与最终页序一致',
);
writeFileSync(join(out, 'editorial-filled.pptx'), editorial.bytes);
writeFileSync(join(out, 'editorial-fields.json'), `${JSON.stringify(fieldParts, null, 2)}\n`);
for (const id of ['aurora', 'midnight']) {
  const input = api.templates.createPptxFromTemplate(id);
  const original = new Uint8Array(input);
  const generated = await api.fill.fillTemplate(input, outline, options);
  assert.deepEqual(generated.lint.issues, [], `${id} 必须真实修复原始模板问题`);
  assert.deepEqual(input, original, '修复只能改变生成副本');
  const before = unzipSync(input),
    after = unzipSync(generated.bytes);
  assert.notDeepEqual(
    after['ppt/slideMasters/slideMaster1.xml'],
    before['ppt/slideMasters/slideMaster1.xml'],
    '出血装饰必须在生成副本的原生母版中实际改变',
  );
  writeFileSync(join(out, `${id}-filled.pptx`), generated.bytes);
}

const child = join(root, 'tooling/lib/template-fill-process.mjs');
const outputs = ['first-filled.pptx', 'second-filled.pptx'].map((name) => join(out, name));
const reports = outputs.map((output) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [child, runtime, join(root, 'fixtures/sample-template-fill.pptx'), join(out, 'fixture-outline.json'), output],
      { cwd: root, encoding: 'utf8' },
    ),
  ),
);
assert.deepEqual(readFileSync(outputs[0]), readFileSync(outputs[1]), '两个独立进程生成的 PPTX 必须逐字节一致');
assert.deepEqual(reports[0], reports[1], '两个独立进程的 describe/lint/bindings 必须一致');
const renderer = join(root, 'tooling/lib/template-fill-fingerprint.mjs');
const fingerprints = Object.fromEntries(
  ['read', 'edit'].map((mode) => [
    mode,
    outputs.map((output) => JSON.parse(execFileSync(process.execPath, [renderer, runtime, output, mode], { cwd: root, encoding: 'utf8' }))),
  ]),
);
assert.deepEqual(fingerprints.read[0], fingerprints.read[1], '两次生成的只读双文字路径指纹必须一致');
assert.deepEqual(fingerprints.edit[0], fingerprints.edit[1], '两次生成的编辑双文字路径指纹必须一致');
assert.deepEqual(fingerprints.read[0], fingerprints.edit[0], '生成产物的只读与编辑双文字路径必须等价');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
writeFileSync(
  join(out, 'determinism.json'),
  `${JSON.stringify({ sha256: outputs.map((path) => sha256(readFileSync(path))), reportsEqual: true, fingerprints }, null, 2)}\n`,
);
record();
console.log(`模板填充基础契约通过${dist ? '（独立产物）' : ''}`);

const external = process.env.TEMPLATE_FILL_EXTERNAL;
if (external) {
  if (!existsSync(external)) throw new Error(`指定的外部模板不存在：${external}`);
  const bytes = new Uint8Array(readFileSync(external));
  const original = new Uint8Array(bytes);
  const generated = await api.fill.fillTemplate(bytes, outline, options);
  assert.deepEqual(bytes, original, '外部模板原始字节必须保持不变');
  assert.equal(generated.description.totalSlides, outline.slides.length);
  assert(generated.description.slides.every((slide) => slide.layout?.id && slide.master?.id));
  writeFileSync(join(out, 'external-filled.pptx'), generated.bytes);
  writeFileSync(
    join(out, 'external-report.json'),
    `${JSON.stringify({ inputSha256: sha256(bytes), description: generated.description, lint: generated.lint }, null, 2)}\n`,
  );
  console.log('外部模板生成副本真实修复完成，完整 lint 报告在 external-report.json');
}
