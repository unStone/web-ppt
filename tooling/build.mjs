import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const allowed = new Set(['--force', '--dry=json', '--summarize', '--help']);
const unknown = args.find(argument => !allowed.has(argument));
if (unknown) throw new Error(`构建参数不受支持：${unknown}；支持 --force、--dry=json、--summarize、--help`);
if (new Set(args).size !== args.length) throw new Error('构建参数不能重复');
if (args.includes('--help')) {
  if (args.length !== 1) throw new Error('--help 必须单独使用');
  console.log('用法：npm run build -- [--force] [--summarize] [--dry=json]\n--force 强制重新构建；--summarize 保存运行摘要；--dry=json 只输出任务与缓存信息');
  process.exit(0);
}

const config = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'));
const outputs = config.tasks?.['//#build:packages']?.outputs;
if (!Array.isArray(outputs) || outputs.length === 0) throw new Error('构建缓存必须声明完整的生成输出');
const removals = outputs.map(output => {
  if (typeof output !== 'string') throw new Error(`构建输出必须是生成路径，收到：${JSON.stringify(output)}`);
  const directory = /^packages\/[a-z0-9]+(?:-[a-z0-9]+)*\/dist\/\*\*$/.test(output);
  const proof = /^out\/[a-z0-9]+(?:-[a-z0-9]+)*\/default-entry-proof\.json$/.test(output);
  if (!directory && !proof) throw new Error(`拒绝清理未约定的生成输出：${output}`);
  const target = resolve(root, directory ? output.slice(0, -3) : output);
  for (let parent = dirname(target); parent !== root; parent = dirname(parent)) {
    if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`拒绝通过符号链接清理生成输出：${parent}`);
    }
  }
  return target;
});
if (!args.includes('--dry=json')) {
  // Turbo 只恢复缓存中已有的文件；先清理生成输出，避免切换构建版本后残留旧 chunk 和声明。
  for (const target of removals) rmSync(target, { recursive: true, force: true });
}
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
