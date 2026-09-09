import { runSiteChartHierarchyBrowserContract } from './lib/site-chart-hierarchy-browser-contract.mjs';
import { runSiteFontBrowserContract } from './lib/site-font-browser-contract.mjs';
import { runSiteEditorLifecycleBrowserContract } from './lib/site-editor-lifecycle-browser-contract.mjs';
import { runSiteRecoveryBrowserContract } from './lib/site-recovery-browser-contract.mjs';
import { runSiteToolsBrowserContract } from './lib/site-tools-browser-contract.mjs';
import { runSiteFilesBrowserContract } from './lib/site-files-browser-contract.mjs';
import { runSiteChartSharedBrowserContract } from './lib/site-chart-shared-browser-contract.mjs';
import { runSiteChartLegacyBrowserContract } from './lib/site-chart-legacy-browser-contract.mjs';
import { runSitePptSaveBrowserContract } from './lib/site-ppt-save-browser-contract.mjs';
import { runSitePortableClipboardBrowserContract } from './lib/site-portable-clipboard-browser-contract.mjs';
import { runSiteVideoBrowserContract } from './lib/site-video-browser-contract.mjs';
import { runSitePdfBrowserContract } from './lib/site-pdf-browser-contract.mjs';
import {siteFontWorkerFixture} from './lib/site-font-worker-fixture.mjs';
import { runSiteThreeDBrowserContract } from './lib/site-three-d-browser-contract.mjs';
import { runSiteMetafileBrowserContract } from './lib/site-metafile-browser-contract.mjs';
import { runStandaloneCommentsBrowserContract } from './lib/standalone-comments-browser-contract.mjs';
import { runSiteCommentEditBrowserContract } from './lib/site-comment-edit-browser-contract.mjs';
import { runSiteResizeBrowserContract } from './lib/site-resize-browser-contract.mjs';
import { runSiteChartDesignBrowserContract } from './lib/site-chart-design-browser-contract.mjs';
import { runSiteObjectEditBrowserContract } from './lib/site-object-edit-browser-contract.mjs';
import { runSiteCommentsBrowserContract } from './lib/site-comments-browser-contract.mjs';
import { runSiteAppearanceBrowserContract } from './lib/site-appearance-browser-contract.mjs';
import { runSiteEditContextFailureContract } from './lib/site-edit-context-browser-contract.mjs';
/** 官网产品层的 .ppt 转换确认、零命令拒绝与下载命名必须在真实浏览器观察。 */
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';
import { runSiteEditorToolbarContract } from './lib/site-editor-toolbar-contract.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { runChartExBrowserContract } from './lib/chartex-browser-contract.mjs';
import { runNativeChartExBrowserContract } from './lib/chartex-native-browser-contract.mjs';
import { runSiteLanguagePreferencesContract } from './lib/site-editor-language-contract.mjs';
import { runSiteI18nProductionContract } from './lib/site-i18n-production-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const commentEditOnly = process.argv.includes('--comments-edit-only');
const resizeOnly = process.argv.includes('--resize-only');
const chartHierarchyOnly = process.argv.includes('--chart-hierarchy-only');
const chartSharedOnly = process.argv.includes('--chart-shared-only');
const chartLegacyOnly = process.argv.includes('--chart-legacy-only');
const lifecycleOnly = process.argv.includes('--lifecycle-only');
const recoveryOnly = process.argv.includes('--recovery-only');
const chartDesignOnly = process.argv.includes('--chart-design-only');
const pptSaveOnly = process.argv.includes('--ppt-save-only');
const portableCopyOnly = process.argv.includes('--portable-copy-only');
const videoOnly = process.argv.includes('--video-only');
const pdfOnly = process.argv.includes('--pdf-only');
const threeDOnly = process.argv.includes('--three-d-only');
const metafileOnly = process.argv.includes('--metafiles-only');
const objectEditOnly = process.argv.includes('--object-edit-only');
const productionLanguages = process.argv.includes('--i18n-dist');
const productionDirectory = join(root, 'packages/site/dist');
const out = join(root, 'out/site-editor-browser');
mkdirSync(out, { recursive: true });
const bundleDir = join(out, 'bundle');
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });
const bundle = join(bundleDir, 'editor-page.js');
const metafile = join(bundleDir, 'meta.json');
const aliases = [
  ['@web-ppt/fonts/glyphs/browser', join(root, 'packages/fonts/src/glyphs/browser.ts')],
  ['@web-ppt/fonts/glyphs/worker', join(root, 'packages/fonts/src/glyphs/worker.ts')],
  ['@web-ppt/fonts/glyphs/harfbuzz', join(root, 'packages/fonts/src/glyphs/harfbuzz.ts')],
  ['@web-ppt/fonts/glyphs', join(root, 'packages/fonts/src/glyphs/index.ts')],
  ['@web-ppt/edit-core/ppt', join(root, 'packages/edit-core/src/ppt/index.ts')],
  ['@web-ppt/viewer-core/video', join(root, 'packages/viewer-core/src/video.ts')],
  ['@web-ppt/viewer-core/comments', join(root, 'packages/viewer-core/src/comments.ts')],
  ['@web-ppt/core/three-d', join(root, 'packages/core/src/three-d.ts')],
  ['@web-ppt/core/emf-plus', join(root, 'packages/core/src/emf-plus.ts')],
  ['@web-ppt/core/advanced-rendering', join(root, 'packages/core/src/advanced-rendering.ts')],
  ['@web-ppt/core/modern-charts', join(root, 'packages/core/src/modern-charts.ts')],
  ['@web-ppt/core/ink-edit', join(root, 'packages/core/src/ink-edit.ts')],
  ['@web-ppt/core/chart-ex', join(root, 'packages/core/src/chart-ex.ts')],
  ['@web-ppt/core/diagram-edit', join(root, 'packages/core/src/diagram-edit.ts')],
  ['@web-ppt/edit-core/comments', join(root, 'packages/edit-core/src/comments/index.ts')],
  ['@web-ppt/edit-core/chart-design', join(root, 'packages/edit-core/src/chart-design/index.ts')],
  ['@web-ppt/edit-core/chart-ex', join(root, 'packages/edit-core/src/chart-ex/index.ts')],
  ['@web-ppt/edit-core/ink', join(root, 'packages/edit-core/src/ink/index.ts')],
  ['@web-ppt/edit-core/ole', join(root, 'packages/edit-core/src/ole/index.ts')],
  ['@web-ppt/edit-core/cfb', join(root, 'packages/edit-core/src/cfb/index.ts')],
  ['@web-ppt/edit-core/smartart', join(root, 'packages/edit-core/src/smartart/index.ts')],
  ['@web-ppt/edit-core/resize', join(root, 'packages/edit-core/src/resize/index.ts')],
  ['@web-ppt/edit-core/appearance', join(root, 'packages/edit-core/src/appearance/index.ts')],
  ['@web-ppt/editor/accessibility', join(root, 'packages/editor/src/canvas-accessibility.ts')],
  ['@web-ppt/editor/edit-context', join(root, 'packages/editor/src/edit-context/index.ts')],
  ['@web-ppt/editor/media', join(root, 'packages/editor/src/media/index.ts')],
  ['@web-ppt/edit-core/media', join(root, 'packages/edit-core/src/media/index.ts')],
  ['@web-ppt/editor/chart', join(root, 'packages/editor/src/chart/index.ts')],
  ['@web-ppt/editor/chart-shared', join(root, 'packages/editor/src/chart-shared/index.ts')],
  ['@web-ppt/editor/adjustments', join(root, 'packages/editor/src/adjustments/index.ts')],
  ['@web-ppt/core/chart-edit', join(root, 'packages/core/src/chart-edit.ts')],
  ['@web-ppt/core/pdf', join(root, 'packages/core/src/pdf.ts')],
  ['@web-ppt/core/pdf/vector', join(root, 'packages/core/src/pdf/vector.ts')],
  ['@web-ppt/core/pdf/vector/browser', join(root, 'packages/core/src/pdf/vector-browser.ts')],
  ['@web-ppt/core/image-zip', join(root, 'packages/core/src/image-zip.ts')],
  ['@web-ppt/core/geometry/handles', join(root, 'packages/core/src/geometry/handles/index.ts')],
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core/templates', join(root, 'packages/edit-core/src/templates/index.ts')],
  ['@web-ppt/edit-core/chart', join(root, 'packages/edit-core/src/chart/index.ts')],
  ['@web-ppt/edit-core/chart-shared', join(root, 'packages/edit-core/src/chart-shared/index.ts')],
  ['@web-ppt/edit-core/generate', join(root, 'packages/edit-core/src/generate/index.ts')],
  ['@web-ppt/edit-core/save', join(root, 'packages/edit-core/src/save/index.ts')],
  ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
  ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
  ['@web-ppt/viewer-core', join(root, 'packages/viewer-core/src/index.ts')],
  ['@web-ppt/editor', join(root, 'packages/editor/src/index.ts')],
];
execFileSync('npx', [
  'esbuild', join(root, 'packages/site/src/editor-page.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--splitting', '--entry-names=editor-page', '--chunk-names=chunk-[hash]',
  '--log-level=error', ...aliases.map(([from, to]) => `--alias:${from}=${to}`),
  `--outdir=${bundleDir}`, `--metafile=${metafile}`,
], { cwd: root, stdio: 'inherit' });

const metadata = JSON.parse(readFileSync(metafile, 'utf8'));
const outputs = metadata.outputs;
const outputByAbsolute = new Map(Object.keys(outputs).map((key) => [resolve(root, key), key]));
const importedOutput = (owner, path) => outputByAbsolute.get(resolve(dirname(resolve(root, owner)), path))
  ?? outputByAbsolute.get(resolve(root, path));
const pathEndsWith = (value, suffix) => {
  const normalized = value?.replaceAll('\\', '/');
  return normalized === suffix || normalized?.endsWith(`/${suffix}`);
};
const entry = Object.entries(outputs).find(([, info]) =>
  pathEndsWith(info.entryPoint, 'packages/site/src/editor-page.ts'))?.[0];
if (!entry) throw new Error('官网编辑器分块检查找不到入口产物');
const closure = (roots, includeDynamic) => {
  const seen = new Set();
  const pending = [...roots];
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const dependency of outputs[current]?.imports ?? []) {
      if (!includeDynamic && dependency.kind === 'dynamic-import') continue;
      const target = importedOutput(current, dependency.path);
      if (target) pending.push(target);
    }
  }
  return seen;
};
const hasImageZip = (keys) => [...keys].some((key) => Object.keys(outputs[key]?.inputs ?? {})
  .some((input) => pathEndsWith(input, 'packages/core/src/image-zip.ts')));
