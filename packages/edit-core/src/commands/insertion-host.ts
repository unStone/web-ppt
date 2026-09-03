import { assertDesignTarget } from '../design-target';
import type {
  DesignTarget, EditDoc, ElementId, LayoutRecord, MasterRecord, SlideId, SlideRecord,
} from '../types';

export interface InsertionCanvas {
  readonly kind: 'slide' | 'layout' | 'master';
  readonly id: SlideId | string;
  readonly children: readonly ElementId[];
  readonly part: string | null;
}

/** 有可补丁原包时返回 OOXML 宿主；否则让命令只改统一模型，保存时由生成器物化宿主。 */
export function incrementalInsertionPart(doc: EditDoc, slide: SlideRecord): string | null {
  if (doc.meta.source !== 'pptx' || !doc.package || doc.package.disposed) return null;
  const part = slide.origin?.part;
  if (!part || (!doc.package.parts[part] && !slide.creation)) {
    throw new Error(`幻灯片 ${slide.id} 缺少可写 OOXML 宿主`);
  }
  return part;
}

export function incrementalLayoutInsertionPart(doc: EditDoc, layout: LayoutRecord): string | null {
  if (doc.meta.source !== 'pptx' || !doc.package || doc.package.disposed) return null;
  const part = layout.origin.part;
  if (!doc.package.parts[part]) throw new Error(`版式 ${layout.id} 缺少可写 OOXML 宿主`);
  return part;
}

export function incrementalMasterInsertionPart(doc: EditDoc, master: MasterRecord): string | null {
  if (doc.meta.source !== 'pptx' || !doc.package || doc.package.disposed) return null;
  const part = master.id;
  if (!doc.package.parts[part]) throw new Error(`母版 ${master.id} 缺少可写 OOXML 宿主`);
  return part;
}

/** 三种插入命令共享同一画布寻址，避免各自近似处理版式与页面宿主。 */
export function resolveInsertionCanvas(
  doc: EditDoc,
  command: { readonly target?: DesignTarget; readonly slideId?: SlideId },
  label: string,
): InsertionCanvas {
  const hasTarget = command.target !== undefined;
  const hasSlide = command.slideId !== undefined;
  if (hasTarget === hasSlide) throw new Error(`${label} 必须且只能指定一个画布目标`);
  if (command.target) {
    assertDesignTarget(doc, command.target);
    if (command.target.kind === 'master') {
      const master = doc.masters[command.target.id];
      return {
        kind: 'master', id: master.id, children: master.children,
        part: incrementalMasterInsertionPart(doc, master),
      };
    }
    const layout = doc.layouts[command.target.id];
    return {
      kind: 'layout', id: layout.id, children: layout.children,
      part: incrementalLayoutInsertionPart(doc, layout),
    };
  }
  const slide = doc.slides[command.slideId!];
  if (!slide) throw new Error(`找不到${label}目标页：${String(command.slideId)}`);
  return {
    kind: 'slide', id: slide.id, children: slide.children,
    part: incrementalInsertionPart(doc, slide),
  };
}
