import type { OpcPackage } from '@web-ppt/core';
import type { EditDoc } from './types';
import { registeredEditExtensions } from './extension-runtime';
import { assertSaveExtensions } from './save/extension-availability';

/** 资源身份描述复制时的有效内容；临时部件不提交到源包或保存基线。 */
export function clipboardPackage(doc: EditDoc): OpcPackage {
  const pkg = doc.package;
  if (!pkg) throw new Error('复制资源缺少 OPC 包');
  assertSaveExtensions(doc);
  const parts = { ...pkg.parts };
  for (const extension of registeredEditExtensions().values()) extension.copyParts?.(doc, parts);
  return { ...pkg, parts };
}
