import { parse } from '@web-ppt/core';
import type { Presentation } from '@web-ppt/core';
import { createDoc, disposeDoc, Editor } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { describePresentation } from '@web-ppt/edit-core/describe';
import { lintPresentation } from '@web-ppt/edit-core/lint';
import { serializeEditDoc } from '@web-ppt/edit-core/save';
import { disposeOpcPackage } from '@web-ppt/edit-core/opc';
import { chartPartForElement } from '../chart/locator';
import { copyImageBytes } from '../commands/image-resource';
import type { BuiltinTemplateId } from '../templates/types';
import { TemplateFillError, requireActive } from './errors';
import { prepareOutline } from './validation';
import { planTemplateSlides } from './layouts';
import { chartSlotStyle, materializeOutline, pageSlot } from './content';
import { seedTemplateCharts } from './chart-seed';
import type { TemplateChartPlacement } from './chart-seed';
import type { TemplateFillBinding, TemplateFillOptions, TemplateFillResult } from './api';
import type { TemplateFillOutline } from './types';
import { repairTemplate } from './repair';
import type { TemplateRepair } from './repair';
import { prepareTemplatePackage } from './package';

export { TemplateFillError } from './errors';
export { templateFillSchema } from './generated-schema';
export type * from './types';
export type { TemplateFillBinding, TemplateFillOptions, TemplateFillResult } from './api';
export type { TemplateRepair as TemplateFillRepair } from './repair';

