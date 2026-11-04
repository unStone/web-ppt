import assert from 'node:assert/strict';
import { parse, layoutText } from '@web-ppt/core';
import { createDoc, disposeDoc, effectiveElement } from '@web-ppt/edit-core';
import { describePresentation } from '@web-ppt/edit-core/describe';
import { lintPresentation, LAYOUT_CHECKS, LayoutLintError } from '@web-ppt/edit-core/lint';
import { parse as parseColor, useMode, modeRgb } from 'culori/fn';
import { getTask } from './tasks.mjs';
import { buildFixture } from './fixtures.mjs';
import { createRuntime } from './runtime.mjs';
import { checkPreservation, hash } from './judge-preservation.mjs';
import { inspectCandidatePackage } from './judge-package.mjs';

useMode(modeRgb);

export function assertJudgeRuntime(runtime, task) {
  const prefix = 'Agent 评测判定运行时';
  assert(runtime && typeof runtime.measureText === 'function', `${prefix} 缺少真实 measureText`);
  assert.equal(typeof runtime.rasterize, 'function', `${prefix} 缺少真实 rasterize`);
  assert.deepEqual(runtime.lint?.checks, [...LAYOUT_CHECKS], `${prefix} 必须运行完整七项`);
  assert.deepEqual(runtime.lint?.fonts, { available: [task.fontFamily], embedded: [] }, `${prefix} 字体库存必须真实且固定`);
  assert.equal(typeof runtime.lint?.resolveContrast, 'function', `${prefix} 缺少明确的对比度能力`);
  assert.deepEqual(Object.keys(runtime.lint).sort(), ['checks', 'fonts', 'resolveContrast'],
    `${prefix} 不得覆盖标准阈值或观察回调`);
}

const notRun = () => ({ status: 'not-run', report: null, failures: [] });
const outputRuntimeReasons = new Set(['eval-contrast-background-unsupported']);

function dependencyBoundary(runtime) {
  let unexpected;
  const capture = action => (...args) => {
    try {
      const value = action(...args);
      if (value && typeof value.then === 'function') return value.catch(error => { inspect(error); throw error; });
      return value;
    } catch (error) { inspect(error); throw error; }
  };
  const inspect = error => {
    const knownOutput = error instanceof LayoutLintError && outputRuntimeReasons.has(error.reason)
      || error?.name === 'AgentEvaluationRuntimeError' && outputRuntimeReasons.has(error.reason);
    if (!knownOutput) unexpected = error;
  };
  return { measureText: capture(runtime.measureText), resolveContrast: capture(runtime.lint.resolveContrast),
    rethrowUnexpected() {
      if (unexpected) throw new Error('Agent 评测判定运行时的测量或渲染依赖发生意外错误', { cause: unexpected });
    } };
}

function checkText(doc, task, runtime, failures) {
  const inventory = new Set(runtime.lint.fonts.available.map(name => name.trim().toLowerCase()));
  for (const [id] of Object.entries(doc.elements)) {
    const element = effectiveElement(doc, id);
    if (element.kind !== 'shape' || !element.text) continue;
    let valid = true;
    for (const paragraph of element.text.paragraphs) for (const run of paragraph.runs) {
      if (!run.text.trim()) continue;
      const color = parseColor(run.color);
      if (!color || color.mode !== 'rgb' || ![color.r, color.g, color.b, color.alpha ?? 1].every(Number.isFinite)
        || (color.alpha ?? 1) !== 1) {
        failures.push({ reason: 'text-not-visible', elementId: id, message: '所有原始非空文字必须保持不透明的有效前景色' });
        valid = false;
      }
      if (!Array.isArray(run.fonts) || !run.fonts.length
        || run.fonts.some(name => typeof name !== 'string' || !inventory.has(name.trim().toLowerCase()))) {
        failures.push({ reason: 'font-unavailable', elementId: id, message: '最终字体必须全部来自真实注册库存' });
        valid = false;
      }
      if (!Number.isFinite(run.size) || run.size < task.minFontSize) {
        failures.push({ reason: 'text-too-small', elementId: id, message: `基础字号不得小于 ${task.minFontSize} px` });
        valid = false;
      }
    }
    if (!Number.isFinite(element.text.fontScale) || element.text.fontScale <= 0) {
      failures.push({ reason: 'text-too-small', elementId: id, message: '文字缩放比例必须为正有限值' });
      valid = false;
    }
    if (!valid || failures.length) continue;
    const layout = layoutText(element.text, element.w, element.h,
      { measureText: runtime.measureText, includeCarets: false, anchor: 'top' });
    for (const paragraph of element.text.paragraphs) for (const run of paragraph.runs) {
      const actual = run.size * layout.scale * (run.baseline ? .65 : 1);
      if (run.text.trim() && actual < task.minFontSize - .00001) {
        failures.push({ reason: 'text-too-small', elementId: id,
          message: `实际排版字号 ${actual} px 小于 ${task.minFontSize} px` });
      }
    }
  }
}

