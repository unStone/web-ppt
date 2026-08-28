import { validateEditDoc } from '../model-invariants';
import { createOpcPackage, disposeOpcPackage } from '../opc/patch';
import type { OpcPatchResult } from '../opc/types';
import type { EditDoc } from '../types';
import { materializeGeneratedParts } from './materialize';
import { generatedTemplateParts } from './template';

export interface CreateBlankPptxOptions {
  /** 页面单位与统一 Schema 一致，使用 CSS px；默认值等价于 12192000×6858000 EMU。 */
  readonly width?: number;
  readonly height?: number;
}

/** 创建带一张空白页、最小主题/母版及常用版式目录的确定性 PPTX。 */
export function createBlankPptx(options: CreateBlankPptxOptions = {}): Uint8Array {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('页面宽高必须是有限正数');
  }
  const result = createOpcPackage(generatedTemplateParts(width, height, 1));
  disposeOpcPackage(result.package);
  return result.bytes;
}

/** 没有可补丁原包时从统一编辑模型构造新 PPTX；本函数不改变 EditDoc。 */
export function generateEditDoc(doc: EditDoc): OpcPatchResult {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能生成保存');
  // 释放原包后来源 part 身份仍用于投影，但字节已不可验证；只在校验快照中采用
  // readonly 的“包不可用”语义，生成器本身仍拒绝真正的只读文档。
  validateEditDoc(doc.package?.disposed
    ? { ...doc, meta: { ...doc.meta, readonly: true }, package: null }
    : doc);
  if (doc.meta.source === 'pptx' && doc.package && !doc.package.disposed) {
    throw new Error('存在可补丁原包时必须使用补丁保存');
  }
  return createOpcPackage(materializeGeneratedParts(doc));
}

export type { OpcPatchResult } from '../opc/types';