const hasBuiltinTemplates = (keys) => [...keys].some((key) => Object.keys(outputs[key]?.inputs ?? {})
  .some((input) => pathEndsWith(input, 'packages/edit-core/src/templates/recipes.ts')));
const hasTemplatePicker = (keys) => [...keys].some((key) => Object.keys(outputs[key]?.inputs ?? {})
  .some((input) => pathEndsWith(input, 'packages/site/src/editor-template-picker.ts')));
const hasChartData = (keys) => [...keys].some((key) => Object.keys(outputs[key]?.inputs ?? {})
  .some((input) => pathEndsWith(input, 'packages/edit-core/src/chart/workbook.ts')));
const hasFontDecoder = (keys) => [...keys].some((key) => Object.keys(outputs[key]?.inputs ?? {})
  .some((input) => pathEndsWith(input, 'node_modules/mtx-decompressor/dist/index.mjs')));
const hasAdjustments = (keys) => [...keys].some((key) => Object.keys(outputs[key]?.inputs ?? {})
  .some((input) => pathEndsWith(input, 'packages/editor/src/adjustments/preset-adjustment-editor.ts')));
const initial = closure([entry], false);
const cordisOutputs = Object.keys(outputs).filter(key => Object.keys(outputs[key].inputs).some(input =>
  pathEndsWith(input, 'node_modules/cordis/lib/index.js')));
if (cordisOutputs.length !== 1 || initial.has(cordisOutputs[0])) {
  throw new Error('Cordis 文稿插件必须在首次打开时加载，且只有一份运行时');
}
const mediaOutputs = Object.keys(outputs).filter((key) => Object.keys(outputs[key].inputs).some((input) =>
  pathEndsWith(input, 'packages/edit-core/src/media/resource.ts')
  || pathEndsWith(input, 'packages/site/src/editor-media-tools.ts')));
if (mediaOutputs.length !== 2 || mediaOutputs.some((key) => initial.has(key))) {
  throw new Error('媒体工具和共享校验实现必须在按需闭包，不能重复打包或进入首屏');
}
const lazyMediaUrls = mediaOutputs.map((key) => `/${relative(bundleDir, resolve(root, key)).split(sep).join('/')}`);
const dynamicTargets = new Set([...closure([entry], true)].filter((key) => !initial.has(key)));
const imageZipTargets = [...dynamicTargets].filter((key) => hasImageZip(closure([key], false)));
const templateTargets = [...dynamicTargets].filter((key) => hasBuiltinTemplates(closure([key], false)));
// 多个按需入口可以引用同一实现；直接检查承载源码的输出，避免把共享引用误判为重复打包。
const chartTargets = [...dynamicTargets].filter((key) => hasChartData([key]));
const adjustmentTargets = [...dynamicTargets].filter((key) => hasAdjustments(closure([key], false)));
if (hasImageZip(initial) || imageZipTargets.length !== 1) {
  throw new Error('官网编辑入口必须通过唯一动态分块加载 image-zip，初始依赖图不得包含它');
}
if (hasTemplatePicker(initial) || hasBuiltinTemplates(initial) || templateTargets.length !== 1) {
  throw new Error('官网编辑入口必须按需加载选择器和唯一模板配方块，初始依赖图不得包含它们');
}
if (hasChartData(initial) || chartTargets.length !== 1) {
  throw new Error('官网图表数据编辑器与工作簿补丁器必须只存在于一个按需分块');
}
if (hasFontDecoder(closure([entry], true))) {
  throw new Error('官网编辑器主线程不能加载字体解码器；解压由独占字体 Worker 接管');
}
if (hasAdjustments(initial) || adjustmentTargets.length !== 1) {
  throw new Error('官网调节柄实现必须通过唯一按需分块加载');
}
// 0.7 模板票开始前的同配置实测值；图表、模板、图片 ZIP 与调节柄都不能进入首包。
const initialGzip = gzipSync(readFileSync(resolve(root, entry))).length;
if (initialGzip > 215467) {
  throw new Error(`官网编辑初始入口体积回归：${initialGzip}B gzip > 215467B`);
}
const initialSize = [...initial].reduce((sum, key) => {
  const bytes = readFileSync(resolve(root, key));
  return { raw: sum.raw + bytes.length, gzip: sum.gzip + gzipSync(bytes).length };
}, { raw: 0, gzip: 0 });
const initialBudget = { raw: 2_254_902, gzip: 509_849 };
if (initialSize.raw > initialBudget.raw || initialSize.gzip > initialBudget.gzip) {
  throw new Error(`官网编辑首屏依赖闭包体积回归：${JSON.stringify({ initialBudget, initialSize })}`);
}
const applicationEntry = Object.entries(outputs).find(([, info]) =>
  pathEndsWith(info.entryPoint, 'packages/site/src/editor-application.ts'))?.[0];
if (!applicationEntry) throw new Error('找不到 Cordis 产品应用的按需入口');
const applicationAdditional = [...closure([applicationEntry], false)].filter(key => !initial.has(key))
  .reduce((sum, key) => {
    const bytes = readFileSync(resolve(root, key));
    return { raw: sum.raw + bytes.length, gzip: sum.gzip + gzipSync(bytes).length };
  }, { raw: 0, gzip: 0 });
