import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from '@typescript/typescript6';

/** 源码分组按执行文件中的声明推导计数，避免漏传报告后 verify 静默跳过。 */
export function expectedCountKeys(root, leaves) {
  const keys = new Set();
  const files = new Set();
  for (const leaf of leaves) {
    if (leaf.executable !== 'node') continue;
    const entry = leaf.args.find((argument) => argument.endsWith('.mjs'));
    if (!entry) continue;
    const file = resolve(root, entry);
    const name = relative(resolve(root), file);
    if (name === '..' || name.startsWith('../')) throw new Error(`计数声明必须来自仓库内的执行文件：${entry}`);
    if (files.has(file)) continue;
    files.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (source.parseDiagnostics.length) {
      const diagnostic = source.parseDiagnostics[0];
      throw new Error(`无法读取 ${entry} 的计数声明：${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    }
    function visit(node) {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && ['recordCount', 'countedAssert'].includes(node.expression.text)
      ) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteralLike(argument) || !argument.text) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          throw new Error(`${entry}:${position.line + 1} 的 ${node.expression.text} 必须使用非空字符串字面量计数键`);
        }
        keys.add(argument.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...keys].sort();
}
