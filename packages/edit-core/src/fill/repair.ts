import {
  effectiveElement,
  elementWorldBounds,
  elementParentToSlideMatrix,
  inverseTransformSpaceVector,
  elementFrameToParentMatrix,
  queryTheme,
  textPositionAtIndex,
  textPositionToIndex,
  transformSpacePoint,
} from '@web-ppt/edit-core';
import type { Command, DesignCommand, DesignTarget, EditDoc, Editor, TableCellAddress, TextRange } from '@web-ppt/edit-core';
import { fitTextShapeHeight, layoutText } from '@web-ppt/core';
import type { TextBody } from '@web-ppt/core';
import { describePresentation } from '@web-ppt/edit-core/describe';
import { lintPresentation } from '@web-ppt/edit-core/lint';
import type { LayoutCheck, LayoutIssue, LayoutLintOptions, LayoutLintReport } from '@web-ppt/edit-core/lint';
import { TemplateFillError, requireActive } from './errors';

export interface TemplateRepair {
  readonly elementId: string | null;
  readonly slideNumber: number | null;
  readonly source: { readonly part: string; readonly spid: number } | null;
  readonly reason: LayoutCheck;
  readonly action: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface TemplateRepairResult {
  readonly changed: boolean;
  readonly initialReport: LayoutLintReport | null;
  readonly report: LayoutLintReport | null;
  readonly repairs: readonly TemplateRepair[];
  readonly unavailable: readonly { readonly elementId: string; readonly reason: LayoutCheck; readonly detail: string }[];
}

interface RepairOptions {
  readonly signal?: AbortSignal;
  readonly phase?: 'design' | 'all';
}
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'system-ui']);
const normalize = (value: string): string => value.trim().toLowerCase();

function owner(doc: EditDoc, id: string): { root: string; canvas: DesignTarget | { kind: 'slide'; id: string } } {
  let root = id;
  const seen = new Set<string>();
  while (doc.elements[root]) {
    if (seen.has(root)) throw new TemplateFillError('layout-repair-failed', `修复目标 ${id} 的父链成环`, null, null, id);
    seen.add(root);
    const parent = doc.elements[root].parent;
    if (doc.slides[parent]) return { root, canvas: { kind: 'slide', id: parent } };
    if (doc.layouts[parent]) return { root, canvas: { kind: 'layout', id: parent } };
    if (doc.masters[parent]) return { root, canvas: { kind: 'master', id: parent } };
    root = parent;
  }
  throw new TemplateFillError('layout-repair-failed', `修复目标 ${id} 没有有效的画布父链`, null, null, id);
}

function execute(doc: EditDoc, editor: Editor, id: string, ...commands: Command[]) {
  const { canvas } = owner(doc, id);
  return canvas.kind === 'slide' ? editor.exec(...commands) : editor.execDesign(canvas, ...(commands as DesignCommand[]));
}

function record(
  doc: EditDoc,
  id: string | null,
  issue: Pick<LayoutIssue, 'reason' | 'slideNumber'> | null,
  action: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  reason: LayoutCheck = 'off-canvas',
): TemplateRepair {
  const origin = id ? doc.elements[id]?.meta.origin : undefined;
  return {
    elementId: id,
    slideNumber: issue?.slideNumber ?? null,
    source: origin ? { ...origin } : null,
    reason: issue?.reason ?? reason,
    action,
    before,
    after,
  };
}

function outside(doc: EditDoc, id: string, tolerance: number): boolean {
  const b = elementWorldBounds(doc, id);
  return Math.max(-b.left, -b.top, b.right - doc.meta.width, b.bottom - doc.meta.height) > tolerance;
}

