/**
 * 发布声明文件的相对导入必须解析到 .d.ts。
 *
 * 各包 dist 里同时存在 Vite 产出的入口 `X.js` 与 tsc 产出的声明目录 `X/`。
 * 声明文件写成 `from '../X'` 时，TypeScript 先命中 `X.js`——一个没有类型的 JS 模块，
 * 宿主拿到的类型静默退化成 any（不开 skipLibCheck 时报 TS7016）。源码里同样的写法
 * 解析到 `X/index.ts`，类型检查与测试都看不出问题，只有检查发布产物才能发现。
 *
 * 修法是源码里写全 `../X/index`，或给推断类型显式标注，让 tsc 不再自行生成 import("../X")。
 * 依赖 dist，必须在 `npm run build` 之后执行。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: false };

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.d.ts') ? [join(dir, entry.name)] : [],
  );

const specifiers = (file) => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      out.push(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      out.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out.filter((spec) => spec.startsWith('.'));
};

const packages = readdirSync(join(root, 'packages'))
  .sort()
  .filter((dir) => existsSync(join(root, 'packages', dir, 'package.json')))
  .filter((dir) => !JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')).private);

const failures = [];
let checked = 0;
for (const dir of packages) {
  const dist = join(root, 'packages', dir, 'dist');
  if (!existsSync(dist)) throw new Error(`packages/${dir}/dist 不存在；先运行 npm run build`);
  for (const file of walk(dist)) {
    for (const spec of specifiers(file)) {
      checked++;
      const resolved = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved?.endsWith('.d.ts')) {
        failures.push(`${relative(root, file)}：'${spec}' → ${resolved ? relative(root, resolved) : '无法解析'}`);
      }
    }
  }
}

if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 处声明文件导入没有解析到 .d.ts\x1b[0m`);
  for (const f of failures) console.error(`  · ${f}`);
  console.error('  源码里写全 ../X/index，或给推断类型显式标注（原因见本脚本头部注释）');
  process.exit(1);
}
console.log(`\x1b[32m✓ ${packages.length} 个发布包的 ${checked} 处声明相对导入均解析到 .d.ts\x1b[0m`);
