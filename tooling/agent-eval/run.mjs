import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExperiment } from './experiment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const options = { repoRoot: root };
const fields = { '--output': 'directory', '--export': 'exportDirectory', '--model': 'model',
  '--effort': 'effort', '--codex-bin': 'codexBin', '--timeout-ms': 'timeoutMs',
  '--max-calls': 'maxCalls', '--repetitions': 'repetitions', '--task': 'taskIds' };
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  const key = fields[flag];
  if (!key || !process.argv[index + 1]) throw new Error(`无效参数：${flag}`);
  const value = process.argv[++index];
  if (key === 'taskIds') (options.taskIds ??= []).push(value);
  else if (['timeoutMs', 'maxCalls', 'repetitions'].includes(key)) options[key] = Number(value);
  else options[key] = value;
}
if (!options.directory) throw new Error('此命令会调用真实模型。用法：node tooling/agent-eval/run.mjs --output out/agent-eval/<新目录> [--export tooling/agent-eval/records/<新目录>] [--model ... --effort ...]');
await mkdir(dirname(resolve(options.directory)), { recursive: true });
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
try {
  const report = await runExperiment({ ...options, signal: controller.signal });
  console.log(JSON.stringify(report.summary, null, 2));
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
