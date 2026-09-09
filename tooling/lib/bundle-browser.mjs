import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import ts from 'typescript';

let importSequence = 0;

export function sourceAliasArgs(root, aliases) {
  const configured = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile).config;
  const paths = configured?.compilerOptions?.paths ?? {};
  // 源码测试必须覆盖完整工作区依赖图；只映射当前入口的直接依赖，会让深层自引用
  // 悄悄回退到上一次构建遗留的 dist，直到干净 checkout 才暴露失败。
  const exact = new Map(Object.entries(paths)
    .map(([name, targets]) => [name, resolve(root, targets[0])]));
  for (const [name, target] of aliases ?? []) exact.set(name, resolve(target));
  return [...exact].map(([from, to]) => `--alias:${from}=${to}`);
}

/** 测试统一走浏览器构建参数，避免不同验收器悄悄测试到不同运行时代码。 */
export async function bundleBrowser({ root, entry, output, aliases }) {
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
    ...sourceAliasArgs(root, aliases),
    `--outfile=${output}`,
  ], { cwd: root, stdio: 'inherit' });
  return import(`${pathToFileURL(output).href}?run=${process.pid}-${++importSequence}`);
}
