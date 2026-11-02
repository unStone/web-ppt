import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [
  join(root, 'node_modules/turbo/bin/turbo'), 'run', 'build:packages',
  // --force 与 --cache 互斥；强制构建仍由 turbo.json 禁用远程缓存。
  ...(args.includes('--force') ? [] : ['--cache=local:rw']), ...args,
], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Turbo 不会自动把实际 Node 版本、平台和架构放进缓存键。
    WEB_PPT_BUILD_RUNTIME: `${process.version}/${process.platform}/${process.arch}`,
  },
});
if (result.error) throw result.error;
if (result.status === null) throw new Error(`构建进程被信号终止：${result.signal}`);
process.exitCode = result.status;
