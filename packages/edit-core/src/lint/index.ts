import RBush from 'rbush';
import { collectFonts, layoutText, readImageMetadata } from '@web-ppt/core';
import { sourceAsset } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import type { TextMeasure } from '@web-ppt/core';
import { snapshot } from './snapshot';
import { color, contrast, paint } from './color';
import { promptReader } from './prompts';
import { active, LAYOUT_CHECKS, LayoutLintError, waitFor } from './types';
import type { LayoutCheck, LayoutIssue, LayoutLintOptions, LayoutLintReport, LintContext } from './types';
export { LayoutLintError, LAYOUT_CHECKS } from './types';
export type { LayoutCheck, LayoutIssue, LayoutLintOptions, LayoutLintReport, LintContext, ContrastContext, ContrastSamples } from './types';

const defaults = { overlapRatio: .25, imageDeviation: .05, tolerancePx: .01, maxIssues: 10000 };
const normalize = (s: string) => s.trim().toLowerCase();
function measured(measure: TextMeasure | undefined, signal?: AbortSignal): TextMeasure {
  if (typeof measure !== 'function') throw new LayoutLintError('measurement-required', '文字检查必须提供真实 measureText；Node 不使用估算字宽');
  return (text, run, scale) => {
    active(signal);
    const width = measure(text, run, scale);
    if (!Number.isFinite(width) || width < 0) throw new LayoutLintError('invalid-measurement', `文字测量返回 ${width}，预期非负有限 px`);
    return width;
  };
}
export function prepareLintText(doc: EditDoc, measureText: TextMeasure): void {
  const measure = measured(measureText);
  for (const page of snapshot(doc).elements) for (const e of page) for (const u of e.item.hidden ? [] : e.units) {
    layoutText(u.body, u.width, u.height, { measureText: measure, includeCarets: false, anchor: 'top' });
  }
}

