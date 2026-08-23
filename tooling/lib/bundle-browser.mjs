import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let importSequence = 0;

/** 测试统一走浏览器构建参数，避免不同验收器悄悄测试到不同运行时代码。 */
export async function bundleBrowser({ root, entry, output, aliases = [] }) {
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
    ...aliases.map(([from, to]) => `--alias:${from}=${to}`),
    `--outfile=${output}`,
  ], { cwd: root, stdio: 'inherit' });
  return import(`${pathToFileURL(output).href}?run=${process.pid}-${++importSequence}`);
}