function fitGeometry(
  doc: EditDoc,
  editor: Editor,
  id: string,
  tolerance: number,
  issue: LayoutIssue | null,
  repairs: TemplateRepair[],
): boolean {
  if (!outside(doc, id, tolerance)) return false;
  const root = owner(doc, id).root;
  const target = outside(doc, root, tolerance) ? root : id;
  let value = effectiveElement(doc, target);
  const before = { bounds: elementWorldBounds(doc, target), x: value.x, y: value.y, w: value.w, h: value.h, rot: value.rot };
  const b = before.bounds,
    w = b.right - b.left,
    h = b.bottom - b.top;
  if (![w, h, value.w, value.h].every(Number.isFinite) || w < 0 || h < 0 || (!w && !h)) {
    throw new TemplateFillError('layout-repair-failed', `元素 ${target} 没有可修复的有限正面积`, issue?.slideNumber ?? null, null, target);
  }
  const margin = Math.min(0.02, doc.meta.width / 100, doc.meta.height / 100);
  const scale = Math.min(1, w ? (doc.meta.width - margin * 2) / w : 1, h ? (doc.meta.height - margin * 2) / h : 1);
  if (scale < 1)
    execute(doc, editor, target, {
      type: 'SetXfrm',
      id: target,
      x: value.x + (value.w * (1 - scale)) / 2,
      y: value.y + (value.h * (1 - scale)) / 2,
      w: value.w * scale,
      h: value.h * scale,
    });
  const scaled = elementWorldBounds(doc, target);
  const dx =
    scaled.left < margin ? margin - scaled.left : scaled.right > doc.meta.width - margin ? doc.meta.width - margin - scaled.right : 0;
  const dy =
    scaled.top < margin ? margin - scaled.top : scaled.bottom > doc.meta.height - margin ? doc.meta.height - margin - scaled.bottom : 0;
  if (dx || dy) {
    const delta = inverseTransformSpaceVector(elementParentToSlideMatrix(doc, target), { x: dx, y: dy });
    value = effectiveElement(doc, target);
    execute(doc, editor, target, { type: 'SetXfrm', id: target, x: value.x + delta.x, y: value.y + delta.y });
  }
  if (outside(doc, target, tolerance)) {
    throw new TemplateFillError(
      'layout-repair-failed',
      `元素 ${target} 等比缩放和平移后仍越出画布`,
      issue?.slideNumber ?? null,
      null,
      target,
    );
  }
  value = effectiveElement(doc, target);
  repairs.push(
    record(doc, target, issue, 'fit-geometry', before, {
      bounds: elementWorldBounds(doc, target),
      x: value.x,
      y: value.y,
      w: value.w,
      h: value.h,
      rot: value.rot,
    }),
  );
  return true;
}

function fontInventory(lint: LayoutLintOptions): { known: ReadonlySet<string>; fallback: string } | null {
  if (!lint.fonts) return null;
  const names = [...lint.fonts.available, ...lint.fonts.embedded];
  if (names.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new TemplateFillError('invalid-options', '修复使用的真实字体库存必须由非空字体名组成');
  }
  const fallback = names.find((name) => !GENERIC_FONTS.has(normalize(name)));
  return fallback ? { known: new Set([...names.map(normalize), ...GENERIC_FONTS]), fallback } : null;
}

function repairThemeFonts(doc: EditDoc, editor: Editor, lint: LayoutLintOptions, repairs: TemplateRepair[]): void {
  const inventory = fontInventory(lint);
  if (!inventory) return;
  for (const id of doc.themeOrder) {
    const theme = queryTheme(doc, id),
      changes: Record<string, Record<string, unknown>> = {};
    for (const role of ['major', 'minor'] as const) {
      const fields: Record<string, unknown> = {};
      for (const field of ['latin', 'ea', 'cs'] as const) {
        const name = theme.fonts[role][field];
        if (name && !inventory.known.has(normalize(name))) fields[field] = inventory.fallback;
      }
      const scripts = Object.fromEntries(
        Object.entries(theme.fonts[role].scripts)
          .filter(([, name]) => !!name && !inventory.known.has(normalize(name)))
          .map(([script]) => [script, inventory.fallback]),
      );
      if (Object.keys(scripts).length) fields.scripts = scripts;
      if (Object.keys(fields).length) changes[role] = fields;
    }
    if (!Object.keys(changes).length) continue;
    editor.exec({ type: 'SetTheme', id, fontScheme: changes });
    repairs.push(
      record(
        doc,
        null,
        null,
        'replace-theme-fonts',
        { themeId: id, fonts: theme.fonts },
        { themeId: id, fonts: queryTheme(doc, id).fonts },
        'missing-font',
      ),
    );
  }
}

