/**
 * 分层依赖方向审计：把 architecture-rules.md 里机械可判定的规则变成门禁。
 *
 * 现有边界审计（check-template-boundary 等）守的是单个能力的产物位置，这里守的是
 * 整个仓库的分层不变量——它们一旦破坏，代价是隐性的：render 认识了文件格式，
 * 下一个输入格式就得改渲染层；geometry 依赖了别的模块，两条解析链路就不再共享
 * 同一个格式无关的公共层。规则与 docs/architecture-rules.md 一一对应。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const walk = function* (dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.endsWith('.ts')) yield path;
  }
};
const rel = (path) => relative(root, path);

// ① render 只依赖 types 与同目录：渲染层不认识任何文件格式，加新输入格式不动它一行
for (const file of walk(join(root, 'packages/core/src/render'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
    if (m[1] !== '../types' && !m[1].startsWith('./')) {
      problems.push(`render 依赖越界：${rel(file)} import '${m[1]}'（只允许 ../types 与同目录）`);
    }
  }
}

// ② geometry 零外部依赖：ECMA-376 形状求值是两条解析链路共享的纯数学层，相对引用不得越出本目录
const geometryDir = join(root, 'packages/core/src/geometry');
for (const file of walk(geometryDir)) {
  for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      const resolved = normalize(join(dirname(file), spec));
      if (!resolved.startsWith(geometryDir)) {
        problems.push(`geometry 依赖越界：${rel(file)} import '${spec}'（解析后出了 geometry/）`);
      }
    } else {
      problems.push(`geometry 存在外部依赖：${rel(file)} import '${spec}'（该层必须零 import）`);
    }
  }
}

// ③ core 的浏览器 DOM 只允许出现在按需导出入口与带回退的探测：解析 + 渲染路径必须能整包进 Worker。
// xml.ts 与 text-measure.ts 是运行时探测回退（typeof 探测 + null 回退），Worker 安全，与 browser-export 的无条件使用不同类
const DOM_ALLOWED = new Set([
  'packages/core/src/browser-export.ts',
  'packages/core/src/pdf/vector-browser.ts',
  'packages/core/src/pdf/vector-image-browser.ts',
  'packages/core/src/xml.ts',
  'packages/core/src/render/text-measure.ts',
]);
const DOM_PATTERN = /document\.(createElement|implementation|body|getElementById|querySelector|createTextNode)|window\.|new Image\b|requestAnimationFrame|new DOMParser|new XMLSerializer|navigator\./;
for (const file of walk(join(root, 'packages/core/src'))) {
  if (DOM_ALLOWED.has(rel(file))) continue;
  if (DOM_PATTERN.test(readFileSync(file, 'utf8'))) {
    problems.push(`core 出现浏览器 DOM API：${rel(file)}（白名单见 check-architecture-boundary.mjs）`);
  }
}

// ④ 包依赖单向：发布包只 import 自己声明的 deps/peer（含自身），viewer/site 不被任何包反向依赖
const packageDirs = readdirSync(join(root, 'packages')).filter((n) =>
  existsSync(join(root, 'packages', n, 'package.json')));
const privateNames = new Set();
for (const name of packageDirs) {
  if (JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')).private) {
    privateNames.add(JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')).name);
  }
}
for (const name of packageDirs) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  const allowed = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})]);
  const srcDir = join(root, 'packages', name, 'src');
  if (!existsSync(srcDir)) continue;
  for (const file of walk(srcDir)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/from '(@web-ppt\/[\w-]+)'/g)) {
      if (privateNames.has(m[1])) {
        problems.push(`反向依赖私有包：${rel(file)} import '${m[1]}'`);
      } else if (!allowed.has(m[1])) {
        problems.push(`未声明的包依赖：${rel(file)} import '${m[1]}'（不在 ${manifest.name} 的 deps/peer 里）`);
      }
    }
  }
}

if (problems.length) {
  console.error(`\x1b[31m✗ 分层依赖审计失败（${problems.length} 项）\x1b[0m`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log('✓ 分层依赖审计通过（render 白名单 / geometry 零依赖 / DOM 边界 / 包依赖单向）');
