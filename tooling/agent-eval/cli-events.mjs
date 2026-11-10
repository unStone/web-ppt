import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const allowedTools = new Set([
  'ppt_open',
  'ppt_describe',
  'ppt_element',
  'ppt_lint',
  'ppt_render',
  'ppt_edit',
  'ppt_undo',
  'ppt_redo',
  'ppt_save',
  'ppt_close',
]);
const passiveItems = new Set(['reasoning', 'agent_message']);

export async function readJsonl(path) {
  const records = [];
  const errors = [];
  let line = 0;
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const text of reader) {
    line++;
    if (!text.trim()) continue;
    try {
      records.push(JSON.parse(text));
    } catch (error) {
      errors.push({ line, message: error.message });
    }
  }
  return { records, errors };
}

function cliFailure(message) {
  const reason = /\b401\b|unauthorized|authentication|not logged in|log in/i.test(message)
    ? 'agent-authentication-failed'
    : /quota|rate.limit|\b429\b/i.test(message)
      ? 'agent-service-limit'
      : 'agent-service-failed';
  return { category: 'infrastructure', reason, message };
}

function mcpClientFailure(item) {
  // SDK 的 isError 属于工具业务结果，可在后续调用中纠正；CLI error 无结果才是客户端失败。
  if (!item.error || item.result) return null;
  const message = String(item.error.message ?? item.error);
  if (/^MCP error -32602\b/.test(message)) return null;
  const reason = /requires approval|approval policy|approval.*(?:denied|rejected)/i.test(message)
    ? 'mcp-approval-required'
    : /server|connection|transport|unavailable|not available|not connected|timed out|timeout/i.test(message)
      ? 'mcp-service-unavailable'
      : 'mcp-client-failed';
  return { category: 'infrastructure', reason, message, tool: item.tool };
}

export function inspectCliEvents(events, server = 'ppt_eval') {
  const failures = [];
  const usage = [];
  let completedTurns = 0;
  const actualModels = new Set();
  const calls = new Map();
  const seenFailures = new Set();
  const failure = (value) => {
    const key = JSON.stringify(value);
    if (!seenFailures.has(key)) failures.push(value);
    seenFailures.add(key);
  };
  for (const event of events) {
    if (typeof event.model === 'string') actualModels.add(event.model);
    if (event.type === 'turn.completed') {
      completedTurns++;
      if (event.usage) usage.push(event.usage);
    }
    if (event.type === 'error') failure(cliFailure(String(event.message ?? 'Agent 返回无消息错误')));
    if (event.type === 'turn.failed') failure(cliFailure(String(event.error?.message ?? event.error ?? 'Agent turn 失败')));
    const item = event.item;
    if (!item || passiveItems.has(item.type)) continue;
    if (typeof item.model === 'string') actualModels.add(item.model);
    if (item.type === 'mcp_tool_call') {
      calls.set(item.id ?? `${calls.size}`, item);
      if (item.server !== server || !allowedTools.has(item.tool)) {
        failure({ category: 'protocol', reason: 'non-evaluation-tool-call', tool: `${item.server}/${item.tool}` });
      }
      const clientFailure = mcpClientFailure(item);
      if (clientFailure) failure(clientFailure);
    } else {
      failure({ category: 'protocol', reason: 'non-evaluation-tool-call', tool: String(item.type) });
    }
  }
  return { failures, usage, completedTurns, actualModels: [...actualModels], calls: [...calls.values()] };
}
