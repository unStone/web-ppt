import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, [
  join(root, 'node_modules/turbo/bin/turbo'), 'run', 'build:packages',
  '--cache=local:rw', ...process.argv.slice(2),
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
