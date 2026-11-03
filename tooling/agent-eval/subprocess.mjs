import { spawn, execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopTree(child, graceMs) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode === null && child.signalCode === null) {
      await exec('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    }
    return;
  }
  // 每个 Agent 有自己的进程组，清理不会触及同账号的其他任务。
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (groupExists(child.pid) && Date.now() < deadline) await delay(20);
  if (groupExists(child.pid)) signalGroup(child, 'SIGKILL');
}

export async function executeChild({ command, args, cwd, env = process.env, stdoutPath,
  stderrPath, timeoutMs, graceMs = 2000, signal, input = '', onProgress }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error(`无效 Agent 超时预算：${timeoutMs}`);
  if (!Number.isInteger(graceMs) || graceMs < 0) throw new Error(`无效 Agent 清理预算：${graceMs}`);
  const stdout = await open(stdoutPath, 'wx');
  let stderr;
  try {
    stderr = await open(stderrPath, 'wx');
  } catch (error) {
    await stdout.close();
    throw error;
  }
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let child;
  let timeout;
  let heartbeat;
  let cause;
  let stopping;
  let stdinError;
  let spawnError;
  let exit;
  const requestStop = reason => {
    cause ??= reason;
    stopping ??= stopTree(child, graceMs);
  };
  const abort = () => requestStop('cancelled');
  try {
    child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32',
      stdio: ['pipe', stdout.fd, stderr.fd] });
    const closed = new Promise(resolve => {
      child.once('error', error => { spawnError = error; });
      child.once('close', (exitCode, exitSignal) => resolve({ exitCode, signal: exitSignal }));
    });
    child.stdin.on('error', error => { stdinError = { code: error.code, message: error.message }; });
    child.stdin.end(input);
    timeout = setTimeout(() => requestStop('timeout'), timeoutMs);
    heartbeat = onProgress ? setInterval(() => onProgress({ pid: child.pid, elapsedMs: Date.now() - started }), 30000) : undefined;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    exit = await closed;
    // 成功退出也要收尾已配置的 MCP 子进程，而不是留下后台服务。
    stopping ??= stopTree(child, graceMs);
    await stopping;
    await stdout.sync();
    await stderr.sync();
    return { status: cause ?? (spawnError || exit.exitCode !== 0 ? 'failed' : 'completed'),
      pid: child.pid ?? null, ...exit, startedAt, endedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started, ...(spawnError && { spawnError: { code: spawnError.code, message: spawnError.message } }),
      ...(stdinError && { stdinError }) };
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    signal?.removeEventListener('abort', abort);
    await stdout.close();
    await stderr.close();
  }
}
