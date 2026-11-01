import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { AgentMcpError } from './types';

let temporarySequence = 0;

export function localPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentMcpError('invalid-path', '文件路径必须是非空字符串');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new AgentMcpError('invalid-path', `只接受本地文件路径，收到 URL：${value}`);
  }
  return resolve(value);
}

export async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${dirname(path)}/.${basename(path)}.web-ppt-${process.pid}-${++temporarySequence}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw new AgentMcpError('save-failed', `写入 ${path} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
