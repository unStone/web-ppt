import type { Presentation, SlideElement } from '@web-ppt/core';
import { initialFractionalIndex } from './fractional-index';
import type { OwnedOpcPackage } from './opc-owner-protocol';
import type {
  CreateDocOptions, EditDoc, EditableKind, ElementId, ElementMeta, ElementRecord, SlideId, SlideSource,
} from './types';

let sessionSerial = 0;
const disposers = new WeakMap<EditDoc, () => void>();
const disposed = new WeakSet<EditDoc>();

function sessionPrefix(explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  sessionSerial++;
  const words = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(words);
  const entropy = words[0] || words[1]
    ? `${words[0].toString(36)}${words[1].toString(36)}`
    : `${Date.now().toString(36)}${sessionSerial.toString(36)}`;
  return `d${entropy}-`;
}

function intrinsicEditable(el: SlideElement): EditableKind {
  if (el.editInfo?.editable) return el.editInfo.editable;
  if (el.kind === 'unsupported') return 'frame';
  // 旧解析结果没有 editable 标记时仍安全降级；名称由解析器自己生成，不依赖文件语言。
  if (el.kind === 'group' && (el.name === '图表' || el.name === 'SmartArt' || el.name === '墨迹')) {
    return 'frame';
  }
  return 'full';
}

function metaOf(el: SlideElement, inherited: EditableKind, source: Presentation['source']): ElementMeta {
  const own = intrinsicEditable(el);
  const info = el.editInfo;
  const lacksWriteAnchor = source === 'pptx' && !info?.origin;
  const editable = inherited === 'full' && !lacksWriteAnchor ? own : 'none';
  return {
    ...(info?.geom ? { geom: info.geom } : {}),
    ...(info?.placeholder ? { ph: info.placeholder } : {}),
    ...(info?.origin ? { origin: info.origin } : {}),
    editable,
  };
}

function slideSource(slide: Presentation['slides'][number]): SlideSource {
  const { elements: _elements, editInfo: _editInfo, ...src } = slide;
  return src;
}

export function createDoc(pres: Presentation, opts: CreateDocOptions = {}): EditDoc {
  const prefix = sessionPrefix(opts.idPrefix);
  const slides: EditDoc['slides'] = {};
  const elements: EditDoc['elements'] = {};
  const slideOrder: SlideId[] = [];
  let slideSeq = 0;
  let elementSeq = 0;

  const addElements = (
    source: SlideElement[],
    parent: SlideId | ElementId,
    inherited: EditableKind,
  ): ElementId[] => source.map((el, index) => {
    const id = `${prefix}e${(++elementSeq).toString(36)}`;
    const meta = metaOf(el, inherited, pres.source);
    const record: ElementRecord = {
      id,
      parent,
      z: initialFractionalIndex(index),
      src: el,
      ovr: {},
      meta,
    };
    elements[id] = record;
    if (el.kind === 'group') record.children = addElements(el.children, id, meta.editable);
    return id;
  });

  // 访问每一项会固化惰性 getter；EditDoc 自身最终只有普通对象和数组。
  for (const slide of pres.slides) {
    const id = `${prefix}s${(++slideSeq).toString(36)}`;
    const record = {
      id,
      src: slideSource(slide),
      ovr: {},
      children: [] as ElementId[],
      origin: slide.editInfo?.origin ?? null,
    };
    slides[id] = record;
    slideOrder.push(id);
    record.children = addElements(slide.elements, id, 'full');
  }

  const pkg = pres.package ?? null;
  const patchable = pres.source === 'pptx'
    ? !!pkg && !pkg.disposed && slideOrder.every((id) => slides[id].origin !== null)
    : true;
  const doc: EditDoc = {
    meta: { width: pres.width, height: pres.height, source: pres.source, readonly: !patchable },
    identity: { prefix, nextSlide: slideSeq + 1, nextElement: elementSeq + 1 },
    slides,
    slideOrder,
    elements,
    package: pkg,
  };
  if (pres.dispose) disposers.set(doc, pres.dispose);
  return doc;
}

export function createEmptyDoc(opts: { width: number; height: number; idPrefix?: string }): EditDoc {
  if (!Number.isFinite(opts.width) || opts.width <= 0 || !Number.isFinite(opts.height) || opts.height <= 0) {
    throw new Error('页面宽高必须是有限正数');
  }
  const prefix = sessionPrefix(opts.idPrefix);
  return {
    meta: { width: opts.width, height: opts.height, source: 'pptx', readonly: false },
    identity: { prefix, nextSlide: 1, nextElement: 1 },
    slides: {},
    slideOrder: [],
    elements: {},
    package: null,
  };
}

export function allocateSlideId(doc: EditDoc): SlideId {
  for (;;) {
    const id = `${doc.identity.prefix}s${(doc.identity.nextSlide++).toString(36)}`;
    if (!doc.slides[id] && !doc.elements[id]) return id;
  }
}

export function allocateElementId(doc: EditDoc): ElementId {
  for (;;) {
    const id = `${doc.identity.prefix}e${(doc.identity.nextElement++).toString(36)}`;
    if (!doc.elements[id] && !doc.slides[id]) return id;
  }
}

/** EditDoc 不内嵌函数，资源释放能力由 WeakMap 关联，因而文档本身仍可结构化克隆。 */
export function disposeDoc(doc: EditDoc): void {
  if (disposed.has(doc)) return;
  disposed.add(doc);
  const pkg = doc.package;
  disposers.get(doc)?.();
  disposers.delete(doc);
  // dispose 是非枚举属性：分入口打包仍能释放最新包，同时不进入 structuredClone 结果。
  (pkg as OwnedOpcPackage | null)?.dispose?.();
  doc.package = null;
}
