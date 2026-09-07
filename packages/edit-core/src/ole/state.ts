import { sourcePartBytes } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { objectSource } from '../object-source';
import { readEmbeddedPackage } from './container';
import { editOleParts, normalizeOleEdits, readOleContent } from './content';

export const OLE = 'http://schemas.openxmlformats.org/presentationml/2006/ole';
export const storedOle = (doc: EditDoc, id: string) => (doc.elements[id]?.ovr.extensions?.ole as { value?: string } | undefined)?.value;
export function oleSource(doc: EditDoc, id: string) {
  const source = objectSource(doc, id, OLE); if (!source) throw new Error('对象不是 OLE 嵌入内容');
  const bytes = sourcePartBytes(doc, source.part); if (!bytes) throw new Error('OLE 原始字节已丢失');
  const pkg = readEmbeddedPackage(bytes); if (!pkg) throw new Error('此 OLE 类型不支持内容编辑');
  return { source, bytes, pkg };
}
export function oleState(doc: EditDoc, id: string) {
  const original = oleSource(doc, id), raw = storedOle(doc, id);
  const edits = raw ? normalizeOleEdits(JSON.parse(raw)) : { cells: [], paragraphs: [] };
  const changes = editOleParts(original.pkg, edits);
  const parts = { ...original.pkg.parts }; for (const [part, bytes] of Object.entries(changes)) { if (bytes) parts[part] = bytes; else delete parts[part]; }
  return { ...original, edits, changes, content: readOleContent({ ...original.pkg, parts }) };
}