// 页面归入按需应用后，首屏不再覆盖编辑实现；首次打开仍沿用迁移前预算加当时应用实测值。
const activatedBudget = { raw: initialBudget.raw + 142_565, gzip: initialBudget.gzip + 33_439 };
const activatedSize = { raw: initialSize.raw + applicationAdditional.raw, gzip: initialSize.gzip + applicationAdditional.gzip };
if (activatedSize.raw > activatedBudget.raw || activatedSize.gzip > activatedBudget.gzip) {
  throw new Error(`官网首次打开的应用依赖闭包体积回归：${JSON.stringify({ activatedBudget, activatedSize })}`);
}
writeFileSync(join(out, 'cordis-size.json'), JSON.stringify({ initialSize, initialBudget, applicationAdditional, activatedSize, activatedBudget }, null, 2) + '\n');
const delayedChunks = new Set(imageZipTargets.map((key) =>
  `/${relative(bundleDir, resolve(root, key)).split(sep).join('/')}`));

const browser = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));
if (!browser) throw new Error('找不到 Chrome/Chromium；可通过 CHROME_BIN 指定真实浏览器');

const editorShell = readFileSync(join(root, 'packages/site/editor.html'), 'utf8');
const editorStyle = readFileSync(join(root, 'packages/site/src/editor-page.css'));
if (editorShell.includes('templateDialog') || editorStyle.includes('.template-dialog')) {
  throw new Error('模板选择器的 DOM 与样式必须和实现一起按需加载，不能增加初始 HTML/CSS');
}
if (editorShell.includes('mediaDialog') || editorStyle.includes('#mediaDialog')) {
  throw new Error('媒体弹窗 DOM 与样式必须按需加载');
}
const editorHtml = productionLanguages ? readFileSync(join(productionDirectory, 'editor.html'), 'utf8') : editorShell
  .replace('./src/editor-page.css', './editor-page.css')
  .replace('./src/editor-page.ts', './editor-page.js');
const routes = new Map([
  ...await siteFontWorkerFixture(root,out,aliases),
  ...['cache', 'scatter-horizontal'].map(name => [`/fixtures/sample-chart-shared-transition-${name}.pptx`,
    ['application/octet-stream', readFileSync(join(root, `fixtures/sample-chart-shared-transition-${name}.pptx`))]]),
  ['/fixtures/sample-chart-hierarchy.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chart-hierarchy.pptx'))]],
  ['/fixtures/sample-chart-shared.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chart-shared.pptx'))]],
  ['/fixtures/sample-chart-shared-cache.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chart-shared-cache.pptx'))]],
  ['/fixtures/sample-chart-shared-cache-horizontal.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chart-shared-cache-horizontal.pptx'))]],
  ['/fixtures/sample-chart-shared-xy.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chart-shared-xy.pptx'))]],
  ...['mixed', 'mixed-horizontal', 'mixed-crossed', 'mixed-overlap', 'mixed-records',
    'mixed-records-horizontal', 'mixed-records-flat-horizontal', 'mixed-overlap-crossed'].map(name => [
    `/fixtures/sample-chart-shared-${name}.pptx`, ['application/octet-stream', readFileSync(join(root, `fixtures/sample-chart-shared-${name}.pptx`))],
  ]),
  ['/fixtures/sample-portable-rich-text.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-portable-rich-text.pptx'))]],
  ['/fixtures/sample-comment-edit.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-comment-edit.pptx'))]],
  ['/fixtures/sample-editor-resize.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-editor-resize.pptx'))]],
  ['/fixtures/sample-editor-comments.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-editor-comments.pptx'))]],
  ['/fixtures/sample-editor-audio-icon.png', ['image/png', readFileSync(join(root, 'fixtures/sample-editor-audio-icon.png'))]],
  ['/fixtures/sample-editor-appearance.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-editor-appearance.pptx'))]],
  ['/fixtures/mixed-patched.pptx', ['application/octet-stream', readFileSync(join(root, 'out/edit-save/mixed-patched.pptx'))]],
  ['/fixtures/sample-editor-add-media.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-editor-add-media.pptx'))]],
  ['/fixtures/sample-editor-media.wav', ['audio/wav', readFileSync(join(root, 'fixtures/sample-editor-media.wav'))]],
  ['/fixtures/sample-editor-media.mp4', ['video/mp4', readFileSync(join(root, 'fixtures/sample-editor-media.mp4'))]],
  ['/editor.html', ['text/html; charset=utf-8', editorHtml]],
  ['/fixtures/sample-font-glyphs.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-font-glyphs.pptx'))]],
  ['/fixtures/font-latin.ttf', ['font/ttf', readFileSync(join(root, 'tooling/font-glyph-samples/latin.ttf'))]],
  ['/fixtures/font-chinese.ttf', ['font/ttf', readFileSync(join(root, 'tooling/font-glyph-samples/chinese.ttf'))]],
  ['/fixtures/sample-vector-pdf-text.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-vector-pdf-text.pptx'))]],
  ['/editor.en.html', ['text/html; charset=utf-8', productionLanguages
    ? readFileSync(join(productionDirectory, 'editor.en.html'), 'utf8') : editorHtml]],
  ['/src/i18n-language.css', ['text/css', readFileSync(join(root, 'packages/site/src/i18n-language.css'))]],
  ['/editor-page.css', ['text/css; charset=utf-8', editorStyle]],
  ['/demo/showcase.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/showcase.pptx'))]],
  ['/fixtures/sample.ppt', ['application/vnd.ms-powerpoint', readFileSync(join(root, 'fixtures/sample.ppt'))]],
  ['/fixtures/sample-editor-shape-format.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-shape-format.pptx'))]],
  ['/fixtures/sample-editor-preset-shape.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-preset-shape.pptx'))]],
  ['/fixtures/sample-editor-text.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-text.pptx'))]],
  ['/fixtures/sample-editor-image-content.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-image-content.pptx'))]],
  ['/fixtures/sample-editor-format-painter.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-format-painter.pptx'))]],
  ['/fixtures/sample-editor-find-replace.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-find-replace.pptx'))]],
  ['/fixtures/sample-editor-transitions.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-transitions.pptx'))]],
  ['/fixtures/sample-editor-animations.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-animations.pptx'))]],
  ['/fixtures/sample-editor-touch.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-touch.pptx'))]],
  ['/fixtures/sample-editor-selection-pane.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-selection-pane.pptx'))]],
  ['/fixtures/sample-editor-add-slide.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-add-slide.pptx'))]],
  ['/fixtures/sample-chart-data.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-chart-data.pptx'))]],
  ['/assets/replacement.png', ['image/png', readFileSync(join(root, 'packages/site/public/og.png'))]],
]);
const productionBase = productionLanguages
  ? new URL(/<script[^>]+src="([^"]+)"/.exec(editorHtml)[1], 'http://localhost').pathname.split('/assets/')[0] : '';
