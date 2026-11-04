import {
  AgentMcpSessionManager, AgentMcpError, createAgentMcpServer,
  type AgentMcpOptions, type AgentMcpRenderResult, type AgentMcpSaveResult,
} from '@web-ppt/agent-mcp';
import type { LayoutLintReport } from '@web-ppt/edit-core/lint';
import type { PresentationDescription } from '@web-ppt/edit-core/describe';

export async function mcpContract(path: string, options: AgentMcpOptions): Promise<void> {
  const { manager, server } = createAgentMcpServer(options);
  const opened = await manager.open(path);
  const id: string = opened.sessionId;
  const description = await manager.call(id, 'describe', { maxChars: 8_000 });
  if (description.ok) {
    const value: PresentationDescription = description.value;
    void value;
  } else {
    const reason: string = description.error.reason;
    void reason;
  }
  const lint = await manager.call(id, 'lint', { checks: ['off-canvas'] });
  if (lint.ok) {
    const value: LayoutLintReport = lint.value;
    void value;
  }
  const saved: AgentMcpSaveResult = await manager.save(id, path);
  const rendered: AgentMcpRenderResult = await manager.render(id, { slideNumber: 1, format: 'svg' });
  if (saved.ok) {
    const destination: string = saved.value.path;
    const bytes: string = saved.value.bytes;
    void [destination, bytes];
  }
  if (rendered.ok) {
    const destination: string | undefined = rendered.value.path;
    const format: 'svg' | 'png' = rendered.value.format;
    void [destination, format];
  }
  const closed: { readonly closed: true } = await manager.close(id);
  void closed;
  await manager.dispose();
  await server.close();
}

export function mcpFailures(manager: AgentMcpSessionManager): void {
  // @ts-expect-error 本机服务只转发已公开的工具名。
  void manager.call('session', 'unknown-tool', {});
  // @ts-expect-error 渲染工具当前只交付 SVG 与 PNG。
  void manager.call('session', 'render', { slideNumber: 1, format: 'jpeg' });
  // @ts-expect-error JSON 传输不改变数值预算的类型。
  void manager.call('session', 'describe', { maxChars: '8000' });
  // @ts-expect-error 通用 save 工具没有路径参数；文件路径由 manager.save 接收。
  void manager.call('session', 'save', { path: '/deck.pptx' });
  // @ts-expect-error MCP 管理器独占会话身份前缀。
  const options: AgentMcpOptions = { idPrefix: 'host-' };
  void options;
}

export function mcpErrorContract(error: AgentMcpError): string {
  return error.reason;
}
