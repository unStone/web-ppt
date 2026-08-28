import { validateEditDoc } from '../model-invariants';
import { createOpcPackage } from '../opc/patch';
import type { OpcPatchResult } from '../opc/types';
import type { EditDoc } from '../types';
import { materializeGeneratedParts } from './materialize';

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
