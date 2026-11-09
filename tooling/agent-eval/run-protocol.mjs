import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const mutationTools = new Set(['ppt_edit', 'ppt_undo', 'ppt_redo']);
// 名称与字段来自公开 Command union/dispatch；失败的原子批次不计作已执行。
const prohibitedCommands = new Set([
  'RemoveElement',
  'Group',
  'Ungroup',
  'PasteElements',
  'AddShape',
  'AddImage',
  'ReplaceImage',
  'AddTable',
  'AddSlide',
  'MoveSlide',
  'RemoveSlide',
  'DuplicateSlide',
  'AddSection',
  'RenameSection',
  'MoveSection',
  'RemoveSection',
  'InsertRow',
  'InsertColumn',
  'RemoveRow',
  'RemoveColumn',
  'MergeCells',
  'SplitCell',
  'SetTheme',
  'SetMasterTextStyle',
  'SetLayout',
  'SetSlideSize',
  'SetZ',
]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function toolPayloads(message) {
  return (message.result?.content ?? []).filter((block) => block.type === 'text').map((block) => JSON.parse(block.text));
}

function deliveryFor(original, toolName, condition) {
  const expected = structuredClone(original);
  let removed = false;
  if (condition !== 'without-lint' || !mutationTools.has(toolName)) return { expected, removed };
  const result = expected.result;
  if (!result || result.isError) return { expected, removed };
  for (const block of result.content ?? []) {
    if (block.type !== 'text') continue;
    const data = JSON.parse(block.text);
    if (data.ok && data.value && Object.hasOwn(data.value, 'lint')) {
      delete data.value.lint;
      block.text = JSON.stringify(data);
      removed = true;
    }
  }
  if (result.structuredContent?.ok && result.structuredContent.value && Object.hasOwn(result.structuredContent.value, 'lint')) {
    delete result.structuredContent.value.lint;
    removed = true;
  }
  return { expected, removed };
}

export function inspectProtocol(
  records,
  { condition = 'with-lint', outputPath, outputBytes, portableOutputPath, requireLifecycle = false, requireCatalog = false, maxCalls } = {},
) {
  const failures = [];
  const resourceLimits = [];
  const noteCallLimit = (record, source) => {
    const observed = record.callCount ?? record.callIndex;
    if (!Number.isSafeInteger(maxCalls) || !Number.isSafeInteger(observed) || observed <= maxCalls) {
      failures.push({
        category: 'protocol',
        reason: 'resource-limit-unverifiable',
        source,
        sequence: record.sequence,
        callIndex: record.callIndex,
      });
      return;
    }
    const previous = resourceLimits.find((item) => item.kind === 'tool-calls');
    if (previous) {
      previous.observed = Math.max(previous.observed, observed);
      previous.evidence.push({ source, sequence: record.sequence ?? null });
      return;
    }
    resourceLimits.push({
      kind: 'tool-calls',
      reason: 'call-budget-exceeded',
      limit: maxCalls,
      observed,
      evidence: [{ source, sequence: record.sequence ?? null }],
    });
    failures.push({ category: 'resource', reason: 'call-budget-exceeded' });
  };
  const requests = new Map();
  const saves = [];
  const catalogs = [];
  let closed = false;
  let automaticLintRemoved = 0;
  let explicitLintCalls = 0;
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      failures.push({ category: 'protocol', reason: 'invalid-protocol-record' });
      continue;
    }
    if (record.direction === 'lifecycle') {
      if (record.event === 'closed') closed = true;
      if (record.event === 'fatal' && record.reason === 'call-budget-exceeded') noteCallLimit(record, 'host-lifecycle');
      else if (record.event === 'fatal') failures.push({ category: 'infrastructure', reason: record.reason ?? 'mcp-host-fatal' });
      if (record.event === 'closed' && record.error)
        failures.push({ category: 'infrastructure', reason: 'mcp-cleanup-failed', message: record.error });
      continue;
    }
    if (!Object.hasOwn(record, 'original') || !Object.hasOwn(record, 'delivered')) {
      failures.push({ category: 'protocol', reason: 'incomplete-protocol-record', sequence: record.sequence });
      continue;
    }
    const original = record.original;
    if (
      !original
      || typeof original !== 'object'
      || Array.isArray(original)
      || !record.delivered
      || typeof record.delivered !== 'object'
      || Array.isArray(record.delivered)
    ) {
      failures.push({ category: 'protocol', reason: 'invalid-protocol-record' });
      continue;
    }
    if (record.direction === 'client-to-server' && original.method === 'tools/call') {
      requests.set(record.callIndex, original);
      if (record.toolName === 'ppt_lint') explicitLintCalls++;
    }
    if (original.result?.tools) catalogs.push(sha(JSON.stringify(original.result.tools)));
    if (record.direction === 'server-to-client' && record.toolName && original.result) {
      try {
        const payloads = toolPayloads(original);
        if (original.result.isError && payloads.some((payload) => payload.ok === false && payload.error?.reason === 'eval-call-limit')) {
          noteCallLimit(record, 'host-tool-response');
        }
        if (payloads.some((payload) => payload.error?.reason === 'eval-path-not-allowed')) {
          failures.push({ category: 'protocol', reason: 'eval-path-not-allowed', callIndex: record.callIndex });
        }
        if (record.toolName === 'ppt_edit' && !original.result.isError && payloads.some((payload) => payload.ok === true)) {
          const request = requests.get(record.callIndex);
          const commands = request?.params?.arguments?.commands;
          if (!request || request.id !== original.id || !Array.isArray(commands)) {
            failures.push({ category: 'protocol', reason: 'edit-response-unmatched', callIndex: record.callIndex });
          } else {
            for (const command of commands) {
              const hidden = command.type === 'SetElementHidden' && command.hidden === true;
              const slideHidden = command.type === 'SetHidden' && command.v === true;
              if (prohibitedCommands.has(command.type) || hidden || slideHidden) {
                failures.push({
                  category: 'protocol',
                  reason: 'unauthorized-edit-operation',
                  command: command.type,
                  callIndex: record.callIndex,
                });
              }
            }
          }
        }
      } catch (error) {
        failures.push({ category: 'protocol', reason: 'invalid-tool-json', message: error.message });
      }
    }
    if (record.delivered !== undefined) {
      try {
        const { expected, removed } = deliveryFor(original, record.toolName, condition);
        if (!isDeepStrictEqual(expected, record.delivered)) {
          failures.push({ category: 'protocol', reason: 'unexpected-feedback-transformation', callIndex: record.callIndex });
        }
        if (removed) automaticLintRemoved++;
      } catch (error) {
        failures.push({ category: 'protocol', reason: 'invalid-tool-json', message: error.message });
      }
    }
    if (record.direction === 'server-to-client' && record.toolName === 'ppt_save' && record.savedFile) {
      const request = requests.get(record.callIndex);
      if (!request || request.id !== original.id || request.params?.name !== 'ppt_save') {
        failures.push({ category: 'protocol', reason: 'save-response-unmatched' });
        continue;
      }
      let success = false;
      for (const block of original.result?.content ?? []) {
        if (block.type === 'text') {
          try {
            success ||= JSON.parse(block.text).ok === true;
          } catch (error) {
            failures.push({ category: 'protocol', reason: 'invalid-save-json', message: error.message });
          }
        }
      }
      if (success && !original.result?.isError) saves.push(record.savedFile);
    }
  }
  const saved = saves.at(-1);
  if (!saved) failures.push({ category: 'protocol', reason: 'successful-save-unobserved' });
  else if (![outputPath, portableOutputPath].filter(Boolean).includes(saved.path)) {
    failures.push({ category: 'protocol', reason: 'saved-path-mismatch' });
  } else if (outputBytes && (saved.sha256 !== sha(outputBytes) || saved.bytes !== outputBytes.length)) {
    failures.push({ category: 'protocol', reason: 'saved-artifact-hash-mismatch' });
  }
  if (requireLifecycle && !closed) failures.push({ category: 'infrastructure', reason: 'mcp-close-unobserved' });
  if (requireCatalog && catalogs.length === 0) failures.push({ category: 'protocol', reason: 'tool-catalog-unobserved' });
  if (new Set(catalogs).size > 1) failures.push({ category: 'protocol', reason: 'tool-catalog-changed' });
  return {
    failures,
    saved: saved ?? null,
    toolCatalogSha256: catalogs[0] ?? null,
    automaticLintRemoved,
    explicitLintCalls,
    callCount: requests.size,
    closed,
    resourceLimits,
  };
}
