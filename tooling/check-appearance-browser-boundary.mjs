import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const entries = {
  '@web-ppt/core/modern-charts': 'packages/core/dist/modern-charts.js',
  '@web-ppt/edit-core/appearance': 'packages/edit-core/dist/appearance.js',
  '@web-ppt/editor/accessibility': 'packages/editor/dist/accessibility.js',
  '@web-ppt/editor/edit-context': 'packages/editor/dist/edit-context.js',
};
const main = await build({ stdin: { contents: "export * from '@web-ppt/editor';", resolveDir: process.cwd() },
  bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
assert(!Object.keys(main.metafile.inputs).some((file) => /\/(appearance|accessibility|edit-context|modern-charts)\.js$/.test(file)),
  '默认编辑器不得加载外观、AT 或 EditContext 扩展');
for (const [entry, path] of Object.entries(entries)) {
  const bytes = readFileSync(path);
  const result = await build({ stdin: { contents: `export * from '${entry}';`, resolveDir: process.cwd() },
    bundle: true, platform: 'browser', format: 'esm', write: false });
  assert(result.outputFiles[0].contents.length > 0, `${entry} 必须经包 exports 可构建`);
  console.log(`可选入口 ${entry}: ${bytes.length}B / ${gzipSync(bytes).length}B gzip`);
}