function snapshotOptions(options: TemplateFillOptions): TemplateFillOptions {
  if (!options || typeof options !== 'object' || !options.lint || typeof options.lint !== 'object' || Array.isArray(options.lint)
    || typeof options.lint.measureText !== 'function') {
    throw new TemplateFillError('measurement-required', '模板填充必须通过 options.lint.measureText 提供真实文字测量');
  }
  if (options.idPrefix !== undefined && (typeof options.idPrefix !== 'string' || !options.idPrefix)) {
    throw new TemplateFillError('invalid-options', 'idPrefix 必须是非空字符串');
  }
  if (options.requireClean !== undefined && typeof options.requireClean !== 'boolean') {
    throw new TemplateFillError('invalid-options', 'requireClean 必须是布尔值');
  }
  if (options.repair !== undefined && typeof options.repair !== 'boolean') {
    throw new TemplateFillError('invalid-options', 'repair 必须是布尔值');
  }
  if (options.lint.checks !== undefined && !Array.isArray(options.lint.checks)
    || options.lint.fonts !== undefined && (!options.lint.fonts
      || !Array.isArray(options.lint.fonts.available) || !Array.isArray(options.lint.fonts.embedded))) {
    throw new TemplateFillError('invalid-options', '布局检查的 checks 和字体库存必须使用数组');
  }
  if (options.lint.fonts && [...options.lint.fonts.available, ...options.lint.fonts.embedded]
    .some(font => typeof font !== 'string' || !font.trim())) {
    throw new TemplateFillError('invalid-options', '字体库存必须使用非空字体名');
  }
  for (const signal of [options.signal, options.lint.signal]) {
    if (signal !== undefined && (typeof signal?.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TemplateFillError('invalid-options', '取消信号必须是 AbortSignal');
    }
  }
  return { ...options, lint: { ...options.lint,
    ...(options.lint.checks ? { checks: [...options.lint.checks] } : {}),
    ...(options.lint.fonts ? { fonts: { available: [...options.lint.fonts.available], embedded: [...options.lint.fonts.embedded] } } : {}),
  } };
}

async function templateBytes(source: Uint8Array | BuiltinTemplateId): Promise<Uint8Array> {
  if (typeof source === 'string') {
    const { createPptxFromTemplate } = await import('../templates');
    try { return createPptxFromTemplate(source); }
    catch (error) { throw new TemplateFillError('template-not-found', String(error), null, 'template'); }
  }
  try { return copyImageBytes(source, '模板字节'); }
  catch (error) { throw new TemplateFillError('invalid-template', error instanceof Error ? error.message : String(error)); }
}

async function privateDocument(bytes: Uint8Array, prefix: string): Promise<{ presentation: Presentation; doc: EditDoc; editor: Editor }> {
  const presentation = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
  let doc: EditDoc | undefined;
  try {
    doc = createDoc(presentation, { idPrefix: prefix });
    if (doc.meta.source !== 'pptx' || doc.meta.readonly || !doc.package) {
      throw new TemplateFillError('unsupported-template', '模板必须是可编辑的 OOXML PPTX/POTX 文稿');
    }
    return { presentation, doc, editor: new Editor(doc) };
  } catch (error) {
    if (doc) disposeDoc(doc); else presentation.dispose?.();
    throw error;
  }
}

async function savedBytes(doc: EditDoc): Promise<Uint8Array> {
  const saved = await serializeEditDoc(doc);
  if (saved.package !== doc.package) disposeOpcPackage(saved.package);
  return saved.bytes;
}

/** 返回的身份来自最终文件；生成期间的临时 ID 不向调用者冒充跨保存身份。 */
export async function fillTemplate(
  source: Uint8Array | BuiltinTemplateId,
  input: TemplateFillOutline,
  options: TemplateFillOptions,
): Promise<TemplateFillResult> {
  options = snapshotOptions(options);
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  const signals = [options.signal, options.lint.signal].filter((signal): signal is AbortSignal => !!signal);
  for (const signal of signals) {
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  }
  let current: Awaited<ReturnType<typeof privateDocument>> | undefined;
  const release = () => {
    if (!current) return;
    current.editor.dispose(); disposeDoc(current.doc); current = undefined;
  };
  try {
    requireActive(lifetime.signal);
    const { outline, images } = prepareOutline(input);
    const copied = outline;
    const bytes = await templateBytes(source);
    requireActive(lifetime.signal);
    const prefix = options.idPrefix ?? 'template-fill-';
    current = await privateDocument(bytes, prefix);
    requireActive(lifetime.signal);
    const prepared = prepareTemplatePackage(bytes);
    if (prepared !== bytes) {
      release();
      current = await privateDocument(prepared, prefix);
      requireActive(lifetime.signal);
    }
    const repairs: TemplateRepair[] = [];
    if (options.repair !== false) {
      const design = await repairTemplate(current.doc, current.editor, options.lint,
        { signal: lifetime.signal, phase: 'design' });
      repairs.push(...design.repairs);
      if (design.changed) {
        const revised = await savedBytes(current.doc);
        release();
        current = await privateDocument(revised, prefix);
      }
      requireActive(lifetime.signal);
    }
    const plans = planTemplateSlides(current.doc, copied.slides);
    const chartStyles = plans.map(plan => plan.object ? chartSlotStyle(current!.doc, plan.object) : {});
    const inventory = [...(options.lint.fonts?.available ?? []), ...(options.lint.fonts?.embedded ?? [])];
    const knownFonts = new Set(inventory.map(font => font.trim().toLowerCase()));
    const fallbackFont = inventory.find(font => !['serif', 'sans-serif', 'monospace', 'system-ui'].includes(font.trim().toLowerCase()));
    chartStyles.forEach((style, index) => {
      if (options.repair === false || copied.slides[index].type !== 'chart' || !fallbackFont
        || !style.fontFamily || knownFonts.has(style.fontFamily.trim().toLowerCase())) return;
      repairs.push({ elementId: null, slideNumber: index + 1, source: null, reason: 'missing-font',
        action: 'select-chart-font', before: { font: style.fontFamily }, after: { font: fallbackFont } });
      style.fontFamily = fallbackFont;
    });
    const pages = materializeOutline(current.editor, copied.slides, plans, images, lifetime.signal);
    const placements: TemplateChartPlacement[] = copied.slides.flatMap((slide, index) => {
      if (slide.type !== 'chart') return [];
      const slot = plans[index].object!;
      return [{ slidePart: pages[index].slidePart, rect: slot.rect, chart: slide.chart,
        rot: slot.rot, flipH: slot.flipH, flipV: slot.flipV, ...chartStyles[index] }];
    });
    const saved = await savedBytes(current.doc);
    requireActive(lifetime.signal);
    let output = seedTemplateCharts(saved, placements);
    release();
    current = await privateDocument(output, prefix);
    requireActive(lifetime.signal);
    if (options.repair !== false) {
      const repaired = await repairTemplate(current.doc, current.editor, options.lint,
        { signal: lifetime.signal, phase: 'all' });
      repairs.push(...repaired.repairs);
      if (repaired.changed) {
        output = await savedBytes(current.doc);
        release();
        current = await privateDocument(output, prefix);
      }
      requireActive(lifetime.signal);
    }
    const description = describePresentation(current.doc);
    const bindings: TemplateFillBinding[] = copied.slides.map((slide, index) => {
      const slideId = current!.doc.slideOrder[index];
      const plan = plans[index];
      const objectIds = current!.doc.slides[slideId].children.filter(id => {
        const record = current!.doc.elements[id];
        return record.meta.origin?.part === current!.doc.slides[slideId].origin?.part
          && (slide.type === 'image' ? record.src.kind === 'image'
            : slide.type === 'chart' && !!chartPartForElement(current!.doc, id));
      });
      if ((slide.type === 'image' || slide.type === 'chart') && objectIds.length !== 1) {
        throw new TemplateFillError('invalid-result', `第 ${index + 1} 页预期一个原生 ${slide.type} 对象，实际 ${objectIds.length} 个`, index + 1);
      }
      return { slideNumber: index + 1, slideId, layoutId: plan.layoutId,
        titleId: pageSlot(current!.doc, slideId, plan.title),
        bodyIds: plan.bodies.map(slot => pageSlot(current!.doc, slideId, slot)), objectId: objectIds[0] ?? null };
    });
    const lint = await lintPresentation(current.doc, { ...options.lint, signal: lifetime.signal });
    requireActive(lifetime.signal);
    if (options.requireClean !== false && lint.issues.length) {
      const first = lint.issues[0];
      throw new TemplateFillError('layout-invalid',
        `生成文稿有 ${lint.issues.length} 项布局问题；首项为第 ${first.slideNumber} 页 ${first.elementId} 的 ${first.reason}`,
        first.slideNumber, null, first.elementId, lint);
    }
    const canonicalRepairs = repairs.map(repair => {
      if (!repair.source) {
        if (repair.action !== 'select-chart-font' || repair.slideNumber === null) return repair;
        const id = bindings[repair.slideNumber - 1].objectId;
        return { ...repair, elementId: id, source: id ? current!.doc.elements[id].meta.origin ?? null : null };
      }
      const record = Object.values(current!.doc.elements).find(element =>
        element.meta.origin?.part === repair.source!.part && element.meta.origin.spid === repair.source!.spid);
      return { ...repair, elementId: record?.id ?? null };
    });
    return { bytes: output, description, lint, bindings, repairs: canonicalRepairs };
  } catch (error) {
    if (error instanceof TemplateFillError) throw error;
    const detail = error as { reason?: unknown; slideNumber?: unknown; elementId?: unknown; field?: unknown };
    const reason = typeof detail?.reason === 'string' ? detail.reason : 'template-fill-failed';
    throw new TemplateFillError(reason, error instanceof Error ? error.message : String(error),
      typeof detail?.slideNumber === 'number' ? detail.slideNumber : null,
      typeof detail?.field === 'string' ? detail.field : null,
      typeof detail?.elementId === 'string' ? detail.elementId : null);
  } finally {
    release();
    for (const signal of signals) signal.removeEventListener('abort', abort);
  }
}