function textTarget(doc: EditDoc, issue: LayoutIssue): { body: TextBody; cell?: TableCellAddress } | null {
  const value = effectiveElement(doc, issue.elementId);
  if (value.kind === 'shape' && value.text) return { body: value.text };
  if (value.kind === 'table' && issue.cell) {
    const cell = value.rows[issue.cell.row]?.cells[issue.cell.column];
    if (cell?.text) return { body: cell.text, cell: { r: issue.cell.row, c: issue.cell.column } };
  }
  return null;
}

function wholeRange(body: TextBody): TextRange | null {
  if (!body.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.length))) return null;
  const p = body.paragraphs.length - 1,
    r = Math.max(0, body.paragraphs[p].runs.length - 1);
  return { from: { p: 0, r: 0, off: 0 }, to: { p, r, off: body.paragraphs[p].runs[r]?.text.length ?? 0 } };
}

function repairRunFonts(doc: EditDoc, editor: Editor, issue: LayoutIssue, lint: LayoutLintOptions, repairs: TemplateRepair[]): boolean {
  const inventory = fontInventory(lint),
    target = textTarget(doc, issue);
  if (!inventory || !target) return false;
  const tasks = target.body.paragraphs.flatMap((paragraph, p) =>
    paragraph.runs.flatMap((run, r) => {
      if (!run.text.length || !run.fonts.some((font) => !inventory.known.has(normalize(font)))) return [];
      return [
        {
          from: textPositionToIndex(target.body, { p, r, off: 0 }),
          to: textPositionToIndex(target.body, { p, r, off: run.text.length }),
          before: [...run.fonts],
          font: run.fonts.find((font) => inventory.known.has(normalize(font))) ?? inventory.fallback,
        },
      ];
    }),
  );
  for (const task of tasks.reverse()) {
    const current = textTarget(doc, issue)!;
    execute(doc, editor, issue.elementId, {
      type: 'SetRunProps',
      id: issue.elementId,
      cell: current.cell,
      range: { from: textPositionAtIndex(current.body, task.from), to: textPositionAtIndex(current.body, task.to) },
      props: { font: task.font },
    });
    repairs.push(
      record(doc, issue.elementId, issue, 'replace-run-font', { fonts: task.before, from: task.from, to: task.to }, { font: task.font }),
    );
  }
  return tasks.length > 0;
}

function normalAutofit(doc: EditDoc, editor: Editor, issue: LayoutIssue, repairs: TemplateRepair[]): boolean {
  const target = textTarget(doc, issue);
  if (!target || target.body.autoFitCompute) return false;
  const reset: Command[] = target.body.autoFitNormal
    ? [{ type: 'SetBodyProps', id: issue.elementId, cell: target.cell, props: { autoFit: 'none' } }]
    : [];
  const result = execute(doc, editor, issue.elementId, ...reset, {
    type: 'SetBodyProps',
    id: issue.elementId,
    cell: target.cell,
    props: { autoFit: 'normal' },
  });
  if (!result.forward.length) return false;
  repairs.push(
    record(
      doc,
      issue.elementId,
      issue,
      'normal-autofit',
      { autoFit: target.body.autoFitNormal ? 'normal' : target.body.autoFitShape ? 'shape' : 'none', fontScale: target.body.fontScale },
      { autoFit: 'normal', compute: true },
    ),
  );
  return true;
}

