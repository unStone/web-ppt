import { readFileSync } from 'node:fs';
import ts from '@typescript/typescript6';

/** 合并阶段从运行时唯一清单取证；不执行迁移脚本，也不让每个 case 加载 TypeScript。 */
export function readMigrationCaseNames(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fail = (message, node) => {
    const position = node && source.getLineAndCharacterOfPosition(node.getStart(source));
    throw new Error(`${file}${position ? `:${position.line + 1}` : ''} 的迁移契约清单无效：${message}`);
  };
  if (source.parseDiagnostics.length) {
    fail(ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, '\n'));
  }
  const declarations = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) =>
      statement.declarationList.declarations
        .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'cases')
        .map((declaration) => ({ statement, declaration })),
    );
  if (declarations.length !== 1) fail(`要求唯一顶层 const cases，实际找到 ${declarations.length} 个`);
  const { statement, declaration } = declarations[0];
  if (!(statement.declarationList.flags & ts.NodeFlags.Const)) fail('cases 必须使用 const 声明', declaration);
  if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
    fail('cases 必须直接初始化为对象字面量', declaration);
  }
  const names = [];
  const seen = new Set();
  for (const property of declaration.initializer.properties) {
    if (!ts.isPropertyAssignment(property)) fail('仅支持显式属性赋值，不接受 spread、shorthand 或 method', property);
    const key = property.name;
    if (!(ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key))) {
      fail('case 名必须是静态标识符、字符串或数值字面量，不接受 computed 或动态键', key);
    }
    const name = ts.isNumericLiteral(key) ? String(Number(key.text)) : key.text;
    if (!name) fail('case 名不能为空', key);
    if (name === '__proto__') fail('__proto__ 不是对象的自有 case 属性', key);
    if (seen.has(name)) fail(`case 名重复：${name}`, key);
    seen.add(name);
    names.push(name);
  }
  return names;
}
