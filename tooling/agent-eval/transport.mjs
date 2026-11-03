import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EvaluationHostError } from './paths.mjs';

const automaticTools = new Set(['ppt_edit', 'ppt_undo', 'ppt_redo']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function toolPayload(message) {
  const result = message.result;
  if (!object(result) || !Array.isArray(result.content) || result.content.length !== 1
    || result.content[0].type !== 'text' || typeof result.content[0].text !== 'string') {
    throw new EvaluationHostError('eval-invalid-response', '生产 MCP 工具返回值不是唯一 JSON 文本');
  }
  const payload = JSON.parse(result.content[0].text);
  if (!object(payload) || typeof payload.ok !== 'boolean') {
    throw new EvaluationHostError('eval-invalid-response', '生产 MCP 工具返回值缺少 ok 状态');
  }
  return payload;
}

function failure(request, error) {
  return { jsonrpc: '2.0', id: request.id, result: { isError: true,
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: {
      reason: error.reason, message: error.message, commandIndex: null, elementId: null, slideNumber: null,
    } }) }] } };
}

export function createEvaluationTransport(base, { config, policy, log, onFatal, onCallLimit }) {
  const pending = new Map();
  let callCount = 0;
  let input = Promise.resolve();
  let output = Promise.resolve();
  let closed = false;
  let accepting = true;
  let baseClosed = false;
  let fatal = false;
  const context = request => ({ callIndex: request?.callIndex ?? null, toolName: request?.toolName ?? null });
  const reportFatal = error => {
    if (fatal) return;
    fatal = true;
    transport.onerror?.(error);
    onFatal(error);
  };
  const transport = {
    onmessage: undefined, onerror: undefined, onclose: undefined,
    get callCount() { return callCount; },
    get pendingCount() { return pending.size; },
    stopInput() { accepting = false; },
    drainInput() { return input; },
    async settleResponses() {
      const deadline = Date.now() + 3000;
      while (!baseClosed && [...pending.values()].some(request => !request.cancelled)) {
        if (Date.now() >= deadline) {
          throw new EvaluationHostError('eval-shutdown-timeout', '评测 host 关闭时仍有未完成的生产工具回复');
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    },
    async start() {
      base.onerror = error => reportFatal(error);
      base.onclose = () => { baseClosed = true; transport.onclose?.(); };
      base.onmessage = (message, extra) => {
        if (!accepting) return;
        input = input.then(async () => {
          if (closed || fatal) return;
          let request;
          if (message.method === 'tools/call' && Object.hasOwn(message, 'id')) {
            request = { callIndex: ++callCount, toolName: message.params?.name };
            pending.set(message.id, request);
          }
          if (message.method === 'notifications/cancelled') {
            const cancelled = pending.get(message.params?.requestId);
            if (cancelled) cancelled.cancelled = true;
          }
          await log.write({ direction: 'client-to-server', ...context(request),
            original: message, delivered: message });
          if (request) {
            try {
              if (callCount > config.maxCalls) {
                throw new EvaluationHostError('eval-call-limit', `本次工具调用 ${callCount} 超过预算 ${config.maxCalls}`);
              }
              await policy.validate(request.toolName, message.params?.arguments ?? {});
            } catch (error) {
              if (!(error instanceof EvaluationHostError)) throw error;
              await transport.send(failure(message, error));
              if (error.reason === 'eval-call-limit') queueMicrotask(onCallLimit);
              return;
            }
          }
          transport.onmessage?.(message, extra);
        });
        void input.catch(reportFatal);
      };
      await base.start();
    },
    send(message, options) {
      output = output.then(async () => {
        if (closed) throw new EvaluationHostError('eval-transport-closed', '不能向已关闭的评测连接发送消息');
        const request = Object.hasOwn(message, 'id') ? pending.get(message.id) : undefined;
        const original = structuredClone(message);
        const delivered = structuredClone(message);
        let removedAutomaticLint = false;
        let savedFile;
        if (request?.toolName && Object.hasOwn(message, 'result')) {
          const payload = toolPayload(delivered);
          if (!delivered.result.isError && payload.ok && automaticTools.has(request.toolName)
            && config.condition === 'without-lint' && object(payload.value)
            && Object.hasOwn(payload.value, 'lint')) {
            delete payload.value.lint;
            delivered.result.content[0].text = JSON.stringify(payload);
            if (object(delivered.result.structuredContent) && delivered.result.structuredContent.ok === true
              && object(delivered.result.structuredContent.value)) {
              delete delivered.result.structuredContent.value.lint;
            }
            removedAutomaticLint = true;
          }
          if (request.toolName === 'ppt_save' && !delivered.result.isError && payload.ok) {
            const path = await policy.savedPath(payload.value?.path);
            const bytes = await readFile(path);
            savedFile = { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
          }
        }
        await log.write({ direction: 'server-to-client', ...context(request), original, delivered,
          removedAutomaticLint, ...(savedFile && { savedFile }) });
        await base.send(delivered, options);
        if (Object.hasOwn(message, 'id') && !Object.hasOwn(message, 'method')) pending.delete(message.id);
      });
      void output.catch(reportFatal);
      return output;
    },
    async close() {
      if (closed) return;
      try {
        await input;
        await output;
      } finally {
        closed = true;
        await base.close();
      }
    },
  };
  return transport;
}