async function textContrast(
  doc: EditDoc,
  editor: Editor,
  issue: LayoutIssue,
  lint: LayoutLintOptions,
  repairs: TemplateRepair[],
): Promise<boolean> {
  const target = textTarget(doc, issue),
    range = target && wholeRange(target.body);
  if (!target || !range) return false;
  const id = issue.elementId;
  const element = effectiveElement(doc, id);
  const before = {
    colors: target.body.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.color)),
    fillType: element.kind === 'shape' ? (element.fill?.type ?? 'none') : null,
  };
  const good = async () =>
    !(await lintPresentation(doc, { ...lint, checks: ['low-contrast'] })).issues.some(
      (candidate) => candidate.elementId === id && JSON.stringify(candidate.cell) === JSON.stringify(issue.cell),
    );
  for (const color of ['rgb(0,0,0)', 'rgb(255,255,255)']) {
    const result = execute(doc, editor, id, { type: 'SetRunProps', id, cell: target.cell, range, props: { color } });
    if (await good()) {
      if (result.forward.length) repairs.push(record(doc, id, issue, 'contrast-text-color', before, { color }));
      return !!result.forward.length;
    }
    if (result.forward.length && !editor.undo())
      throw new TemplateFillError('layout-repair-failed', `文字 ${id} 的颜色试验无法恢复`, issue.slideNumber, null, id);
  }
  if (effectiveElement(doc, id).kind !== 'shape') return false;
  const result = execute(
    doc,
    editor,
    id,
    { type: 'SetFill', id, fill: { type: 'solid', color: 'rgb(255,255,255)' } },
    { type: 'SetRunProps', id, range, props: { color: 'rgb(0,0,0)' } },
  );
  if (await good()) {
    if (result.forward.length)
      repairs.push(record(doc, id, issue, 'contrast-text-background', before, { color: 'rgb(0,0,0)', fill: 'rgb(255,255,255)' }));
    return !!result.forward.length;
  }
  if (result.forward.length && !editor.undo())
    throw new TemplateFillError('layout-repair-failed', `文字 ${id} 的背景试验无法恢复`, issue.slideNumber, null, id);
  return false;
}

function undistortImage(doc: EditDoc, editor: Editor, issue: LayoutIssue, repairs: TemplateRepair[]): boolean {
  const value = effectiveElement(doc, issue.elementId);
  const width = issue.measurements.sourceWidth,
    height = issue.measurements.sourceHeight;
  if (value.kind !== 'image' || value.media || typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0)
    return false;
  const sourceRatio = width / height,
    targetRatio = value.w / value.h,
    horizontal = sourceRatio > targetRatio;
  const total = Math.round((1 - (horizontal ? targetRatio / sourceRatio : sourceRatio / targetRatio)) * 100000);
  if (total >= 100000) return false;
  const first = Math.floor(total / 2) / 100000,
    second = (total - Math.floor(total / 2)) / 100000;
  const crop = { l: horizontal ? first : 0, r: horizontal ? second : 0, t: horizontal ? 0 : first, b: horizontal ? 0 : second };
  const result = execute(doc, editor, issue.elementId, { type: 'SetCrop', id: issue.elementId, crop });
  if (!result.forward.length) return false;
  repairs.push(record(doc, issue.elementId, issue, 'cover-image', { crop: value.crop }, { crop }));
  return true;
}

function tightenText(
  doc: EditDoc,
  editor: Editor,
  id: string,
  issue: LayoutIssue,
  lint: LayoutLintOptions,
  repairs: TemplateRepair[],
): boolean {
  const value = effectiveElement(doc, id);
  if (
    value.kind !== 'shape'
    || !value.text
    || value.text.warp
    || (value.text.vert && value.text.vert !== 'horz')
    || !value.text.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))
  )
    return false;
  const layout = layoutText(value.text, value.w, value.h, { measureText: lint.measureText, includeCarets: false });
  const height =
    Math.ceil(fitTextShapeHeight(value.text, value.w, { measureText: lint.measureText, scale: layout.scale, anchor: 'top' }) * 9525 + 1)
    / 9525;
  if (height >= value.h - (lint.tolerancePx ?? 0.01)) return false;
  const logical = value.text.anchor === 'bottom' ? 1 : value.text.anchor === 'middle' ? 0.5 : 0;
  const fraction = value.flipV ? 1 - logical : logical;
  const anchor = transformSpacePoint(elementFrameToParentMatrix(value), { x: value.w / 2, y: value.h * fraction });
  const next = { ...value, h: height };
  const moved = transformSpacePoint(elementFrameToParentMatrix(next), { x: next.w / 2, y: height * fraction });
  const before = {
    x: value.x,
    y: value.y,
    w: value.w,
    h: value.h,
    fontScale: layout.scale,
    lines: layout.lines.map((line) => ({ x: line.x, y: line.y, width: line.width, height: line.height })),
  };
  const result = execute(
    doc,
    editor,
    id,
    { type: 'SetXfrm', id, x: value.x + anchor.x - moved.x, y: value.y + anchor.y - moved.y, h: height },
    { type: 'SetBodyProps', id, props: { autoFit: 'normal' } },
  );
  if (!result.forward.length) return false;
  const actual = effectiveElement(doc, id);
  repairs.push(record(doc, id, issue, 'tighten-text-frame', before, { x: actual.x, y: actual.y, w: actual.w, h: actual.h }));
  return true;
}

