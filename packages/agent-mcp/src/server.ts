import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listAgentTools } from '@web-ppt/edit-core/agent';
import type { AgentRenderInput, AgentToolName } from '@web-ppt/edit-core/agent';
import { AgentMcpSessionManager } from './session';
import { AgentMcpError } from './types';
import type { AgentMcpOptions } from './types';

type JsonObject = Record<string, unknown>;

function sessionSchema(base: JsonObject, extra: 'close' | 'save' | 'render' | 'call'): JsonObject {
  let resolved = base;
  while (typeof resolved.$ref === 'string') {
    const path = resolved.$ref.split('/');
    resolved = path.slice(1).reduce((current, key) => current[key] as JsonObject, base);
  }
  const properties: JsonObject = { ...(resolved.properties as JsonObject | undefined), sessionId: { type: 'string' } };
  if (extra === 'save' || extra === 'render') properties.path = { type: 'string' };
  const required = new Set([...resolved.required as string[] | undefined ?? [], 'sessionId']);
  if (extra === 'save') required.add('path');
  return {
    ...resolved, type: 'object', properties, required: [...required],
    ...(base.definitions ? { definitions: base.definitions } : {}),
  };
}

function toolDefinitions(): JsonObject[] {
  const tools: JsonObject[] = [{
    name: 'ppt_open', description: '打开本地 PPTX / PPT 并创建编辑会话',
    inputSchema: {
      type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false,
    },
  }];
  for (const tool of listAgentTools()) {
    const extra = tool.name === 'save' ? 'save' : tool.name === 'render' ? 'render' : 'call';
    tools.push({
      name: `ppt_${tool.name}`, description: tool.description,
      inputSchema: sessionSchema(tool.inputSchema, extra),
    });
  }
  tools.push({
    name: 'ppt_close', description: '关闭会话并释放文档资源',
    inputSchema: sessionSchema({ type: 'object', additionalProperties: false }, 'close'),
  });
  return tools;
}

function failure(error: unknown) {
  const candidate = error as { reason?: unknown; message?: unknown; commandIndex?: unknown; elementId?: unknown; slideNumber?: unknown };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({
      ok: false,
      error: {
        reason: typeof candidate?.reason === 'string' ? candidate.reason : 'tool-failed',
        message: typeof candidate?.message === 'string' ? candidate.message : String(error),
        commandIndex: typeof candidate?.commandIndex === 'number' ? candidate.commandIndex : null,
        elementId: typeof candidate?.elementId === 'string' ? candidate.elementId : null,
        slideNumber: typeof candidate?.slideNumber === 'number' ? candidate.slideNumber : null,
      },
    }) }],
  };
}

function argumentsOf(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentMcpError('invalid-input', '工具参数必须是对象');
  return value as JsonObject;
}

function sessionIdOf(args: JsonObject): string {
  if (typeof args.sessionId !== 'string' || !args.sessionId) throw new AgentMcpError('invalid-input', 'sessionId 必须是非空字符串');
  return args.sessionId;
}

export function createAgentMcpServer(options: AgentMcpOptions = {}) {
  // 包名解析同时覆盖独立构建块和源码测试 bundle，避免版本随构建或手写常量漂移。
  const packageVersion: unknown = createRequire(import.meta.url)('@web-ppt/agent-mcp/package.json').version;
  if (typeof packageVersion !== 'string' || !packageVersion) {
    throw new Error(`@web-ppt/agent-mcp/package.json version 必须为非空字符串，实际：${JSON.stringify(packageVersion)}`);
  }
  const manager = new AgentMcpSessionManager(options);
  const server = new Server({ name: 'web-ppt-agent', version: packageVersion }, { capabilities: { tools: {} } });
  const tools = toolDefinitions();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const name = request.params.name;
      const args = argumentsOf(request.params.arguments ?? {});
      let value: unknown;
      if (name === 'ppt_open') value = await manager.open(args.path);
      else if (name === 'ppt_close') value = await manager.close(sessionIdOf(args));
      else if (name === 'ppt_save') {
        const result = await manager.save(sessionIdOf(args), args.path);
        if (!result.ok) return failure(result.error);
        const { bytes: _bytes, ...saved } = result.value;
        value = saved;
      } else if (name === 'ppt_render') {
        const { sessionId, path, ...input } = args;
        const result = await manager.render(sessionIdOf(args), input as unknown as AgentRenderInput, path);
        if (!result.ok) return failure(result.error);
        value = result.value;
      } else if (name.startsWith('ppt_')) {
        const tool = name.slice(4) as AgentToolName;
        const { sessionId, ...input } = args;
        const result = await manager.call(sessionIdOf(args), tool, input as never);
        if (!result.ok) return failure(result.error);
        value = result.value;
      } else throw new AgentMcpError('target-not-found', `未知工具：${name}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, value }) }] };
    } catch (error) {
      return failure(error);
    }
  });
  return { server, manager };
}
