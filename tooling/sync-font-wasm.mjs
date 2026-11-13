/**
 * 把 harfbuzzjs 的 hb-subset wasm 同步进 site / viewer 的 public/vendor。
 *
 * 应用源码不能直接 `import ... from '*.wasm?url'`：官网的 WebMCP 测试用 esbuild
 * 打包 site 源码，esbuild 没有 `?url` 语义，vite 专用的导入会把两套构建拆成两种
 * 行为。改成运行时 fetch 一个固定路径 `/vendor/harfbuzz-subset.wasm`，由本脚本在
 * dev / build 前从钉死版本的 node_modules 里拷出（产物不进 git，见 .gitignore）。
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// site / viewer 的构建都以各自包目录为 cwd 调本脚本，而 npm 通常把 harfbuzzjs
// 提升到根 node_modules——按 cwd 拼 node_modules 路径在 CI 上必落空（beta.1 起两次 master 红）。
// 改由 require.resolve 从脚本自身位置出发，沿 Node 解析找到 npm 实际安装的 harfbuzzjs。
const require = createRequire(import.meta.url);
const source = require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
const size = statSync(source).size;
const digest = createHash('sha256').update(String(size)).digest('hex').slice(0, 12);
const targets = [
  resolve(root, 'packages/site/public/vendor/harfbuzz-subset.wasm'),
  resolve(root, 'packages/viewer/public/vendor/harfbuzz-subset.wasm'),
];
for (const target of targets) {
  mkdirSync(resolve(target, '..'), { recursive: true });
  copyFileSync(source, target);
}
console.log(`harfbuzz-subset.wasm 已同步（${size}B ${digest}）→ ${targets.length} 个应用`);