function hasOverlap(report: LayoutLintReport, id: string): boolean {
  return report.issues.some(
    (issue) => issue.reason === 'element-overlap' && (issue.elementId === id || issue.measurements.relatedElementId === id),
  );
}

async function repairOverlap(
  doc: EditDoc,
  editor: Editor,
  issue: LayoutIssue,
  lint: LayoutLintOptions,
  repairs: TemplateRepair[],
): Promise<boolean> {
  const related = issue.measurements.relatedElementId;
  if (typeof related !== 'string' || !doc.elements[related]) return false;
  const ids = [issue.elementId, related];
  let changed = false;
  for (const id of ids) changed = tightenText(doc, editor, id, issue, lint, repairs) || changed;
  const geometryLint = { ...lint, checks: ['element-overlap', 'off-canvas', 'text-overflow'] as const };
  let report = await lintPresentation(doc, geometryLint);
  if (!hasOverlap(report, issue.elementId) && !hasOverlap(report, related)) return changed;
  const priority = [...ids].sort((a, b) => Number(owner(doc, a).canvas.kind === 'slide') - Number(owner(doc, b).canvas.kind === 'slide'));
  for (const id of priority) {
    if (!hasOverlap(report, id)) continue;
    if (owner(doc, id).root !== id || effectiveElement(doc, id).kind !== 'shape') continue;
    const description = describePresentation(doc),
      box = elementWorldBounds(doc, id);
    const width = box.right - box.left,
      height = box.bottom - box.top,
      gap = 4;
    const pages = description.slides.filter((slide) => slide.elements.some((element) => element.id === id));
    const x = new Set([gap, doc.meta.width - width - gap, box.left]);
    const y = new Set([gap, doc.meta.height - height - gap, box.top]);
    const obstacles = pages.flatMap((page) =>
      page.elements.filter(
        (element) =>
          element.id !== id
          && !element.hidden
          && (element.kind === 'image'
            || element.kind === 'table'
            || element.editable === 'frame'
            || element.paragraphs.some((paragraph) => paragraph.text.trim())),
      ),
    );
    for (const other of obstacles) {
      x.add(other.bounds.x - width - gap);
      x.add(other.bounds.x + other.bounds.width + gap);
      y.add(other.bounds.y - height - gap);
      y.add(other.bounds.y + other.bounds.height + gap);
    }
    const candidates = [...x]
      .flatMap((left) => [...y].map((top) => ({ left, top })))
      .filter((point) => point.left >= 0 && point.top >= 0 && point.left + width <= doc.meta.width && point.top + height <= doc.meta.height)
      .filter(
        (point) =>
          !obstacles.some((other) => {
            const w = Math.min(point.left + width, other.bounds.x + other.bounds.width) - Math.max(point.left, other.bounds.x);
            const h = Math.min(point.top + height, other.bounds.y + other.bounds.height) - Math.max(point.top, other.bounds.y);
            return (
              w > 0 && h > 0 && (w * h) / Math.min(width * height, other.bounds.width * other.bounds.height) > (lint.overlapRatio ?? 0.25)
            );
          }),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.left - box.left, a.top - box.top) - Math.hypot(b.left - box.left, b.top - box.top)
          || a.top - b.top
          || a.left - b.left,
      );
    for (const point of candidates) {
      const value = effectiveElement(doc, id);
      const delta = inverseTransformSpaceVector(elementParentToSlideMatrix(doc, id), { x: point.left - box.left, y: point.top - box.top });
      const result = execute(doc, editor, id, { type: 'SetXfrm', id, x: value.x + delta.x, y: value.y + delta.y });
      report = await lintPresentation(doc, geometryLint);
      if (
        result.forward.length
        && !hasOverlap(report, id)
        && !report.issues.some(
          (candidate) => candidate.elementId === id && (candidate.reason === 'off-canvas' || candidate.reason === 'text-overflow'),
        )
      ) {
        repairs.push(record(doc, id, issue, 'move-text-frame', { bounds: box }, { bounds: elementWorldBounds(doc, id) }));
        return true;
      }
      if (result.forward.length && !editor.undo())
        throw new TemplateFillError('layout-repair-failed', `文字 ${id} 的移动试验无法恢复`, issue.slideNumber, null, id);
    }
  }
  return changed;
}

