import { readFile } from 'node:fs/promises';
import { openAgentSession } from '@web-ppt/edit-core/agent';
import { disposeOpcPackage } from '@web-ppt/edit-core/opc';
import { serializeEditDoc } from '@web-ppt/edit-core/save';
import type { AgentSession, AgentToolName, AgentToolInput, AgentToolResult, AgentRenderInput } from '@web-ppt/edit-core/agent';
import { atomicWrite, localPath } from './files';
import { AgentMcpError } from './types';
import type { AgentMcpOpenResult, AgentMcpOptions, AgentMcpRenderResult, AgentMcpSaveResult } from './types';

interface SessionEntry {
  readonly session: AgentSession;
  readonly controller: AbortController;
  queue: Promise<void>;
  closing: boolean;
}

export class AgentMcpSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private sequence = 0;
  private active = true;

  constructor(private readonly options: AgentMcpOptions = {}) {}

  async open(pathInput: unknown): Promise<AgentMcpOpenResult> {
    this.assertActive();
    const path = localPath(pathInput);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      throw new AgentMcpError('open-failed', `读取 ${path} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const sessionId = `session-${++this.sequence}`;
    const controller = new AbortController();
    let session: AgentSession;
    try {
      session = await openAgentSession(bytes, {
        ...this.options,
        idPrefix: `mcp-${sessionId}-`,
        lint: { ...this.options.lint, signal: controller.signal },
      });
    } catch (error) {
      throw new AgentMcpError('open-failed', `打开 ${path} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!this.active) {
      session.dispose();
      throw new AgentMcpError('session-disposed', '会话管理器已经释放');
    }
    this.sessions.set(sessionId, { session, controller, queue: Promise.resolve(), closing: false });
    return { sessionId, path };
  }

  async call<T extends AgentToolName>(sessionId: string, name: T, input: AgentToolInput<T>): Promise<AgentToolResult<T>> {
    return this.run(sessionId, (session) => session.call(name, input));
  }

  async save(sessionId: string, pathInput: unknown): Promise<AgentMcpSaveResult> {
    const path = localPath(pathInput);
    return this.run(sessionId, async (session) => {
      const { editor, doc } = session;
      const confirm = editor.captureSavepoint();
      const saveMode = doc.package && !doc.package.disposed ? 'patch' : 'generated';
      const result = await serializeEditDoc(doc);
      if (result.package !== doc.package) disposeOpcPackage(result.package);
      await atomicWrite(path, result.bytes);
      confirm();
      return {
        ok: true,
        value: {
          bytes: Buffer.from(result.bytes).toString('base64'),
          path,
          saveMode,
          packageMode: result.mode,
          fallbackReason: result.fallbackReason,
          preservedEntries: result.preservedEntries,
          rewrittenEntries: result.rewrittenEntries,
        },
      };
    });
  }

  async render(sessionId: string, input: AgentRenderInput, pathInput?: unknown): Promise<AgentMcpRenderResult> {
    const path = pathInput === undefined ? undefined : localPath(pathInput);
    return this.run(sessionId, async (session) => {
      const result = await session.call('render', input);
      if (!result.ok || path === undefined) return result;
      const bytes = result.value.format === 'svg' ? new TextEncoder().encode(result.value.data) : Buffer.from(result.value.data, 'base64');
      await atomicWrite(path, bytes);
      return { ok: true, value: { ...result.value, path } };
    });
  }

  async close(sessionId: string): Promise<{ readonly closed: true }> {
    const entry = this.entry(sessionId);
    entry.closing = true;
    entry.controller.abort();
    const closing = entry.queue.then(() => {
      entry.session.dispose();
      this.sessions.delete(sessionId);
      return { closed: true as const };
    });
    entry.queue = closing.then(
      () => undefined,
      () => undefined,
    );
    return closing;
  }

  async dispose(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    const entries = [...this.sessions.values()];
    for (const entry of entries) {
      entry.closing = true;
      entry.controller.abort();
    }
    await Promise.allSettled(entries.map((entry) => entry.queue));
    for (const entry of entries) entry.session.dispose();
    this.sessions.clear();
  }

  private entry(sessionId: string): SessionEntry {
    this.assertActive();
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.closing) throw new AgentMcpError('target-not-found', `找不到打开的会话：${sessionId}`);
    return entry;
  }

  private run<T>(sessionId: string, action: (session: AgentSession) => Promise<T>): Promise<T> {
    const entry = this.entry(sessionId);
    const result = entry.queue.then(() => {
      if (!this.active || entry.closing) throw new AgentMcpError('session-disposed', `会话已经关闭：${sessionId}`);
      return action(entry.session);
    });
    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertActive(): void {
    if (!this.active) throw new AgentMcpError('session-disposed', '会话管理器已经释放');
  }
}
