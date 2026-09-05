/** 与 Vite 共用 HTML 转换器；缺词检查不依赖远程样本库或预先构建整站。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITE_PAGES } from './lib/unique-ids.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/site-i18n');
mkdirSync(out, { recursive: true });
const bundle = join(out, 'build.mjs');
execFileSync('npx', ['esbuild', 'packages/site/i18n-build.ts', '--bundle', '--format=esm',
  '--platform=node', '--packages=external', '--log-level=error', `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
const { siteI18n } = await import(pathToFileURL(bundle).href);
const transform = siteI18n().transformIndexHtml.handler;
for (const page of SITE_PAGES) {
  const html = readFileSync(join(root, 'packages/site', page), 'utf8');
  const chinese = transform(html, { path: page });
  const english = transform(chinese, { path: page.replace('.html', '.en.html') });
  assert.match(english, /<html lang="en">/, `${page} 英文构建`);
  assert.throws(() => transform(html.replace('</body>', '<p>未登记的静态消息</p></body>'), { path: page }), /缺少英文词条/);
}
if (!process.argv.includes('--source-only')) {
  const sentinels = ['Fidelity needs a reference', '纯浏览器渲染 PPT', 'web-ppt:site:language'];
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(?:c|m)?js$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8');
        assert.ok(sentinels.every((sentinel) => !source.includes(sentinel)), `站点词条泄漏到发布包：${path}`);
      }
    }
  }
  const entryPoints = [];
  for (const candidate of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!candidate.isDirectory()) continue;
    const directory = join(root, 'packages', candidate.name);
    if (!existsSync(join(directory, 'package.json'))) continue;
    const entry = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (entry.private) continue;
    inspect(join(directory, 'dist'));
    for (const value of Object.values(entry.exports)) {
      if (typeof value !== 'object' || !value.types) continue;
      const source = join(directory, value.types.replace('./dist/', 'src/').replace(/\.d\.ts$/, '.ts'));
      assert.ok(existsSync(source), `找不到发布入口对应的源码：${source}`);
      entryPoints.push(source);
    }
  }
  const metadata = join(out, 'published.json');
  const args = ['esbuild', '--bundle', '--format=esm', '--platform=browser', '--packages=external', '--log-level=error'];
  const siteRoot = join(root, 'packages/site') + sep;
  const assertBoundary = (path) => {
    const graph = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(Object.keys(graph.inputs).every((file) => !resolve(root, file).startsWith(siteRoot)),
      '发布入口依赖图不能包含站点模块');
    assert.ok(Object.values(graph.inputs).every((module) => module.imports.every((dependency) =>
      !/^@web-ppt\/site(?:\/|$)/.test(dependency.path))), '发布入口不能外置导入站点包');
  };
  execFileSync('npx', [...args, ...entryPoints, '--splitting', `--metafile=${metadata}`, `--outdir=${join(out, 'published')}`], { cwd: root, stdio: 'inherit' });
  assertBoundary(metadata);
  // 只泄漏编辑页目录时不含首页哨兵；用真实构建图证明这类泄漏也会被拒绝。
  const probe = join(out, 'boundary-probe.json');
  execFileSync('npx', [...args, `--metafile=${probe}`, `--outfile=${join(out, 'boundary-probe.js')}`], {
    cwd: root, input: "export { editorMessages } from './packages/site/src/i18n/en-editor.ts';", stdio: ['pipe', 'inherit', 'inherit'],
  });
  assert.throws(() => assertBoundary(probe), /发布入口依赖图不能包含站点模块/);
}
console.log('官网离线词条、参数与静态页面检查通过' + (process.argv.includes('--source-only') ? '' : '，发布包不含站点词条'));
