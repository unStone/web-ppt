import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { sourceAliasArgs } from './lib/bundle-browser.mjs';
import { withChartBrowser } from './lib/chart-browser-lab.mjs';
import { recordCount } from './lib/measured.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/template-fill');
const dist = process.argv.includes('--dist');
const suffix = dist ? '-dist' : '';
const runtime = join(out, `browser-runtime${suffix}.mjs`);
const metadataFile = join(out, `browser-meta${suffix}.json`);
mkdirSync(out, { recursive: true });
execFileSync('npx', ['esbuild', join(root, 'tooling/lib/template-fill-browser.mjs'),
  '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
  ...(dist ? [`--tsconfig=${join(root, 'tooling/tsconfig.template-fill-dist.json')}`]
    : sourceAliasArgs(root, [['@web-ppt/edit-core/fill', join(root, 'packages/edit-core/src/fill/index.ts')]])),
  `--outfile=${runtime}`, `--metafile=${metadataFile}`], { cwd: root, stdio: 'inherit' });
const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
if (dist) {
  assert(!Object.keys(metadata.inputs).some(path => /packages\/[^/]+\/src\//.test(path)),
    '发布浏览器验收不能混入工作区源码');
} else {
  assert(Object.keys(metadata.inputs).some(path => path.endsWith('packages/edit-core/src/fill/index.ts')),
    '源码浏览器验收必须包含当前填充入口');
}

const external = process.env.TEMPLATE_FILL_EXTERNAL;
const externalCopy = join(out, 'browser-external-template.pptx');
if (external) {
  assert(existsSync(external), `外部模板不存在：${external}`);
  copyFileSync(external, externalCopy);
}
const report = await withChartBrowser(root, async browser => {
  const result = await browser.evaluate(`import('/out/template-fill/${basename(runtime)}')
    .then(api => api.runTemplateFillBrowserContract(${JSON.stringify(external ? '/out/template-fill/browser-external-template.pptx' : null)}))`);
  assert.equal(result.ok, true);
  assert(result.assertions > 20);
  assert.deepEqual(result.checks, ['text-overflow', 'element-overlap', 'off-canvas', 'low-contrast',
    'missing-font', 'placeholder-prompt-left', 'image-distorted']);
  for (const [name, artifact] of Object.entries(result.artifacts)) {
    writeFileSync(join(out, `browser-${name}${suffix}.pptx`), Buffer.from(artifact.base64, 'base64'));
    delete artifact.base64;
  }
  return { ...result, browser: browser.version, mode: dist ? 'dist' : 'source' };
});
writeFileSync(join(out, `browser-report${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
recordCount('templateFillBrowser', report.businessAssertions + 4);
console.log(`模板填充七项真实浏览器 lint 通过 ${report.assertions + 4} 项断言（${dist ? '发布产物' : '源码'}）`);
if (report.external) console.log(`外部模板完整七项零问题且原生设计真实修复通过`);
