import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import ts from 'typescript';

let importSequence = 0;

export function sourceAliasArgs(root, aliases) {
  const configured = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile).config;
  const paths = configured?.compilerOptions?.paths ?? {};
  aliases ??= Object.entries(paths).map(([name, targets]) => [name, resolve(root, targets[0])]);
  const exact = new Map(aliases);
  // esbuild 的根包 alias 会吞掉所有子路径；按源码测试时必须先补齐公开按需入口。
  for (const [name, targets] of Object.entries(paths)) {
    if (!exact.has(name) && aliases.some(([prefix, target]) => name.startsWith(`${prefix}/`)
      && paths[prefix] && resolve(root, paths[prefix][0]) === resolve(target))) {
      exact.set(name, resolve(root, targets[0]));
    }
  }
  return [...exact].map(([from, to]) => `--alias:${from}=${to}`);
}

/** 测试统一走浏览器构建参数，避免不同验收器悄悄测试到不同运行时代码。 */
export async function bundleBrowser({ root, entry, output, aliases = [] }) {
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
    ...sourceAliasArgs(root, aliases),
    `--outfile=${output}`,
  ], { cwd: root, stdio: 'inherit' });
  return import(`${pathToFileURL(output).href}?run=${process.pid}-${++importSequence}`);
}
