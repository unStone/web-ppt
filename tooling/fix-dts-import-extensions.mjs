/**
 * 给 tsc 产出的声明文件里的相对导入补上显式扩展名（#74）。
 *
 * 九个发布包都是 `type: module`。源码按 `moduleResolution: bundler` 写无扩展名的相对导入，tsc 原样抄进 .d.ts。
 * bundler 会补全扩展名；`node16` / `nodenext` 按 Node ESM 规则要求相对导入自带扩展名，否则导入解析失败、
 * 导出静默退化成 any（关掉 skipLibCheck 才报 TS2834）。给源码统一写 .js 等于放弃 bundler 解析，所以放在声明产出之后补。
 *
 * 补法以 dist 里实际产出的声明文件为准，不给说明符直接拼 .js：
 *   ./session        → ./session.js               dist/session.d.ts
 *   ./diagram-engine → ./diagram-engine/index.js  dist/diagram-engine/index.d.ts
 * 目录导入必须写到 index：dist 里同名还有 Vite 产出的入口 JS（diagram-engine.js），
 * 拼成 ./diagram-engine.js 会指到那个没有类型的模块（见 check-dts-resolution.mjs）。
 *
 * 不带扩展名却落不到任何 .d.ts 的说明符立即失败：这样的声明交给宿主也解析不了。
 * 已带扩展名的说明符不动。在包目录下运行，改写 dist 下的全部 .d.ts；可重复执行。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import ts from '@typescript/typescript6';

const dist = join(process.cwd(), 'dist');
if (!existsSync(dist)) throw new Error(`${process.cwd()} 下没有 dist；先完成 vite build 与 tsc -p tsconfig.build.json`);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.d.ts') ? [join(dir, entry.name)] : [],
  );

/** 末段是否自带扩展名；`.` 与 `..` 指向目录本身，视为不带 */
const hasExtension = (spec) => {
  const last = spec.split('/').pop();
  return last !== '.' && last !== '..' && last.includes('.');
};

/** 相对说明符指向声明文件时应写成的说明符；落不到 .d.ts 时返回 null */
const declarationSpecifier = (file, spec) => {
  const target = join(dirname(file), spec);
  if (existsSync(`${target}.d.ts`)) return `${spec}.js`;
  if (existsSync(join(target, 'index.d.ts'))) return `${spec.replace(/\/?$/, '/')}index.js`;
  return null;
};

/** 声明文件里全部字符串字面量形式的模块说明符节点（import / export ... from 与 import(...) 类型） */
const moduleSpecifiers = (file) => {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const nodes = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      nodes.push(node.moduleSpecifier);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      nodes.push(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { text, nodes, source };
};

let rewritten = 0;
for (const file of walk(dist)) {
  const { text, nodes, source } = moduleSpecifiers(file);
  const edits = [];
  for (const literal of nodes) {
    const spec = literal.text;
    if (!spec.startsWith('.') || hasExtension(spec)) continue;
    const extended = declarationSpecifier(file, spec);
    if (extended === null) {
      throw new Error(`${relative(process.cwd(), file)} 的相对导入 '${spec}' 在 dist 里没有对应的 .d.ts`);
    }
    const start = literal.getStart(source);
    const end = literal.getEnd();
    // 沿用原说明符的引号
    edits.push([start, end, `${text[start]}${extended}${text[end - 1]}`]);
  }
  if (!edits.length) continue;
  let output = text;
  // 从后往前替换，前面的位置才不会错位
  for (const [start, end, replacement] of edits.reverse()) output = `${output.slice(0, start)}${replacement}${output.slice(end)}`;
  writeFileSync(file, output);
  rewritten += edits.length;
}
console.log(`${basename(process.cwd())}：${rewritten} 处声明导入补上扩展名`);
