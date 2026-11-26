/**
 * 发布声明文件的相对导入必须解析到 .d.ts，并且在三种模块解析下都成立。
 *
 * 各包 dist 里同时存在 Vite 产出的入口 X.js 与 tsc 产出的声明目录 X/。bundler 解析下说明符写成 ../X
 * 会先命中 X.js——一个没有类型的 JS 模块，宿主拿到的类型静默退化成 any（不开 skipLibCheck 时报 TS7016）；
 * node16 / nodenext 则按 Node ESM 规则要求相对导入自带扩展名，无扩展名的说明符直接解析失败（TS2834），
 * 开着 skipLibCheck 时同样静默成 any。声明产出后由 fix-dts-import-extensions.mjs 统一补扩展名
 * （目录导入写成 X/index.js），这里按三种解析逐条复核。
 *
 * 源码里同样的写法解析到 X/index.ts，类型检查与测试都看不出问题，只有检查发布产物才能发现。
 * 依赖 dist，必须在 `npm run build` 之后执行。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modes = {
  bundler: { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext },
  node16: { moduleResolution: ts.ModuleResolutionKind.Node16, module: ts.ModuleKind.Node16 },
  nodenext: { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext },
};

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
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')) }))
  .filter(({ manifest }) => !manifest.private);

const failures = [];
let checked = 0;
for (const { dir, manifest } of packages) {
  const dist = join(root, 'packages', dir, 'dist');
  if (!existsSync(dist)) throw new Error(`packages/${dir}/dist 不存在；先运行 npm run build`);
  // 与编译器一致：.d.ts 的模块格式由所在包 package.json 的 type 决定，node16 / nodenext 只在 ESM 下要求扩展名
  const resolutionMode = manifest.type === 'module' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS;
  for (const file of walk(dist)) {
    for (const spec of specifiers(file)) {
      checked++;
      for (const [mode, compiler] of Object.entries(modes)) {
        const resolved = ts.resolveModuleName(spec, file, { ...compiler, allowJs: false }, ts.sys, undefined, undefined, resolutionMode)
          .resolvedModule?.resolvedFileName;
        if (!resolved?.endsWith('.d.ts')) {
          failures.push(`${relative(root, file)}：'${spec}'（${mode}）→ ${resolved ? relative(root, resolved) : '无法解析'}`);
        }
      }
    }
  }
}

if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 处声明文件导入没有解析到 .d.ts\x1b[0m`);
  for (const f of failures) console.error(`  · ${f}`);
  console.error('  声明产出后由 fix-dts-import-extensions.mjs 补扩展名；落不到 .d.ts 的在源码里写全到 ../X/index（原因见本脚本头部注释）');
  process.exit(1);
}
console.log(`\x1b[32m✓ ${packages.length} 个发布包的 ${checked} 处声明相对导入在 bundler / node16 / nodenext 下均解析到 .d.ts\x1b[0m`);
