/** React/Vue 包的 SSR 导入、服务端渲染、公开入口与排除 peer 后体积契约。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToString as renderReact } from 'react-dom/server';
import { createSSRApp, h } from 'vue';
import { renderToString as renderVue } from '@vue/server-renderer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/framework-adapters');
mkdirSync(out, { recursive: true });
const aliases = [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
  ['@web-ppt/viewer-core', join(root, 'packages/viewer-core/src/index.ts')],
  ['@web-ppt/editor', join(root, 'packages/editor/src/index.ts')],
];
const bundle = (entry, name, framework) => {
  const file = join(out, `${name}.mjs`);
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=node', '--log-level=error',
    `--external:${framework}`, ...aliases.map(([from, to]) => `--alias:${from}=${to}`),
    `--outfile=${file}`,
  ], { cwd: root, stdio: 'inherit' });
  return file;
};
const thinBundle = (entry, name, externals) => {
  const file = join(out, `${name}-thin.mjs`);
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--minify', '--log-level=error',
    ...externals.map((external) => `--external:${external}`), `--outfile=${file}`,
  ], { cwd: root, stdio: 'inherit' });
  return { file, gzip: gzipSync(readFileSync(file)).length };
};

const reactEntry = join(root, 'packages/react/src/index.ts');
const vueEntry = join(root, 'packages/vue/src/index.ts');
const reactFile = bundle(reactEntry, 'react-ssr', 'react');
const vueFile = bundle(vueEntry, 'vue-ssr', 'vue');
const react = await import(`${pathToFileURL(reactFile)}?t=${Date.now()}`);
const vue = await import(`${pathToFileURL(vueFile)}?t=${Date.now()}`);

let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(`${name}${detail ? `：${detail}` : ''}`);
};

const readPackage = (name) => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
const reactPackage = readPackage('react');
const vuePackage = readPackage('vue');
const basePackages = ['core', 'edit-core', 'viewer-core', 'editor'].map(readPackage);
const viewerPackage = readPackage('viewer-core');
check('框架只作为对应适配包的 optional peer',
  reactPackage.peerDependencies?.react && reactPackage.peerDependenciesMeta?.react?.optional === true
    && vuePackage.peerDependencies?.vue && vuePackage.peerDependenciesMeta?.vue?.optional === true
    && !reactPackage.dependencies && !vuePackage.dependencies);
check('基础包没有 React/Vue 运行时依赖', basePackages.every((pkg) => {
  const runtime = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
  return !runtime.react && !runtime['react-dom'] && !runtime.vue;
}));
check('viewer-core peer 下界包含其运行时使用的 core 新导出',
  viewerPackage.peerDependencies?.['@web-ppt/core'] === '^0.4.5');

check('React 入口公开组件、选择窗格与 hook', !!react.WebPptEditor && !!react.WebPptSelectionPane
  && typeof react.useWebPptAdapter === 'function');
check('Vue 入口公开组件、选择窗格与 composable', !!vue.WebPptEditor && !!vue.WebPptSelectionPane
  && typeof vue.useWebPptAdapter === 'function');
const reactMarkup = renderReact(React.createElement(react.WebPptEditor, { mode: 'view' }));
const vueMarkup = await renderVue(createSSRApp({
  render: () => h(vue.WebPptEditor, { mode: 'view' }),
}));
check('React SSR 不访问 window/document', reactMarkup.startsWith('<div'));
check('Vue SSR 不访问 window/document', vueMarkup.startsWith('<div'));

const reactThin = thinBundle(reactEntry, 'react', ['react', '@web-ppt/editor']);
const vueThin = thinBundle(vueEntry, 'vue', ['vue', '@web-ppt/editor']);
check('React 排除 peer 后 gzip 小于 5KB', reactThin.gzip < 5 * 1024, `${reactThin.gzip} bytes`);
check('Vue 排除 peer 后 gzip 小于 5KB', vueThin.gzip < 5 * 1024, `${vueThin.gzip} bytes`);

if (failures.length) {
  console.error(`\n\x1b[31m✗ ${failures.length} 项框架适配包验收失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log(`\n\x1b[32m✓ 框架适配包 ${passed} 项断言通过`
  + `（React ${reactThin.gzip}B / Vue ${vueThin.gzip}B gzip，不含 peer）\x1b[0m`);
