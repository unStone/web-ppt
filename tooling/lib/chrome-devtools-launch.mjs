import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readDevToolsActivePort(profile) {
  const path = join(profile, 'DevToolsActivePort');
  if (!existsSync(path)) return undefined;
  const port = Number.parseInt(readFileSync(path, 'utf8').split(/\r?\n/, 1)[0], 10);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

export async function waitForDevToolsPort({
  profile,
  isRunning,
  diagnostics = () => '',
  readPort = readDevToolsActivePort,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 30_000,
  intervalMs = 100,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const port = readPort(profile);
    if (port) return port;
    if (!isRunning()) {
      throw new Error(`Chrome 在 DevTools 就绪前退出：${diagnostics().trim() || '无诊断输出'}`);
    }
    await delay(intervalMs);
  }
  throw new Error(`Chrome DevTools 启动超时（${timeoutMs}ms）：${diagnostics().trim() || '无诊断输出'}`);
}