/** 修复实际编辑模型；最终报告始终由同一套完整检查重新计算。 */
export async function repairTemplate(
  doc: EditDoc,
  editor: Editor,
  lint: LayoutLintOptions,
  options: RepairOptions = {},
): Promise<TemplateRepairResult> {
  const repairs: TemplateRepair[] = [],
    unavailable: { elementId: string; reason: LayoutCheck; detail: string }[] = [];
  const signal = options.signal ?? lint.signal;
  const check = () => requireActive(signal);
  check();
  if (options.phase === 'design') {
    repairThemeFonts(doc, editor, lint, repairs);
    for (const root of [
      ...doc.masterOrder.flatMap((id) => doc.masters[id].children),
      ...doc.layoutOrder.flatMap((id) => doc.layouts[id].children),
    ]) {
      check();
      fitGeometry(doc, editor, root, lint.tolerancePx ?? 0.01, null, repairs);
    }
    return { changed: repairs.length > 0, initialReport: null, report: null, repairs, unavailable };
  }
  const request = { ...lint, signal };
  let report = await lintPresentation(doc, request);
  const initialReport = report,
    attempted = new Set<string>();
  let geometryRevision = 0;
  const keyOf = (issue: LayoutIssue) =>
    `${issue.reason}:${issue.elementId}:${JSON.stringify(issue.cell)}:${issue.measurements.relatedElementId ?? ''}:${issue.reason === 'low-contrast' ? geometryRevision : 0}`;
  const priority: readonly LayoutCheck[] = [
    'off-canvas',
    'missing-font',
    'text-overflow',
    'image-distorted',
    'element-overlap',
    'low-contrast',
    'placeholder-prompt-left',
  ];
  while (true) {
    check();
    const issue = [...report.issues]
      .sort((a, b) => priority.indexOf(a.reason) - priority.indexOf(b.reason))
      .find((candidate) => !attempted.has(keyOf(candidate)));
    if (!issue) break;
    attempted.add(keyOf(issue));
    let changed = false;
    try {
      if (issue.reason === 'off-canvas') changed = fitGeometry(doc, editor, issue.elementId, lint.tolerancePx ?? 0.01, issue, repairs);
      else if (issue.reason === 'missing-font') changed = repairRunFonts(doc, editor, issue, lint, repairs);
      else if (issue.reason === 'text-overflow') changed = normalAutofit(doc, editor, issue, repairs);
      else if (issue.reason === 'image-distorted') changed = undistortImage(doc, editor, issue, repairs);
      else if (issue.reason === 'element-overlap') changed = await repairOverlap(doc, editor, issue, request, repairs);
      else if (issue.reason === 'low-contrast') changed = await textContrast(doc, editor, issue, request, repairs);
    } catch (error) {
      if (error instanceof TemplateFillError || signal?.aborted) throw error;
      throw new TemplateFillError(
        'layout-repair-failed',
        `第 ${issue.slideNumber} 页 ${issue.elementId} 的 ${issue.reason} 修复失败：${error instanceof Error ? error.message : String(error)}`,
        issue.slideNumber,
        null,
        issue.elementId,
        report,
      );
    }
    if (changed && (issue.reason === 'off-canvas' || issue.reason === 'element-overlap')) geometryRevision++;
    if (!changed)
      unavailable.push({
        elementId: issue.elementId,
        reason: issue.reason,
        detail: '现有可安全执行的原生命令未能消除此问题，完整诊断仍保留',
      });
    report = await lintPresentation(doc, request);
  }
  return {
    changed: repairs.length > 0,
    initialReport,
    report,
    repairs,
    unavailable: unavailable.filter((item) =>
      report.issues.some((issue) => issue.elementId === item.elementId && issue.reason === item.reason),
    ),
  };
}
