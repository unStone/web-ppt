import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { sourceAliasArgs } from './lib/bundle-browser.mjs';
import { withChartBrowser } from './lib/chart-browser-lab.mjs';
import { recordCount } from './lib/measured.mjs';

const root = resolve(import.meta.dirname, '..');
const mutation = process.argv.includes('--mutation-no-registration');
const out = join(root, mutation ? 'out/site-webmcp-mutation' : 'out/site-webmcp');
mkdirSync(out, { recursive: true });
execFileSync(
  'npx',
  [
    'esbuild',
    join(root, 'tooling/lib/site-webmcp-browser.mjs'),
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--splitting',
    '--log-level=error',
    ...(mutation ? ['--define:document.modelContext=undefined'] : []),
    ...sourceAliasArgs(root),
    `--outdir=${join(out, 'browser')}`,
    `--metafile=${join(out, 'meta.json')}`,
  ],
  { cwd: root, stdio: 'inherit' },
);
const metadata = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
const webMcpChunks = Object.entries(metadata.outputs)
  .filter(([, output]) => Object.keys(output.inputs).some((input) => input.endsWith('packages/site/src/editor-webmcp-plugin.ts')))
  .map(([path]) => basename(path));
// 禁用检测的变异会被 tree-shaking 删去整块；继续执行行为断言，验证缺注册确实被发现。
if (!mutation) assert.equal(webMcpChunks.length, 1, 'WebMCP 必须独占按需代码块');
await withChartBrowser(root, async (browser) => {
  await browser.evaluate(`(async () => {
    const html = await fetch('/packages/site/editor.html').then(response => response.text());
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script').forEach(script => script.remove());
    document.documentElement.lang = 'zh-CN';
    document.head.append(parsed.querySelector('link[rel="canonical"]'));
    document.body.innerHTML = parsed.body.innerHTML;
    document.querySelector('#canvasMount').style.cssText = 'width:640px;height:360px';
    document.querySelector('#objectList').style.cssText = 'width:240px;height:360px';
  })()`);
  const result = await browser.evaluate(`import('/out/${basename(out)}/browser/site-webmcp-browser.js')
    .then(api => api.runWebMcpContract())`);
  assert.equal(result.ok, true);
  assert(result.assertions > 30);
  assert(
    !result.unsupportedResources.some((url) => webMcpChunks.some((chunk) => url.endsWith(`/${chunk}`))),
    '不支持 WebMCP 时不得加载插件代码',
  );
  writeFileSync(join(out, 'browser-contract.json'), `${JSON.stringify({ ...result, browser: browser.version }, null, 2)}\n`);
  recordCount('siteWebMcp', result.assertions);
  console.log(`编辑器 WebMCP 通过 ${result.assertions} 项浏览器断言；原生 API：${result.nativeApi}`);
});
