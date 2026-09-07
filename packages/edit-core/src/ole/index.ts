import type { EditDoc, Editor, ElementId, ExtensionCommand, ExtensionPatch } from '@web-ppt/edit-core';
import { registerEditExtension } from '../extension-runtime';
import { objectSource } from '../object-source';
import { OLE, oleSource, oleState, storedOle } from './state';
import { normalizeOleEdits, editOleParts, readOleContent } from './content';
import type { OleCellValue, OleEdits } from './content';
import { olePreviewSvg } from './preview';
import { saveOle } from './save';
export type { OleCell, OleCellValue, OleSheet, OleParagraph, OleContent, OleEdits } from './content';
export { cellPosition } from './content';
export function queryOleContent(doc: EditDoc, id: ElementId) { return oleState(doc, id).content; }
export function listEditableOle(doc: EditDoc) {
  return Object.values(doc.elements).filter((record) => objectSource(doc, record.id, OLE)).flatMap((record) => {
    try { const { pkg } = oleSource(doc, record.id); return [{ id: record.id, name: record.src.name ?? 'OLE', kind: pkg.kind }]; }
    catch { return []; }
  });
}
function validate(doc: EditDoc, id: string, value: unknown): OleEdits {
  const edits = normalizeOleEdits(value); editOleParts(oleSource(doc, id).pkg, edits); return edits;
}
function command(doc: EditDoc, cmd: ExtensionCommand, origin: string) {
  if (doc.meta.readonly) throw new Error('文稿只读');
  const before = storedOle(doc, cmd.id), state = cmd.payload === null ? undefined : validate(doc, cmd.id, cmd.payload);
  const value = state && (state.cells.length || state.paragraphs.length) ? JSON.stringify(state) : undefined;
  const path = ['elements', cmd.id, 'ovr', 'extensions', 'ole', 'value'] as const;
  const patch = (value: string | undefined) => value === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, origin, value };
  return before === value ? { forward: [], inverse: [] } : { forward: [patch(value)], inverse: [patch(before)] };
}
registerEditExtension('ole', { command,
  validatePatch(doc: EditDoc, patch: ExtensionPatch) {
    if (patch.path[0] !== 'elements' || patch.path.length !== 6 || patch.path[5] !== 'value') throw new Error('OLE 补丁路径无效');
    if (patch.op === 'set') { if (typeof patch.value !== 'string') throw new Error('OLE 补丁值无效'); validate(doc, patch.path[1], JSON.parse(patch.value)); }
  },
  project(doc, id, element) {
    if (!storedOle(doc, id)) return element;
    return { ...element, kind: 'image', src: 'data:image/svg+xml,' + encodeURIComponent(olePreviewSvg(queryOleContent(doc, id))), crop: null };
  },
  materialize(tree, record, _generated, xml) {
    if (!(record.ovr.extensions?.ole as { value?: string } | undefined)?.value) return;
    const pending = [xml.locateElementHost(tree, record).host];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.localName === 'oleObj') xml.setXmlAttribute(node, 'webPptOleEdit', record.id);
      pending.push(...xml.xmlElementChildren(node));
    }
  },
  materializePackage: saveOle,
  generateParts(doc, parts) {
    const changes: Record<string, Uint8Array | null> = { ...parts }; saveOle(doc, {}, new Set(), changes, true);
    for (const [part, bytes] of Object.entries(changes)) { if (bytes) parts[part] = bytes; else delete parts[part]; }
  },
});
export function createOleEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  const change = (id: ElementId, action: (edits: OleEdits) => void) => {
    const { edits } = oleState(editor.doc, id); action(edits); editor.exec({ type: 'Extension', namespace: 'ole', id, payload: edits });
  };
  return { query: (id: ElementId) => queryOleContent(editor.doc, id),
    setCell(id: ElementId, sheet: string, ref: string, value: OleCellValue) { change(id, (edits) => {
      const original = readOleContent(oleSource(editor.doc, id).pkg); if (original.kind !== 'xlsx') throw new Error('对象不是工作簿');
      const cell = original.sheets.find((s) => s.id === sheet)?.cells.find((c) => c.ref === ref);
      edits.cells = edits.cells.filter((c) => c.sheet !== sheet || c.ref !== ref);
      if (cell?.formula !== undefined || (cell?.value ?? null) !== value) edits.cells.push({ sheet, ref, value });
    }); },
    setParagraph(id: ElementId, index: number, text: string) { change(id, (edits) => {
      const original = readOleContent(oleSource(editor.doc, id).pkg); if (original.kind !== 'docx') throw new Error('对象不是文档');
      edits.paragraphs = edits.paragraphs.filter((p) => p.index !== index);
      if (original.paragraphs[index]?.text !== text) edits.paragraphs.push({ index, text });
    }); },
    exportContent(id: ElementId) { const state = oleState(editor.doc, id); return state.pkg.wrap(state.changes); },
    reset(id: ElementId) { editor.exec({ type: 'Extension', namespace: 'ole', id, payload: null }); },
  };
}
