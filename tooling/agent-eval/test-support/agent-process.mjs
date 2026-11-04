import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode === 'success') {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-external-agent' }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } }));
  console.error('external agent diagnostic');
} else if (mode === 'failure') {
  console.log(JSON.stringify({ type: 'error', message: 'Authentication failed: HTTP 401' }));
  process.exitCode = 1;
} else if (mode === 'hang') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (mode === 'descendant') {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'hang'], { stdio: 'ignore' });
  console.log(JSON.stringify({ descendantPid: child.pid }));
  setInterval(() => {}, 1000);
} else {
  throw new Error(`未知外部进程测试模式：${mode}`);
}