const dictionaryUrls = [];
const saveChunks = [];
const chartChunks = { tools: [], data: [] };
if (productionLanguages) {
  for (const page of ['index', 'samples']) for (const suffix of ['', '.en']) {
    routes.set(`/${page}${suffix}.html`, ['text/html; charset=utf-8', readFileSync(join(productionDirectory, `${page}${suffix}.html`))]);
  }
  for (const name of readdirSync(join(productionDirectory, 'assets'))) {
    const bytes = readFileSync(join(productionDirectory, 'assets', name));
    routes.set(`/assets/${name}`, [name.endsWith('.wasm') ? 'application/wasm'
      : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', bytes]);
    if (name.endsWith('.js') && bytes.includes('Fidelity needs a reference')) dictionaryUrls.push(`${productionBase}/assets/${name}`);
    // 可用性校验也服务于复制入口；只定位保存聚合器，才能实际暂停首次序列化加载。
    if (name.endsWith('.js') && bytes.includes('多个编辑扩展的保存基线冲突')) saveChunks.push(`${productionBase}/assets/${name}`);
    if (name.endsWith('.js') && bytes.includes('chart-xy-series')) chartChunks.tools.push(`${productionBase}/assets/${name}`);
    if (name.endsWith('.js') && bytes.includes('图表数据点命令没有修改字段')) chartChunks.data.push(`${productionBase}/assets/${name}`);
  }
  if (dictionaryUrls.length !== 1) throw new Error('生产英文词库必须在唯一按需块中');
  if (saveChunks.length !== 1) throw new Error('找不到生产序列化模块边界');
  if (chartChunks.tools.length !== 1 || chartChunks.data.length !== 1) throw new Error('找不到生产图表工具与数据模块边界');
}
const standaloneBundle = join(out, 'standalone.mjs');
execFileSync('npx', ['esbuild', join(root, 'packages/viewer/src/main.ts'), '--bundle', '--format=esm', '--platform=browser',
  '--log-level=error', ...aliases.map(([from, to]) => `--alias:${from}=${to}`), `--outfile=${standaloneBundle}`], { cwd: root, stdio: 'inherit' });
routes.set('/standalone.mjs', ['text/javascript', readFileSync(standaloneBundle)]);
const recoveryShutdownBundle = join(out, 'recovery-shutdown.mjs');
execFileSync('npx', ['esbuild', join(root, 'tooling/lib/site-recovery-shutdown-browser.mjs'),
  '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
  ...aliases.map(([from, to]) => `--alias:${from}=${to}`), `--outfile=${recoveryShutdownBundle}`],
{ cwd: root, stdio: 'inherit' });
routes.set('/recovery-shutdown.mjs', ['text/javascript', readFileSync(recoveryShutdownBundle)]);
const legacyChartSeed = join(out, 'legacy-chart-seed.mjs');
execFileSync('npx', ['esbuild', join(root, 'tooling/lib/site-chart-legacy-seed-browser.mjs'),
  '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
  ...aliases.map(([from, to]) => `--alias:${from}=${to}`), `--outfile=${legacyChartSeed}`], { cwd: root, stdio: 'inherit' });
routes.set('/legacy-chart-seed.mjs', ['text/javascript', readFileSync(legacyChartSeed)]);
const filesShutdownBundle = join(out, 'files-shutdown.mjs');
execFileSync('npx', ['esbuild', join(root, 'tooling/lib/site-files-shutdown-browser.mjs'),
  '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
  ...aliases.map(([from, to]) => `--alias:${from}=${to}`), `--outfile=${filesShutdownBundle}`],
{ cwd: root, stdio: 'inherit' });
routes.set('/files-shutdown.mjs', ['text/javascript', readFileSync(filesShutdownBundle)]);
routes.set('/tools-shell.html', ['text/html', editorShell.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace('./src/editor-page.css', './editor-page.css')]);
const toolsShutdownBundle = join(out, 'tools-shutdown.mjs');
execFileSync('npx', ['esbuild', join(root, 'tooling/lib/site-tools-shutdown-browser.mjs'),
  '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
  ...aliases.map(([from, to]) => `--alias:${from}=${to}`), `--outfile=${toolsShutdownBundle}`,
], { cwd: root, stdio: 'inherit' });
routes.set('/tools-shutdown.mjs', ['text/javascript', readFileSync(toolsShutdownBundle)]);
routes.set('/standalone.css', ['text/css', readFileSync(join(root, 'packages/viewer/src/style.css'))]);
routes.set('/standalone.html', ['text/html', readFileSync(join(root, 'packages/viewer/index.html'), 'utf8')
  .replace('/src/main.ts', '/standalone.mjs').replace('/src/style.css', '/standalone.css')]);
const chartexCore = join(out, 'chartex-core.mjs');
await bundleBrowser({ root, entry: join(root, 'packages/core/src/index.ts'), output: chartexCore });
routes.set('/chartex-core.mjs', ['text/javascript', readFileSync(chartexCore)]);
const chartexNative = join(out, 'chartex-native.mjs');
await bundleBrowser({ root, entry: join(root, 'packages/core/src/chart-ex.ts'), output: chartexNative });
routes.set('/chartex-native.mjs', ['text/javascript', readFileSync(chartexNative)]);
routes.set('/fixtures/sample-chartex-native.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chartex-native.pptx'))]);
routes.set('/fixtures/sample-chartex-edit.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chartex-edit.pptx'))]);
routes.set('/fixtures/sample-video-export.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-video-export.pptx'))]);
routes.set('/fixtures/sample-ppt-edit.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-ppt-edit.pptx'))]);
routes.set('/fixtures/sample-three-d.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-three-d.pptx'))]);
routes.set('/fixtures/sample-emf-plus.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-emf-plus.pptx'))]);
routes.set('/fixtures/sample-region-map.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-region-map.pptx'))]);
routes.set('/fixtures/sample-ink-edit.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-ink-edit.pptx'))]);
routes.set('/fixtures/sample-ole-edit.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-ole-edit.pptx'))]);
routes.set('/fixtures/sample-smartart-edit.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-smartart-edit.pptx'))]);
routes.set('/fixtures/sample-chartex-fallback.pptx', ['application/octet-stream', readFileSync(join(root, 'fixtures/sample-chartex-fallback.pptx'))]);
const chartexSources = [{ name: 'fixture', path: '/fixtures/sample-chartex-fallback.pptx' }];
const realChartex = join(root, 'corpus/chartex/libreoffice-funnel-pp1.pptx');
if (existsSync(realChartex)) {
  routes.set('/fixtures/real-chartex.pptx', ['application/octet-stream', readFileSync(realChartex)]);
  chartexSources.push({ name: 'libreoffice-funnel', path: '/fixtures/real-chartex.pptx',
    sha256: '8f971346a21010dfdb22799be79bbb883497cc260129cba41d5c9b06967fc3e3',
    imageHash: '855f488a5d14106adab0adc1d4a547863f09f2e737fc347dacf493b80ed63096' });
}
let rejectEditContext = false;
const editContextUrls = Object.entries(outputs).filter(([, info]) =>
  pathEndsWith(info.entryPoint, 'packages/editor/src/edit-context/index.ts'))
  .map(([key]) => `/${relative(bundleDir, resolve(root, key)).split(sep).join('/')}`);
let rejectedEditContextLoads = 0;
const server = createServer((request, response) => {
  const rawPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const pathname = productionBase && rawPath.startsWith(`${productionBase}/`) ? rawPath.slice(productionBase.length) : rawPath;
  if (rejectEditContext && editContextUrls.includes(pathname)) {
    rejectedEditContextLoads++; response.writeHead(503).end('Intentional optional chunk failure'); return;
  }
  if (pathname === '/slow-media.wav') {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' });
      response.end(routes.get('/fixtures/sample-editor-media.wav')[1]);
    }, 1000);
    return;
  }
  const route = routes.get(pathname);
  if (route) {
    response.writeHead(200, { 'content-type': route[0] });
    response.end(route[1]);
    return;
  }
  const asset = resolve(bundleDir, `.${pathname}`);
  if (!asset.startsWith(`${resolve(bundleDir)}${sep}`) || !existsSync(asset)) {
    response.writeHead(404).end('Not found');
    return;
  }
  const send = () => {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(readFileSync(asset));
  };
  // 人为拉开动态块加载窗口，竞态合约不依赖本机磁盘恰好有多快。
  if (delayedChunks.has(pathname)) setTimeout(send, 100); else send();
});

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
let child;
let profile;
let diagnostics = '';

function assertPngDimensions(data, width, height, label) {
  const png = Buffer.from(data, 'base64');
  const actual = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`${label}截图尺寸错误：${JSON.stringify(actual)}`);
  }
  return png;
}

function browserRunning() {
  return child && child.exitCode === null && child.signalCode === null;
}

async function waitForBrowserExit(milliseconds) {
  if (!browserRunning()) return true;
  return Promise.race([
    new Promise((resolveExit) => child.once('close', () => resolveExit(true))),
    delay(milliseconds).then(() => false),
  ]);
}

async function launch(url) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    child = spawn(browser, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1280,720', `--user-data-dir=${profile}`, '--remote-debugging-port=0', url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timeout = setTimeout(() => rejectLaunch(new Error('Chrome DevTools 启动超时')), 10000);
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString('utf8');
      const match = diagnostics.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (!match) return;
      clearTimeout(timeout);
      resolveLaunch(Number(match[1]));
    });
    child.once('error', rejectLaunch);
  });
}

async function pageTarget(port, url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === url);
      if (target) return target.webSocketDebuggerUrl;
    } catch { /* DevTools 端口刚出现时尚未开始响应。 */ }
    await delay(100);
  }
  throw new Error('Chrome 没有创建官网编辑页');
}

