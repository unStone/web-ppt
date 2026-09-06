import type { EditorSession } from '@web-ppt/editor';
import { disposeOpcPackage } from '@web-ppt/edit-core/opc';

/** 序列化与交付分离：文件流 close 失败时不能提前移动保存点。 */
export async function prepareFileSave(session: EditorSession) {
  const editor = session.editor;
  const confirm = editor.captureSavepoint();
  let changed = false;
  const release = editor.subscribe(change => { if (change.source !== 'selection') changed = true; });
  try {
    const doc = editor.doc;
    const result = await (await import('@web-ppt/edit-core/save')).serializeEditDoc(doc);
    if (result.package !== doc.package) disposeOpcPackage(result.package);
    return {
      bytes: result.bytes,
      get changed() { return changed || session.disposed; },
      confirm(): boolean {
        if (session.disposed) return false;
        confirm();
        return !editor.isDirty();
      },
      release,
    };
  } catch (error) { release(); throw error; }
}

export async function writeLocalFile(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* 保留原始交付错误，不用清理错误覆盖它。 */ }
    throw error;
  }
}
