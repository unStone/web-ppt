import type { EditDoc, SlideRecord } from '../types';

/** 有可补丁原包时返回 OOXML 宿主；否则让命令只改统一模型，保存时由生成器物化宿主。 */
export function incrementalInsertionPart(doc: EditDoc, slide: SlideRecord): string | null {
  if (doc.meta.source !== 'pptx' || !doc.package || doc.package.disposed) return null;
  const part = slide.origin?.part;
  if (!part || (!doc.package.parts[part] && !slide.creation)) {
    throw new Error(`幻灯片 ${slide.id} 缺少可写 OOXML 宿主`);
  }
  return part;
}