export async function lintPresentation(doc: EditDoc, options: LayoutLintOptions = {}): Promise<LayoutLintReport> {
  if (!options || typeof options !== 'object' || Array.isArray(options) || options.checks !== undefined && !Array.isArray(options.checks)) throw new LayoutLintError('invalid-options', '布局检查选项必须是对象，checks 必须是数组');
  options = { ...options };
  active(options.signal);
  const checks = LAYOUT_CHECKS.filter(c => !options.checks || options.checks.includes(c));
  if (!checks.length || options.checks?.some(c => !LAYOUT_CHECKS.includes(c))) throw new LayoutLintError('invalid-options', 'checks 必须是非空的已知检查项列表');
  const cfg = { ...defaults, ...Object.fromEntries(Object.keys(defaults).filter(k => options[k as keyof typeof defaults] !== undefined).map(k => [k, options[k as keyof typeof defaults]])) };
  if (!Number.isFinite(cfg.overlapRatio) || cfg.overlapRatio < 0 || cfg.overlapRatio > 1 || !Number.isFinite(cfg.imageDeviation) || cfg.imageDeviation < 0
    || !Number.isFinite(cfg.tolerancePx) || cfg.tolerancePx < 0 || !Number.isSafeInteger(cfg.maxIssues) || cfg.maxIssues < 1) throw new LayoutLintError('invalid-options', '阈值必须有限且非负，重叠比例不超过 1，maxIssues 必须为正安全整数');
  const view = snapshot(doc), has = (c: LayoutCheck) => checks.includes(c);
  const hasText = view.elements.some(p => p.some(e => !e.item.hidden && e.units.length));
  const measure = hasText && (has('text-overflow') || has('low-contrast')) ? measured(options.measureText, options.signal) : undefined;
  if (hasText && has('missing-font') && (!options.fonts || !Array.isArray(options.fonts.available) || !Array.isArray(options.fonts.embedded))) throw new LayoutLintError('font-inventory-required', '缺字体检查必须提供 available/embedded 字体库存');
  const names = [...(options.fonts?.available ?? []), ...(options.fonts?.embedded ?? [])];
  if (names.some(n => typeof n !== 'string' || !n.trim())) throw new LayoutLintError('invalid-options', '字体库存必须包含非空字体名');
  const fonts = new Set(names.map(normalize));
  const canvas = color(options.canvasColor ?? '#ffffff');
  if (canvas[3] !== 1) throw new LayoutLintError('invalid-options', 'canvasColor 必须是不透明颜色');
  const prompts = new Map<string, string[] | Error>(), readPrompts = promptReader(doc);
  const resources = new Map<string, Uint8Array>();
  const assets = new Map<string, { bytes: Uint8Array; mime: string }>(Object.entries(doc.package?.assets ?? {}));
  const seen = new Set<object>();
  const retain = (value: unknown): void => {
    if (typeof value === 'string' && (value.startsWith('blob:') || value.startsWith('asset:'))) { const asset = sourceAsset(doc, value); if (asset) assets.set(value, asset); }
    else if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value); for (const child of Object.values(value)) retain(child); }
  };
  retain(view.slides);
  const imageInfos = new Map<string, NonNullable<ReturnType<typeof readImageMetadata>>>();
  for (const page of view.elements) for (const e of page) {
    if (e.item.hidden) continue;
    if (has('placeholder-prompt-left')) {
      try { prompts.set(e.item.id, readPrompts(e.item)); }
      catch (error) { if (!options.resolvePlaceholderPrompts) throw error; prompts.set(e.item.id, error as Error); }
    }
    if (e.raw.kind === 'image') { const bytes = sourceAsset(doc, e.raw.src)?.bytes; if (bytes) resources.set(e.raw.src, bytes); }
  }
  const issues: LayoutIssue[] = [];
  const issue = (reason: LayoutCheck, page: number, e: typeof view.elements[number][number], measurements: LayoutIssue['measurements'], cell: LayoutIssue['cell'] = null) => {
    if (Object.values(measurements).some(v => typeof v === 'number' && !Number.isFinite(v))) throw new LayoutLintError('invalid-measurement', '检查结果必须为有限数值', page, e.item.id);
    if (issues.length >= cfg.maxIssues) throw new LayoutLintError('resource-limit', `问题数量超过 maxIssues=${cfg.maxIssues}`, page, e.item.id);
    issues.push({ reason, slideNumber: page, elementId: e.item.id, bounds: { ...e.item.bounds }, cell, measurements });
  };
  const call = async <T>(reason: string, context: LintContext, action: () => T | Promise<T>): Promise<T> => {
    try { active(options.signal); const result = await waitFor(action(), options.signal); active(options.signal); return result; }
    catch (error) { if (error instanceof LayoutLintError) throw error; throw new LayoutLintError(reason, `${context.elementId}：${error instanceof Error ? error.message : String(error)}`, context.slideNumber, context.elementId); }
  };
  for (let pi = 0; pi < view.elements.length; pi++) {
    active(options.signal);
    const page = view.elements[pi], slide = view.slides[pi], number = pi + 1;
    const bindings = page.filter(e => !e.item.hidden).map(e => ({ elementId: e.item.id, element: e.visible }));
    const index = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; order: number }>();
    const paints = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; order: number }>();
    paints.load(page.flatMap((e, order) => e.item.hidden ? [] : [{ minX: e.item.bounds.x, minY: e.item.bounds.y,
      maxX: e.item.bounds.x + e.item.bounds.width, maxY: e.item.bounds.y + e.item.bounds.height, order }]));
    const effects = page.some(e => !e.item.hidden && Object.values(e.rendered.effects ?? {}).some(Boolean));
    for (let ei = 0; ei < page.length; ei++) {
      const e = page[ei], b = e.item.bounds;
      if (e.item.hidden) continue;
      const context: LintContext = { slideNumber: number, elementId: e.item.id, element: e.rendered, slide, signal: options.signal,
        canvas: { width: view.description.width, height: view.description.height, color: options.canvasColor ?? '#ffffff' }, resource: url => assets.get(url), bindings };
      if (has('off-canvas')) {
        const outside = Math.max(-b.x, -b.y, b.x + b.width - view.description.width, b.y + b.height - view.description.height);
        if (outside > cfg.tolerancePx) issue('off-canvas', number, e, { outsidePx: outside, tolerancePx: cfg.tolerancePx });
      }
      const logical = e.rendered.kind !== 'group' || e.item.editable === 'frame' || e.rendered.editInfo?.editable === 'frame';
      const content = e.rendered.kind === 'image' || e.rendered.kind === 'table' || e.units.some(u => u.body.paragraphs.some(p => p.runs.some(r => r.text.trim())));
      const background = e.rendered.kind === 'image' && !e.rendered.media && e.item.editable !== 'frame' && b.width >= view.description.width * .95 && b.height >= view.description.height * .95;
      if (has('element-overlap') && content && !background && b.width > 0 && b.height > 0 && logical) {
        const box = { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height, order: ei };
        for (const hit of index.search(box).sort((a, z) => a.order - z.order)) {
          const other = page[hit.order]; if (other.item.path[0] === e.item.path[0]) continue;
          const w = Math.min(box.maxX, hit.maxX) - Math.max(box.minX, hit.minX), h = Math.min(box.maxY, hit.maxY) - Math.max(box.minY, hit.minY);
          const ratio = w * h / Math.min(b.width * b.height, other.item.bounds.width * other.item.bounds.height);
          if (w > 0 && h > 0 && ratio > cfg.overlapRatio) issue('element-overlap', number, e, { relatedElementId: other.item.id, ratio, threshold: cfg.overlapRatio });
        }
        index.insert(box);
      }
      if (has('missing-font') && logical) {
        const missing = collectFonts([{ background: null, elements: [e.rendered] }]).map(f => f.family).filter(f => !fonts.has(normalize(f)) && !['serif', 'sans-serif', 'monospace', 'system-ui'].includes(normalize(f))).sort();
        if (missing.length && logical) issue('missing-font', number, e, { families: missing, missingCount: missing.length, threshold: 0 });
      }
      if (has('placeholder-prompt-left') && e.item.placeholder && !['dt', 'sldNum', 'ftr', 'hdr'].includes(e.item.placeholder.type)) {
        const supplied = options.resolvePlaceholderPrompts ? await call('prompt-resolver-failed', context, () => options.resolvePlaceholderPrompts!(context)) : undefined;
        const source = supplied ?? prompts.get(e.item.id) ?? [];
        if (source instanceof Error) throw source;
        const matching = e.item.paragraphs.map(p => p.text.trim()).filter(t => t && source.some(s => s.trim() === t));
        if (matching.length) issue('placeholder-prompt-left', number, e, { text: matching.join('\n'), matchedCount: matching.length, threshold: 0 });
      }
      if (has('image-distorted') && e.rendered.kind === 'image' && !e.rendered.media && e.item.editable !== 'frame') {
        const image = e.rendered;
        let info = (options.resolveImageMetadata ? await call('image-resolver-failed', context, () => options.resolveImageMetadata!(context)) : undefined) ?? imageInfos.get(image.src);
        if (!info) {
          let bytes = resources.get(image.src);
          if (!bytes && image.src.startsWith('data:')) bytes = new Uint8Array(await call('image-resource-failed', context, async () => (await fetch(image.src, { signal: options.signal })).arrayBuffer()));
          info = bytes ? readImageMetadata(bytes) ?? undefined : undefined;
        }
        if (!info || !Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0) throw new LayoutLintError('image-metadata-unavailable', '图片缺少可用的原图尺寸，请提供 resolveImageMetadata', number, e.item.id);
        imageInfos.set(image.src, info);
        const crop = image.crop, w = info.width * (1 - (crop?.l ?? 0) - (crop?.r ?? 0)), h = info.height * (1 - (crop?.t ?? 0) - (crop?.b ?? 0));
        if (w <= 0 || h <= 0 || image.w <= 0 || image.h <= 0) throw new LayoutLintError('invalid-image-geometry', '图片裁剪后的尺寸和显示尺寸必须为正', number, e.item.id);
        const ratio = (image.w / image.h) / (w / h), deviation = Math.max(ratio, 1 / ratio) - 1;
        if (deviation > cfg.imageDeviation) issue('image-distorted', number, e, { deviation, threshold: cfg.imageDeviation, sourceWidth: info.width, sourceHeight: info.height });
      }
      for (let ti = 0; ti < e.units.length; ti++) {
        const u = e.units[ti]; if (!has('text-overflow') && !has('low-contrast')) continue;
        let layout: ReturnType<typeof layoutText>;
        try { layout = layoutText(u.body, u.width, u.height, { measureText: measure, includeCarets: false, anchor: 'top' }); }
        catch (error) { throw new LayoutLintError(error instanceof LayoutLintError ? error.reason : 'measurement-failed', String(error), number, e.item.id); }
        const [top, right, bottom, left] = u.body.insets;
        const extent = Math.max(top, ...layout.lines.map(l => l.y + l.height));
        const colWidth = Math.max(1, (layout.layoutWidth - left - right - (layout.columns - 1) * (u.body.columnGap ?? 0)) / layout.columns);
        const wide = Math.max(0, ...layout.lines.map(l => {
          const start = left + l.columnIndex * (colWidth + (u.body.columnGap ?? 0));
          return Math.max(start - l.x, l.x + l.width - start - colWidth);
        }));
        if (has('text-overflow') && (layout.autoFit !== 'shape' && extent > layout.layoutHeight - bottom + cfg.tolerancePx || wide > cfg.tolerancePx)) issue('text-overflow', number, e, { contentBottom: extent, availableBottom: layout.layoutHeight - bottom, widthOverflow: wide, tolerancePx: cfg.tolerancePx, fontScale: layout.scale }, u.cell);
        if (!has('low-contrast')) continue;
        for (let p = 0; p < u.body.paragraphs.length; p++) for (let r = 0; r < u.body.paragraphs[p].runs.length; r++) {
          const run = u.body.paragraphs[p].runs[r]; if (!run.text.trim()) continue;
          if (color(run.color)[3] === 0 && !run.gradient && !run.gradientFill && !run.outline && !run.shadow && !run.shadowEffect) continue;
          let bg = paint(slide.background, canvas);
          for (const hit of paints.search({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height }).filter(h => h.order < ei).sort((a, z) => a.order - z.order)) {
            const under = page[hit.order];
            const a = under.item.bounds;
            if (under.item.hidden || under.rendered.kind === 'group' || a.x >= b.x + b.width || a.y >= b.y + b.height || a.x + a.width <= b.x || a.y + a.height <= b.y) continue;
            if (under.rendered.kind === 'shape' && a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height
              && (!under.rendered.fill || under.rendered.fill.type === 'none' || under.rendered.editInfo?.geom?.preset === 'rect')) bg = bg && paint(under.rendered.fill, bg);
            else if (under.rendered.kind !== 'shape' || under.rendered.fill && under.rendered.fill.type !== 'none') bg = null;
          }
          bg = bg && paint(u.fill, bg);
          if (run.highlight) bg = bg && overHighlight(run.highlight, bg);
          const covered = paints.search({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height }).some(h => h.order > ei && page[h.order].rendered.kind !== 'group');
          const complex = !bg || effects || covered || e.rendered.kind === 'group' || !!run.gradient || !!run.gradientFill || !!run.outline || !!run.shadow || !!run.shadowEffect || !!e.rendered.scene3d
            || !!u.fill && u.fill.type !== 'none' && e.rendered.kind === 'shape' && e.rendered.editInfo?.geom?.preset !== 'rect';
          const pairs = complex ? options.resolveContrast ? await call('contrast-resolver-failed', context, () => options.resolveContrast!({ ...context, body: u.body, paragraph: u.body.paragraphs[p], run, textIndex: ti, paragraphIndex: p, runIndex: r })) : null : [{ foreground: run.color, background: '' }];
          if (!pairs) throw new LayoutLintError('contrast-sampler-required', '复杂填充或文字效果需要 resolveContrast 提供实际前景/背景配对', number, e.item.id);
          if (!Array.isArray(pairs) && 'visible' in pairs && pairs.visible === false) continue;
          if (!Array.isArray(pairs)) throw new LayoutLintError('invalid-contrast-samples', '对比度采样必须为配对数组或 visible:false', number, e.item.id);
          if (!pairs.length) throw new LayoutLintError('invalid-contrast-samples', '对比度采样不能为空', number, e.item.id);
          const ratios = pairs.map(pair => {
            const back = complex ? color(pair.background) : bg!;
            if (back[3] !== 1) throw new LayoutLintError('invalid-contrast-samples', '采样背景必须已合成为不透明颜色', number, e.item.id);
            return contrast(color(pair.foreground), back);
          });
          const value = Math.min(...ratios), size = run.size * layout.scale * (run.baseline ? .65 : 1), threshold = size >= 24 || run.b && size >= 14 * (96 / 72) ? 3 : 4.5;
          if (value < threshold) issue('low-contrast', number, e, { ratio: value, threshold, fontSize: size, sampleCount: pairs.length }, u.cell);
        }
      }
    }
    try { await waitFor(options.onProgress?.({ completed: number, total: view.slides.length }), options.signal); }
    catch (error) { if (error instanceof LayoutLintError) throw error; throw new LayoutLintError('progress-callback-failed', String(error), number); }
    if (options.signal || options.onProgress) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  active(options.signal);
  issues.sort((a, b) => a.slideNumber - b.slideNumber || (a.elementId < b.elementId ? -1 : a.elementId > b.elementId ? 1 : 0) || LAYOUT_CHECKS.indexOf(a.reason) - LAYOUT_CHECKS.indexOf(b.reason));
  return { version: 1, checks, totalSlides: view.slides.length, totalElements: view.description.totalElements, issues };
}
function overHighlight(value: string, bg: readonly number[]) { return paint({ type: 'solid', color: value }, bg); }