async function runContract(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.once('open', resolveOpen);
    socket.once('error', rejectOpen);
  });
  let serial = 0;
  const pending = new Map();
  const consoleFailures = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.method === 'Page.javascriptDialogOpening' && message.params.type === 'beforeunload') {
      void request('Page.handleJavaScriptDialog', { accept: true });
    }
    if (message.method === 'Runtime.consoleAPICalled'
      && (message.params.type === 'warning' || message.params.type === 'error')) {
      consoleFailures.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleFailures.push(message.params.exceptionDetails.exception?.description ?? '页面异常');
    }
    const response = pending.get(message.id);
    if (!response) return;
    pending.delete(message.id);
    clearTimeout(response.timeout);
    message.error ? response.reject(new Error(`Chrome DevTools ${response.method}: ${message.error.message}`)) : response.resolve(message);
  });
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = ++serial;
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Chrome DevTools ${method} 请求超时`));
    }, 15000);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await request('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
      .catch((error) => { throw new Error(`${error.message}；表达式：${expression.slice(0, 240)}`, { cause: error }); });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description ?? '页面脚本执行失败');
    }
    return response.result?.result?.value;
  };
  const waitFor = async (expression, label, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { if (await evaluate(expression)) return; } catch (error) {
        // Page.navigate 返回时旧执行上下文可能仍在销毁；仅只读轮询可以跨过这个窗口。
        if (!/Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id/.test(String(error))) throw error;
      }
      await delay(50);
    }
    const state = await evaluate(`(() => ({
      kind: document.querySelector('#documentKind')?.textContent,
      status: document.querySelector('#statusText')?.textContent,
      loading: document.querySelector('#editorApp')?.dataset.loading,
      file: document.querySelector('#fileName')?.textContent,
      page: document.querySelector('#pageIndicator')?.textContent,
      slides: [...document.querySelectorAll('#slideList [data-slide-id]')].map((n) => ({id:n.dataset.slideId, selected:n.getAttribute('aria-current')})),
      names: [...document.querySelectorAll('[data-pane-name]')].map(n=>n.textContent),
      chart: { hidden: document.querySelector('#chartInspector')?.hidden, html: document.querySelector('#chartInspector')?.innerHTML?.slice(0,2500), selected: [...document.querySelectorAll('[data-pane-element][aria-selected=true]')].map(e=>e.textContent) },
      language: document.documentElement.lang,
      chartSeries: [...document.querySelectorAll('[data-chart-grid] thead input')].map(input => input.value),
      viewer: { pager: document.querySelector('#pager')?.textContent, meta: document.querySelector('#meta')?.textContent,
        preview: document.querySelector('.preview-meta')?.textContent, stage: document.querySelector('.stage .err')?.textContent },
      url: location.href,
      dialogs: [...document.querySelectorAll('dialog[open],[role="dialog"]')]
        .filter((dialog) => !dialog.hidden).map((dialog) => dialog.id),
      animations: document.querySelectorAll('#animationTimeline li').length,
      animationHtml: document.querySelector('#animationTimeline')?.innerHTML,
      media: { open: document.querySelector('#mediaDialog')?.open,
        source: document.querySelector('#mediaSource')?.value,
        error: document.querySelector('#mediaError')?.textContent,
        playback: document.querySelector('#mediaPlaybackStatus')?.textContent },
    }))()`);
    throw new Error(`等待${label}超时：${JSON.stringify(state)}；控制台：${consoleFailures.join(' | ')}`);
  };
  const click = async (selector) => {
    const point = await evaluate(`(async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        // 滚动后的异步面板重绘会替换节点；只重新定位，真实点击仍仅派发一次。
        node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (!node.isConnected) continue;
        const rect = node.getBoundingClientRect();
        const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        if (!node.contains(document.elementFromPoint(point.x, point.y))) {
          throw new Error('点击目标被遮挡：' + ${JSON.stringify(selector)});
        }
        return point;
      }
      throw new Error('点击目标持续重绘：' + ${JSON.stringify(selector)});
    })()`, true);
    if (!point) throw new Error(`找不到 ${selector}`);
    try {
      await request('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
      });
      await request('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
      });
    } catch (error) { throw new Error(`点击 ${selector} (${point.x}, ${point.y}) 失败：${error.message}`); }
  };
  const dispatchKey = async (key, code, virtualKeyCode, modifiers = 0) => {
    const params = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode, modifiers };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  };
  try {
    await request('Runtime.enable');
    await request('Page.enable');
    await request('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
    });
    await waitFor(`document.querySelector('#fileName')?.textContent === 'showcase.pptx'
      && document.querySelector('#documentKind')?.textContent === 'PPTX · 可编辑'
      && !document.querySelector('#editorApp')?.dataset.loading`, '默认文稿就绪');
    if (chartLegacyOnly) {
      await runSiteChartLegacyBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (recoveryOnly) {
      await runSiteRecoveryBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (lifecycleOnly) {
      await runSiteEditorLifecycleBrowserContract({ evaluate, request, waitFor, click });
      await runSiteFilesBrowserContract({ evaluate });
    await runSiteToolsBrowserContract({ evaluate });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (pptSaveOnly) {
      await runSitePptSaveBrowserContract({ evaluate, request, waitFor, click });
      return;
    }
    if (portableCopyOnly) {
      await runSitePortableClipboardBrowserContract({ evaluate, request, waitFor, click });
      return;
    }
    if (videoOnly) {
      await runSiteVideoBrowserContract({ evaluate, request, waitFor, click });
      return;
    }
    if (pdfOnly) {
      await runSitePdfBrowserContract({ evaluate, request, waitFor, click });
      return;
    }
    if (threeDOnly) {
      await runSiteThreeDBrowserContract({ evaluate, request, waitFor, click });
      return;
    }
    if (metafileOnly) {
      await runSiteMetafileBrowserContract({ evaluate, request, waitFor, click });
      return;
    }
    if (objectEditOnly) {
      await runSiteObjectEditBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (chartSharedOnly) {
      await runSiteChartSharedBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (chartHierarchyOnly) {
      await runSiteChartHierarchyBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (chartDesignOnly) {
      await runSiteChartDesignBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (commentEditOnly) {
      await runSiteCommentEditBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (resizeOnly) {
      await runSiteResizeBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(consoleFailures.join(' | '));
      return { bytes: 0 };
    }
    if (productionLanguages) {
      const onEvent = (listener) => {
        const receive = (data) => listener(JSON.parse(data.toString()));
        socket.on('message', receive);
        return () => socket.off('message', receive);
      };
      const consumeConsoleFailure = (fragment) => {
        const index = consoleFailures.findIndex((failure) => failure.includes(fragment));
        if (index < 0) return false;
        consoleFailures.splice(index, 1);
        return true;
      };
      await runSiteI18nProductionContract({ evaluate, request, waitFor, click, dictionaryUrls, chartChunks, saveChunks, onEvent, consumeConsoleFailure });
      await request('Page.navigate', { url: await evaluate("new URL('editor.html?lang=zh-CN', location.href).href") });
      const featureReady = "document.querySelector('#fileInput') && document.querySelector('#canvasMount')?.firstElementChild && !document.querySelector('#editorApp')?.dataset.loading";
      await waitFor(`(${featureReady}) || document.querySelector('#recoveryPrompt')?.hidden === false`, '生产外观页面就绪');
      if (await evaluate("document.querySelector('#recoveryPrompt')?.hidden === false")) await click('#discardRecovery');
      await waitFor(featureReady, '生产外观文稿就绪');
      await runSiteFontBrowserContract({ evaluate, request, waitFor, click });
      await runSiteCommentsBrowserContract({ evaluate, request, waitFor, click });
      await runSiteResizeBrowserContract({ evaluate, request, waitFor, click });
      await runSiteCommentEditBrowserContract({ evaluate, request, waitFor, click });
      await runSiteChartDesignBrowserContract({ evaluate, request, waitFor, click });
      await runSiteChartHierarchyBrowserContract({ evaluate, request, waitFor, click });
      await runSiteChartSharedBrowserContract({ evaluate, request, waitFor, click });
      await runSiteAppearanceBrowserContract({ evaluate, request, waitFor, click, out });
      await runSiteObjectEditBrowserContract({ evaluate, request, waitFor, click });
      await runSiteMetafileBrowserContract({ evaluate, request, waitFor, click });
      await runSiteThreeDBrowserContract({ evaluate, request, waitFor, click });
      await runSitePptSaveBrowserContract({ evaluate, request, waitFor, click });
      await runSitePdfBrowserContract({ evaluate, request, waitFor, click });
      await runSiteVideoBrowserContract({ evaluate, request, waitFor, click });
      await runSitePortableClipboardBrowserContract({ evaluate, request, waitFor, click });
      if (consoleFailures.length) throw new Error(`语言生产页面错误：${consoleFailures.join(' | ')}`);
      return { bytes: 0 };
    }
    await runSiteEditorLifecycleBrowserContract({ evaluate, request, waitFor, click });
    await runSiteFilesBrowserContract({ evaluate });
    await runSiteToolsBrowserContract({ evaluate });
    await runSiteRecoveryBrowserContract({ evaluate, request, waitFor, click });
    await runChartExBrowserContract({ evaluate, request, out, sources: chartexSources });
    await runNativeChartExBrowserContract({ evaluate, request, out });
    await runSiteCommentsBrowserContract({ evaluate, request, waitFor, click });
    await runSiteResizeBrowserContract({ evaluate, request, waitFor, click });
    await runSiteCommentEditBrowserContract({ evaluate, request, waitFor, click });
    await runSiteChartDesignBrowserContract({ evaluate, request, waitFor, click });
    await runSiteChartHierarchyBrowserContract({ evaluate, request, waitFor, click });
    await runSiteChartSharedBrowserContract({ evaluate, request, waitFor, click });
    await runSiteObjectEditBrowserContract({ evaluate, request, waitFor, click });
    await runSiteMetafileBrowserContract({ evaluate, request, waitFor, click });
    await runSiteThreeDBrowserContract({ evaluate, request, waitFor, click });
    await runSitePptSaveBrowserContract({ evaluate, request, waitFor, click });
    await runSitePdfBrowserContract({ evaluate, request, waitFor, click });
    await runSiteVideoBrowserContract({ evaluate, request, waitFor, click });
    await runSitePortableClipboardBrowserContract({ evaluate, request, waitFor, click });
    await evaluate(`(() => {
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) {
          globalThis.__capturedDownload = { name: this.download, href: this.href };
          return;
        }
        return original.call(this);
      };
    })()`);
    await runSiteEditorToolbarContract({ evaluate, waitFor, click, request, lazyMediaUrls, out });
    await evaluate("document.querySelector('#editorInspector').scrollTop = 0");
    const desktopLayout = await evaluate(`(() => {
      const panel = document.querySelector('.object-panel').getBoundingClientRect();
      const canvas = document.querySelector('#canvasViewport').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom, width: panel.width, height: panel.height },
        canvas: { width: canvas.width, height: canvas.height } };
    })()`);
    if (desktopLayout.width !== 1280 || desktopLayout.height !== 720
      || desktopLayout.scrollWidth > desktopLayout.width
      || desktopLayout.panel.left < 0 || desktopLayout.panel.right > desktopLayout.width + 1
      || desktopLayout.panel.bottom > desktopLayout.height + 1
      || desktopLayout.panel.width < 200 || desktopLayout.panel.height < 300
      || desktopLayout.canvas.width < 300 || desktopLayout.canvas.height < 300) {
      throw new Error(`1280×720 工具栏布局越界：${JSON.stringify(desktopLayout)}`);
    }
    const desktopShot = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, 'toolbar-1280x720.png'), assertPngDimensions(desktopShot.result.data, 1280, 720, '桌面'));
    await request('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    if (!await evaluate("document.querySelector('#editorApp').dataset.inspectorOpen === 'true'")) {
      await click('#inspectorToggle');
    }
    await evaluate("document.querySelector('#editorInspector').scrollTop = 0");
    await waitFor("document.querySelector('#editorApp').dataset.inspectorOpen === 'true'", '移动端格式抽屉');
    const mobileLayout = await evaluate(`(() => {
      const panel = document.querySelector('.object-panel').getBoundingClientRect();
      const canvas = document.querySelector('#canvasViewport').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom, width: panel.width, height: panel.height },
        canvas: { width: canvas.width, height: canvas.height } };
    })()`);
    if (mobileLayout.width !== 390 || mobileLayout.height !== 844
      || mobileLayout.scrollWidth > mobileLayout.width
      || mobileLayout.panel.left < 71 || mobileLayout.panel.right > mobileLayout.width + 1
      || mobileLayout.panel.bottom > mobileLayout.height + 1
      || mobileLayout.panel.width < 250 || mobileLayout.panel.height < 300
      || mobileLayout.canvas.width < 200 || mobileLayout.canvas.height < 200) {
      throw new Error(`390×844 工具栏布局越界：${JSON.stringify(mobileLayout)}`);
    }
    const mobileShot = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, 'toolbar-390x844.png'), assertPngDimensions(mobileShot.result.data, 390, 844, '移动端'));
    await request('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
    });
    await click('#newFile');
    await waitFor(`document.querySelector('#templateDialog')?.open
      && document.querySelectorAll('[data-template-id]').length === 4`, '模板选择器');
    const templatePicker = await evaluate(`(() => ({
      names: [...document.querySelectorAll('.template-card > strong')].map((node) => node.textContent),
      midnightSurface: document.querySelector('[data-template-id="midnight"]')?.style
        .getPropertyValue('--template-surface'),
    }))()`);
    if (templatePicker.names.join('|') !== '空白|极光|刊页|夜幕'
      || templatePicker.midnightSurface !== '#101827') {
      throw new Error(`模板选择器没有消费公开预览目录：${JSON.stringify(templatePicker)}`);
    }
    await click('[data-template-id="midnight"]');
    await waitFor(`document.querySelector('#fileName')?.textContent === '夜幕演示文稿.pptx'
      && document.querySelector('#slideCount')?.textContent === '1'
      && document.querySelector('#slideLayout')?.options.length === 5
      && !document.querySelector('#editorApp')?.dataset.loading`, '夜幕模板文稿就绪');
    const midnight = await evaluate(`(() => ({
      page: document.querySelector('#pageIndicator')?.textContent,
      elements: document.querySelectorAll('[data-edit-id]').length,
      background: document.querySelector('[data-web-ppt-editor] svg > rect')?.getAttribute('fill'),
    }))()`);
    if (midnight.page !== '1 / 1' || midnight.background !== 'rgb(16,24,39)') {
      throw new Error(`模板文稿没有进入统一编辑会话：${JSON.stringify(midnight)}`);
    }
    await click('#newFile');
    await waitFor("document.querySelector('#templateDialog')?.open", '再次打开模板选择器');
    await click('[data-template-id="blank"]');
    await waitFor(`document.querySelector('#fileName')?.textContent === '未命名演示文稿.pptx'
      && document.querySelector('#slideCount')?.textContent === '1'
      && !document.querySelector('#editorApp')?.dataset.loading`, '空白文稿就绪');
    const blank = await evaluate(`(() => ({
      kind: document.querySelector('#documentKind')?.textContent,
      shapeDisabled: document.querySelector('#addShape')?.disabled,
      tableDisabled: document.querySelector('#addTable')?.disabled,
      exportDisabled: document.querySelector('#exportImages')?.disabled,
      saveDisabled: document.querySelector('#saveFile')?.disabled,
      page: document.querySelector('#pageIndicator')?.textContent,
    }))()`);
    if (blank.kind !== 'PPTX · 可编辑' || blank.shapeDisabled || blank.tableDisabled
      || blank.exportDisabled
      || blank.saveDisabled || blank.page !== '1 / 1') {
      throw new Error(`空白文稿没有进入可编辑状态：${JSON.stringify(blank)}`);
    }
    await click('#addSlide');
    await waitFor(`document.querySelector('#slideCount')?.textContent === '2'
      && document.querySelector('#pageIndicator')?.textContent === '2 / 2'`, '空白文稿新增页面');
    await evaluate("document.querySelector('[data-web-ppt-editor]').focus({ preventScroll: true })");
    await dispatchKey('PageUp', 'PageUp', 33);
    await waitFor(`document.querySelector('#pageIndicator')?.textContent === '1 / 2'
      && document.querySelector('[data-slide-id][aria-current="true"] .slide-number')?.textContent === '1'`,
    '可信 PageUp 同步产品分页器');
    await dispatchKey('PageDown', 'PageDown', 34);
    await waitFor(`document.querySelector('#pageIndicator')?.textContent === '2 / 2'
      && document.querySelector('[data-slide-id][aria-current="true"] .slide-number')?.textContent === '2'`,
    '可信 PageDown 同步产品分页器');
    const blankInitialCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    await click('#addShape');
    await waitFor("document.querySelector('#fileName')?.textContent.startsWith('●')", '空白文稿编辑命令');
    await click('#undo');
    await click('#redo');
    const blankEditedCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    if (blankEditedCount !== blankInitialCount + 1) throw new Error('空白文稿撤销重做没有恢复插入形状');
    await evaluate('globalThis.__capturedDownload = null');
    await click('#exportImages');
    const exportBusy = await evaluate(`(() => ({
      newDisabled: document.querySelector('#newFile')?.disabled,
      inputDisabled: document.querySelector('#fileInput')?.disabled,
      exportDisabled: document.querySelector('#exportImages')?.disabled,
      saveDisabled: document.querySelector('#saveFile')?.disabled,
      file: document.querySelector('#fileName')?.textContent,
      page: document.querySelector('#pageIndicator')?.textContent,
      slides: [...document.querySelectorAll('#slideList [data-slide-id]')].map((n) => ({id:n.dataset.slideId, selected:n.getAttribute('aria-current')})),
      names: [...document.querySelectorAll('[data-pane-name]')].map(n=>n.textContent),
      chart: { hidden: document.querySelector('#chartInspector')?.hidden, html: document.querySelector('#chartInspector')?.innerHTML?.slice(0,2500), selected: [...document.querySelectorAll('[data-pane-element][aria-selected=true]')].map(e=>e.textContent) },
    }))()`);
    if (!exportBusy.newDisabled || !exportBusy.inputDisabled || !exportBusy.exportDisabled
      || !exportBusy.saveDisabled || !exportBusy.file.endsWith('未命名演示文稿.pptx')) {
      throw new Error(`图片导出没有原子锁定文稿会话：${JSON.stringify(exportBusy)}`);
    }
    await evaluate(`(async () => {
      const bytes = await fetch('/fixtures/sample-editor-text.pptx').then((response) => response.arrayBuffer());
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], '竞态替换.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }));
      const input = document.querySelector('#fileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor("globalThis.__capturedDownload?.name?.endsWith('-images.zip')", '当前编辑态图片 ZIP 下载');
    const imageZipDownload = await evaluate(`(async () => {
      const captured = globalThis.__capturedDownload;
      const bytes = new Uint8Array(await fetch(captured.href).then((response) => response.arrayBuffer()));
      return { name: captured.name, bytes: Array.from(bytes.slice(0, 4)),
        dirty: document.querySelector('#fileName')?.textContent.startsWith('●'),
        active: document.querySelector('#fileName')?.textContent,
        newDisabled: document.querySelector('#newFile')?.disabled };
    })()`, true);
    if (imageZipDownload.name !== '未命名演示文稿-images.zip'
      || imageZipDownload.bytes[0] !== 0x50 || imageZipDownload.bytes[1] !== 0x4b
      || !imageZipDownload.dirty || !imageZipDownload.active.endsWith('未命名演示文稿.pptx')
      || imageZipDownload.newDisabled) {
      throw new Error(`当前编辑态图片 ZIP 无效或改变保存状态：${JSON.stringify(imageZipDownload)}`);
    }
    await evaluate('globalThis.__capturedDownload = null');
    await click('#saveFile');
    await waitFor('!!globalThis.__capturedDownload', '空白 PPTX 下载');
    const blankDownload = await evaluate(`(async () => {
      const captured = globalThis.__capturedDownload;
      const bytes = new Uint8Array(await fetch(captured.href).then((response) => response.arrayBuffer()));
      return { name: captured.name, bytes: Array.from(bytes.slice(0, 4)) };
    })()`, true);
    if (blankDownload.name !== '未命名演示文稿.pptx'
      || blankDownload.bytes[0] !== 0x50 || blankDownload.bytes[1] !== 0x4b) {
      throw new Error(`空白文稿下载无效：${JSON.stringify(blankDownload)}`);
    }
    await evaluate('globalThis.__capturedDownload = null');
    await evaluate(`(async () => {
      const bytes = await fetch('/fixtures/sample.ppt').then((response) => response.arrayBuffer());
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'sample.ppt', { type: 'application/vnd.ms-powerpoint' }));
      const input = document.querySelector('#fileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor("document.querySelector('#documentKind')?.textContent.startsWith('PPT ·') && !document.querySelector('#editorApp')?.dataset.loading", '.ppt 打开');
    const initialCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    await evaluate(`(() => {
      globalThis.__conversionPrompts = [];
      globalThis.__confirmConversion = false;
      window.confirm = (message) => {
        globalThis.__conversionPrompts.push(message);
        return globalThis.__confirmConversion;
      };
    })()`);
    await click('#editMode');
    await delay(100);
    const promptState = await evaluate(`(() => ({
      prompts: globalThis.__conversionPrompts?.length,
      disabled: document.querySelector('#editMode').disabled,
      kind: document.querySelector('#documentKind').textContent,
      mode: document.querySelector('#editMode').getAttribute('aria-pressed'),
      status: document.querySelector('#statusText').textContent,
    }))()`);
    if (promptState.prompts !== 1) {
      throw new Error(`转换拒绝提示没有出现：${JSON.stringify(promptState)}`);
    }
    const rejected = await evaluate(`(() => ({
      prompt: globalThis.__conversionPrompts[0],
      edit: document.querySelector('#editMode').getAttribute('aria-pressed'),
      addDisabled: document.querySelector('#addShape').disabled,
      saveDisabled: document.querySelector('#saveFile').disabled,
      undoDisabled: document.querySelector('#undo').disabled,
      dirty: document.querySelector('#fileName').textContent.startsWith('●'),
      elements: document.querySelectorAll('[data-edit-id]').length,
    }))()`);
    if (!rejected.prompt.includes('sample.pptx') || !rejected.prompt.includes('不会覆盖原文件')
      || !rejected.prompt.includes('带原因的框架占位')
      || rejected.edit !== 'false' || !rejected.addDisabled || !rejected.saveDisabled
      || !rejected.undoDisabled || rejected.dirty || rejected.elements !== initialCount) {
      throw new Error(`拒绝转换没有保持 view 与零命令：${JSON.stringify(rejected)}`);
    }

    await evaluate('globalThis.__confirmConversion = true');
    await click('#editMode');
    await waitFor("document.querySelector('#editMode')?.getAttribute('aria-pressed') === 'true'", '转换后编辑模式');
    const accepted = await evaluate(`(() => ({
      kind: document.querySelector('#documentKind').textContent,
      addDisabled: document.querySelector('#addShape').disabled,
      saveDisabled: document.querySelector('#saveFile').disabled,
      prompts: globalThis.__conversionPrompts.length,
    }))()`);
    if (accepted.kind !== 'PPT → PPTX · 可编辑' || accepted.addDisabled || accepted.saveDisabled
      || accepted.prompts !== 2) throw new Error(`确认转换后未开放编辑：${JSON.stringify(accepted)}`);

    await click('#addShape');
    await waitFor("document.querySelector('#fileName')?.textContent.startsWith('●')", '编辑命令提交');
    const editedCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    if (editedCount !== initialCount + 1) throw new Error('确认转换后插入命令没有生效');
    await click('#saveFile');
    await waitFor('!!globalThis.__capturedDownload', 'PPTX 下载');
    const downloaded = await evaluate(`(async () => {
      const captured = globalThis.__capturedDownload;
      const bytes = new Uint8Array(await fetch(captured.href).then((response) => response.arrayBuffer()));
      return { name: captured.name, bytes: Array.from(bytes), status: document.querySelector('#statusText').textContent };
    })()`, true);
    if (downloaded.name !== 'sample.pptx' || downloaded.bytes[0] !== 0x50
      || downloaded.bytes[1] !== 0x4b || !downloaded.status.includes('PPTX')) {
      throw new Error(`下载结果不符合 .ppt 另存契约：${JSON.stringify({ ...downloaded, bytes: downloaded.bytes.slice(0, 4) })}`);
    }
    writeFileSync(join(out, 'sample.pptx'), Uint8Array.from(downloaded.bytes));
    await evaluate(`(async () => {
      const bytes = await fetch('/fixtures/sample-chart-data.pptx').then((response) => response.arrayBuffer());
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'sample-chart-data.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }));
      const input = document.querySelector('#fileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor(`document.querySelector('#fileName')?.textContent === 'sample-chart-data.pptx'
      && !document.querySelector('#editorApp')?.dataset.loading`, '图表数据固件就绪');
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-pane-element]')]
        .find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === '图表');
      if (!row) throw new Error('找不到图表对象');
      row.click();
    })()`);
    await waitFor(`!document.querySelector('#chartInspector')?.hidden
      && !!document.querySelector('[data-chart-grid="category"]')`, '图表数据表按需加载');
    await evaluate(`(() => {
      const name = document.querySelector('[data-chart-grid="category"] thead th:nth-child(2) input');
      name.value = '浏览器营收';
      name.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('#canvasMount')?.textContent.includes('浏览器营收')`, '图表系列投影更新');
    await evaluate(`(() => {
      const value = document.querySelector('[data-chart-grid="category"] tbody tr:first-child td:nth-child(2) input');
      value.value = '7777';
      value.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('#fileName')?.textContent.startsWith('●')
      && document.querySelector('[data-chart-grid="category"] tbody tr:first-child td:nth-child(2) input')?.value === '7777'`, '图表数值编辑');
    await evaluate('globalThis.__capturedDownload = null');
    await click('#saveFile');
    await waitFor('!!globalThis.__capturedDownload', '图表数据 PPTX 下载');
    const chartDownload = await evaluate(`(async () => {
      const captured = globalThis.__capturedDownload;
      const bytes = new Uint8Array(await fetch(captured.href).then((response) => response.arrayBuffer()));
      return { name: captured.name, signature: Array.from(bytes.slice(0, 4)) };
    })()`, true);
    if (chartDownload.name !== 'sample-chart-data-edited.pptx'
      || chartDownload.signature[0] !== 0x50 || chartDownload.signature[1] !== 0x4b) {
      throw new Error(`图表数据保存下载无效：${JSON.stringify(chartDownload)}`);
    }
    await evaluate(`(() => {
      const remove = () => document.querySelector('[data-chart-grid="category"] thead th:nth-child(2) button');
      remove()?.click();
    })()`);
    await waitFor(`document.querySelectorAll('[data-chart-grid="category"] thead th').length === 2`, '图表删至一个系列');
    await evaluate(`document.querySelector('[data-chart-grid="category"] thead th:nth-child(2) button')?.click()`);
    await waitFor(`document.querySelectorAll('[data-chart-grid="category"] thead th').length === 1
      && [...document.querySelectorAll('#chartInspector button')]
        .some((button) => button.textContent === '增加系列')`, '图表删空后保留重建入口');
    await evaluate(`[...document.querySelectorAll('#chartInspector button')]
      .find((button) => button.textContent === '增加系列')?.click()`);
    await waitFor(`document.querySelectorAll('[data-chart-grid="category"] thead th').length === 2`, '图表删空后重建系列');
    await evaluate(`(async () => {
      const bytes = await fetch('/fixtures/sample-editor-preset-shape.pptx')
        .then((response) => response.arrayBuffer());
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'sample-editor-preset-shape.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }));
      const input = document.querySelector('#fileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor(`document.querySelector('#fileName')?.textContent === 'sample-editor-preset-shape.pptx'
      && document.querySelectorAll('[data-edit-id]').length >= 60
      && !document.querySelector('#editorApp')?.dataset.loading`, '预设形状固件就绪');
    await click('[data-edit-id]');
    await waitFor(`!document.querySelector('#shapeInspector')?.hidden
      && document.querySelector('#shapePreset')?.value === 'roundRect'`, '预设形状检查器');
    await click('#startShapeAdjustments');
    await waitFor("!!document.querySelector('[data-ppt-preset-handle]')", '预设形状调节柄');
    const switched = await evaluate(`(() => {
      const select = document.querySelector('#shapePreset');
      select.value = 'hexagon';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`);
    await waitFor(`document.querySelector('#shapePreset')?.value === 'hexagon'
      && document.querySelector('#fileName')?.textContent.startsWith('●')
      && !!document.querySelector('[data-ppt-preset-handle]')`, '官网预设形状切换');
    if (switched !== 'hexagon') throw new Error('官网形状类型控件无法选择完整预设目录');
    // 源码薄包服务器只有编辑页；三页完整矩阵由生产入口执行。
    await runSiteLanguagePreferencesContract({ evaluate, click, request, waitFor }, ['editor']);
    const checkedInputFailure = await runSiteEditContextFailureContract({ evaluate, click, request, waitFor }, () => { rejectEditContext = true; });
    if (checkedInputFailure && !rejectedEditContextLoads) throw new Error('未实际触发 EditContext 模块下载失败');
    if (consoleFailures.length) throw new Error(`官网编辑页产生 console warning/error：${consoleFailures.join(' | ')}`);
    await runStandaloneCommentsBrowserContract({ evaluate, request, waitFor, click });
    if (consoleFailures.length) throw new Error(`独立查看器错误：${consoleFailures.join(' | ')}`);
    return { bytes: downloaded.bytes.length, prompt: rejected.prompt };
  } finally {
    socket.terminate();
  }
}

try {
  profile = mkdtempSync(join(tmpdir(), 'web-ppt-site-editor-'));
  const address = await new Promise((resolveAddress, rejectAddress) => {
    server.once('error', rejectAddress);
    server.listen(0, '127.0.0.1', () => resolveAddress(server.address()));
  });
  const url = `http://127.0.0.1:${address.port}${productionBase}/editor.html?lang=zh-CN`;
  const port = await launch(url);
  const result = await runContract(await pageTarget(port, url));
  console.log(chartLegacyOnly ? '旧图表迁移浏览器专项通过（非完整门禁）' : recoveryOnly ? '官网恢复服务专项通过（非完整门禁）' : lifecycleOnly ? '编辑器产品生命周期专项通过（非完整门禁）' : chartSharedOnly ? '共享图表浏览器专项通过（非完整门禁）' : chartHierarchyOnly ? '多级类别浏览器专项通过（非完整门禁）' : pptSaveOnly ? '原生 PPT 浏览器专项通过（非完整门禁）' : portableCopyOnly ? '无来源复制浏览器专项通过（非完整门禁）' : videoOnly ? '视频浏览器专项通过（非完整门禁）' : pdfOnly ? 'PDF 浏览器专项通过（非完整门禁）' : threeDOnly ? '三维浏览器专项通过（非完整门禁）' : metafileOnly ? 'EMF+ 浏览器专项通过（非完整门禁）' : objectEditOnly ? '对象内部编辑浏览器专项通过（非完整门禁）' : chartDesignOnly ? '图表样式浏览器专项通过（非完整门禁）' : commentEditOnly ? '批注编辑浏览器专项通过（非完整门禁）' : resizeOnly ? '页面尺寸浏览器专项通过（非完整门禁）' : productionLanguages ? process.env.SITE_I18N_ONLY
    ? `\n\x1b[32m✓ 官网生产页面中英文专项 ${process.env.SITE_I18N_ONLY} 通过（非完整门禁）\x1b[0m`
    : '\n\x1b[32m✓ 官网三张生产页面完整中英文工作流通过\x1b[0m' : `\n\x1b[32m✓ 官网编辑工具栏、预设形状与 .ppt 转换闭环通过`
    + `（下载 ${result.bytes} bytes）\x1b[0m`);
} finally {
  if (browserRunning()) {
    child.kill('SIGTERM');
    if (!await waitForBrowserExit(2000) && browserRunning()) {
      child.kill('SIGKILL');
      await waitForBrowserExit(2000);
    }
  }
  child?.stderr?.destroy();
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (profile && !browserRunning()) {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
