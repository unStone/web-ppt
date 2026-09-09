import { registeredEditExtensions } from '../extension-runtime';
import type { EditDoc } from '../types';
import { assertDocumentExtensions } from '../document-extensions';
import { EXTENSION_ADDRESSES, validateExtensionAddresses } from '../extension-addresses';
import { EXTENSION_MIGRATIONS, validateExtensionMigrationReceipts } from '../extension-migration-receipt';

/** 生成与补丁保存共用扩展可用性门禁，恢复后不能静默丢弃尚未加载的覆盖。 */
export function assertSaveExtensions(doc: EditDoc): void {
  assertDocumentExtensions(doc.extensions);
  validateExtensionAddresses(doc);
  validateExtensionMigrationReceipts(doc);
  const extensions = registeredEditExtensions(), unloaded = new Set<string>();
  for (const namespace of Object.keys(doc.extensions ?? {})) {
    if (namespace === EXTENSION_ADDRESSES || namespace === EXTENSION_MIGRATIONS) continue;
    const runtime = extensions.get(namespace);
    if (!runtime) unloaded.add(namespace);
    else if (!runtime.validateDocumentPatch) throw new Error('保存扩展不支持文档级状态');
  }
  for (const scope of ['elements', 'slides'] as const) for (const record of Object.values(doc[scope])) {
    for (const namespace of Object.keys(record.ovr.extensions ?? {})) {
      const runtime = extensions.get(namespace);
      if (!runtime) unloaded.add(namespace);
      else if ((runtime.scope === 'slide' ? 'slides' : 'elements') !== scope) throw new Error('保存扩展 scope 与注册不符');
    }
  }
  if (unloaded.size) throw new Error(`保存前必须加载编辑扩展：${[...unloaded].join('、')}`);
}
