import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentMcpServer } from '@web-ppt/agent-mcp';
import { createPathPolicy } from './paths.mjs';
import { createProtocolLog } from './protocol-log.mjs';
import { createEvaluationTransport } from './transport.mjs';
import { createRuntime } from './runtime.mjs';

export async function startEvaluationHost(config, { transport: base = new StdioServerTransport() } = {}) {
  const policy = await createPathPolicy(config);
  const runtime = await createRuntime();
  const log = await createProtocolLog(policy.protocolPath);
  let production;
  try {
    production = createAgentMcpServer({ measureText: runtime.measureText, rasterize: runtime.rasterize, lint: runtime.lint });
  } catch (error) {
    await log.close();
    throw error;
  }
  const { server, manager } = production;
  let shutdown;
  let resolveClosed;
  const closed = new Promise((resolveResult) => {
    resolveClosed = resolveResult;
  });
  let transport;
  const close = (reason, cause) => {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      const failures = cause ? [cause] : [];
      const record = (event, extra = {}) =>
        log.write({
          direction: 'lifecycle',
          event,
          reason,
          callIndex: null,
          toolName: null,
          callCount: transport?.callCount ?? 0,
          pending: transport?.pendingCount ?? 0,
          ...extra,
        });
      let fatalRecorded = false;
      if (cause || reason === 'call-budget-exceeded') {
        try {
          await record('fatal', cause ? { error: cause.message } : {});
          fatalRecorded = true;
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await record('closing');
      } catch (error) {
        failures.push(error);
      }
      transport?.stopInput();
      try {
        await transport?.drainInput();
      } catch (error) {
        failures.push(error);
      }
      // manager 先取消并等待文稿工作，transport 才能排空真实回复并停止接收。
      try {
        await manager.dispose();
      } catch (error) {
        failures.push(error);
      }
      if (!cause) {
        try {
          await transport?.settleResponses();
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await server.close();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length && !fatalRecorded) {
        try {
          await record('fatal', { error: failures.map((error) => error.message).join('; ') });
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await record('closed', failures.length ? { error: failures.map((error) => error.message).join('; ') } : {});
      } catch (error) {
        failures.push(error);
      }
      try {
        await log.close();
      } catch (error) {
        failures.push(error);
      }
      const result = {
        reason,
        callCount: transport?.callCount ?? 0,
        ...(failures.length && { error: failures.map((error) => error.message).join('; ') }),
      };
      resolveClosed(result);
      if (failures.length) throw new AggregateError(failures, `评测 host 关闭失败：${reason}`);
      return result;
    })();
    return shutdown;
  };
  const reportCloseError = (error) => console.error(error instanceof Error ? error.stack : String(error));
  transport = createEvaluationTransport(base, {
    config,
    policy,
    log,
    onFatal: (error) => {
      void close('fatal', error).catch(reportCloseError);
    },
    onCallLimit: () => {
      void close('call-budget-exceeded').catch(reportCloseError);
    },
  });
  transport.onclose = () => {
    void close('transport-close').catch(reportCloseError);
  };
  process.chdir(policy.workspace);
  try {
    await server.connect(transport);
    await log.write({
      direction: 'lifecycle',
      event: 'ready',
      callIndex: null,
      toolName: null,
      condition: config.condition,
      callCount: 0,
      manifest: runtime.manifest,
    });
  } catch (error) {
    await close('startup-failed', error);
    throw error;
  }
  return { close, closed, server, manager, policy, transport };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--config') throw new Error('用法：node host.mjs --config <本次 JSON 配置>');
  const config = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
  const host = await startEvaluationHost(config);
  const finish = (reason) => {
    void host.close(reason).catch((error) => {
      console.error(error.stack ?? String(error));
      process.exitCode = 1;
    });
  };
  process.stdin.once('end', () => finish('EOF'));
  process.once('SIGINT', () => finish('SIGINT'));
  process.once('SIGTERM', () => finish('SIGTERM'));
  console.error('evaluation host ready');
  const result = await host.closed;
  if (result.error) throw new Error(result.error);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  });
}
