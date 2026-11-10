#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentMcpServer } from './server';
import { localPath } from './files';
import type { AgentMcpOptions } from './types';

interface CliConfig {
  readonly measureModule?: string;
  readonly rasterizerModule?: string;
}

async function injectModule(base: string, value: unknown, exportName: 'measureText' | 'rasterize') {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error(`${exportName} 模块路径必须是非空字符串`);
  const path = localPath(resolve(base, value));
  const module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  if (typeof module[exportName] !== 'function') throw new Error(`${path} 未导出 ${exportName} 函数`);
  return module[exportName];
}

async function optionsFromArgs(args: readonly string[]): Promise<AgentMcpOptions> {
  if (!args.length) return {};
  if (args.length !== 2 || args[0] !== '--config') throw new Error('用法：web-ppt-agent [--config <本地 JSON 文件>]');
  const path = localPath(args[1]);
  const config = JSON.parse(await readFile(path, 'utf8')) as CliConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('CLI 配置必须是 JSON 对象');
  const base = dirname(path);
  return {
    measureText: await injectModule(base, config.measureModule, 'measureText'),
    rasterize: await injectModule(base, config.rasterizerModule, 'rasterize'),
  } as AgentMcpOptions;
}

async function main(): Promise<void> {
  const options = await optionsFromArgs(process.argv.slice(2));
  const { server, manager } = createAgentMcpServer(options);
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void manager.dispose();
  };
  const close = () => {
    void transport.close().finally(() => manager.dispose());
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await server.connect(transport);
  console.error('web-ppt-agent 已通过 stdio 就绪');
}

main().catch((error) => {
  console.error(`web-ppt-agent 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