export async function judgeTask({ taskId, inputBytes, outputBytes }) {
  const task = getTask(taskId);
  assert(inputBytes instanceof Uint8Array && inputBytes.length, '评测输入必须是非空PPTX字节');
  assert.equal(hash(inputBytes), hash(buildFixture(taskId)), '评测输入哈希必须与确定性任务固件一致');
  const runtime = createRuntime();
  assertJudgeRuntime(runtime, task);
  const boundary = dependencyBoundary(runtime);
  const inputPresentation = await parse(inputBytes, { edit: true, keepPackage: true, lazy: false });
  let input, output, outputPresentation;
  const failures = [];
  const result = { taskId, pass: false, failures, description: null, lint: notRun() };
  try {
    input = createDoc(inputPresentation, { idPrefix: 'agent-eval-judge-' });
    const before = describePresentation(input);
    const titles = before.slides.flatMap(slide => slide.elements).filter(item => item.name === task.titleName);
    assert.equal(titles.length, 1, `评测输入标题 ${task.titleName} 必须唯一`);
    const titleId = titles[0].id;
    inspectCandidatePackage(input, outputBytes, failures);
    if (failures.length) return result;
    try {
      outputPresentation = await parse(outputBytes, { edit: true, keepPackage: true, lazy: false });
      output = createDoc(outputPresentation, { idPrefix: 'agent-eval-judge-' });
      assert.equal(output.meta.source, 'pptx', '候选输出必须是真实PPTX');
      assert.equal(output.package?.format, 'pptx', '候选输出必须保留可检查的真实OPC包');
      result.description = describePresentation(output);
    } catch (error) {
      throw new Error('Agent 评测候选SDK读取发生意外错误', { cause: error });
    }
    checkPreservation({ input, output, before, after: result.description, titleId, task, failures });
    try { checkText(output, task, { ...runtime, measureText: boundary.measureText }, failures); }
    catch (error) {
      boundary.rethrowUnexpected();
      throw new Error('Agent 评测实际字号检查发生意外错误', { cause: error });
    }
    boundary.rethrowUnexpected();
    if (failures.length) return result;
    try {
      const report = await lintPresentation(output, { ...runtime.lint, measureText: boundary.measureText,
        resolveContrast: boundary.resolveContrast });
      boundary.rethrowUnexpected();
      assert.deepEqual(report.checks, [...LAYOUT_CHECKS], '判定器必须完成全部七项检查');
      assert(Array.isArray(report.issues), '生产lint必须返回明确的问题数组');
      result.lint = { status: 'ok', report, failures: [] };
      if (report.issues.length) failures.push({ reason: 'layout-issues',
        message: '最终保存文稿仍有布局问题', checks: [...new Set(report.issues.map(issue => issue.reason))] });
    } catch (error) {
      boundary.rethrowUnexpected();
      if (!(error instanceof LayoutLintError) || !outputRuntimeReasons.has(error.reason)) {
        throw new Error('Agent 评测判定器发生意外检查错误', { cause: error });
      }
      const failure = { reason: error.reason, message: error.message,
        slideNumber: error.slideNumber, elementId: error.elementId };
      result.lint = { status: 'failed', report: null, failures: [failure] };
      failures.push({ reason: 'layout-check-failed', message: '最终保存文稿的完整检查未完成', cause: failure });
    }
    result.pass = failures.length === 0 && result.lint.status === 'ok'
      && result.lint.report.issues.length === 0 && result.lint.failures.length === 0;
    return result;
  } finally {
    if (output) disposeDoc(output); else outputPresentation?.dispose?.();
    if (input) disposeDoc(input); else inputPresentation.dispose?.();
  }
}
