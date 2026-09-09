import { canonicalExtensionPath, EXTENSION_ADDRESSES } from '@web-ppt/edit-core';
import type { EditDoc, Patch } from '@web-ppt/edit-core';
import { newer } from './state';
import type { Register } from './state';

/** 地址变化不产生字段写入；归并寄存器只能比较原 stamp，不能借用迁移声明的时钟。 */
export function canonicalRegisters(doc: EditDoc, registers: Map<string, Register>): Map<string, Register> {
  if (!doc.extensions?.[EXTENSION_ADDRESSES]) return registers;
  const result = new Map<string, Register>();
  for (const [key, register] of registers) {
    let mapped = key;
    try {
      if (key.startsWith('["elements",')) mapped = JSON.stringify(canonicalExtensionPath(doc, JSON.parse(key) as Patch['path']));
    } catch { /* checkpoint 的其他协议键是透明字符串，不能把它们当作本版本的字段地址。 */ }
    if (newer(register.stamp, result.get(mapped))) result.set(mapped, register);
  }
  return result;
}
