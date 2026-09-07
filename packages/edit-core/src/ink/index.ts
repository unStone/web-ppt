import { readInkData, renderInkXml } from '@web-ppt/core/ink-edit';
import type { InkData, InkPoint } from '@web-ppt/core/ink-edit';
import type { EditDoc, Editor, ElementId, ExtensionCommand, ExtensionPatch } from '@web-ppt/edit-core';
import { registerEditExtension } from '../extension-runtime';
import { inkSource } from './source';
import { normalizeInkData, writeInkData } from './model';
import { saveInk, storedInk } from './save';
export type { InkData, InkPoint, InkStroke } from '@web-ppt/core/ink-edit';
const source = (doc: EditDoc, id: string) => { const original = inkSource(doc, id); if (!original) throw new Error('对象不是可编辑墨迹'); return original; };
export function queryInk(doc: EditDoc, id: string): InkData {
  const raw = storedInk(doc, id); return raw ? normalizeInkData(JSON.parse(raw)) : readInkData(source(doc, id).xml);
}
function validate(doc: EditDoc, id: string, value: unknown) {
  const state = normalizeInkData(value); writeInkData(source(doc, id).xml, state); return state;
}
function command(doc: EditDoc, cmd: ExtensionCommand, origin: string) {
  if (doc.meta.readonly) throw new Error('文稿只读');
  const before = storedInk(doc, cmd.id), state = cmd.payload === null ? undefined : validate(doc, cmd.id, cmd.payload);
  let value = state ? JSON.stringify(state) : undefined;
  if (value === JSON.stringify(readInkData(source(doc, cmd.id).xml))) value = undefined;
  const path = ['elements', cmd.id, 'ovr', 'extensions', 'ink', 'value'] as const;
  const patch = (value: string | undefined) => value === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, origin, value };
  return before === value ? { forward: [], inverse: [] } : { forward: [patch(value)], inverse: [patch(before)] };
}
registerEditExtension('ink', { command,
  validatePatch(doc: EditDoc, patch: ExtensionPatch) {
    if (patch.path[0] !== 'elements' || patch.path.length !== 6 || patch.path[5] !== 'value') throw new Error('墨迹补丁路径无效');
    if (patch.op === 'set') { if (typeof patch.value !== 'string') throw new Error('墨迹补丁值无效'); validate(doc, patch.path[1], JSON.parse(patch.value)); }
  },
  project(doc, id, element) {
    const raw = storedInk(doc, id); if (!raw || element.kind !== 'group') return element;
    return { ...element, children: renderInkXml(writeInkData(source(doc, id).xml, normalizeInkData(JSON.parse(raw))), element.w, element.h) };
  },
  materialize(tree, record, _generated, xml) {
    if (!(record.ovr.extensions?.ink as { value?: string } | undefined)?.value) return;
    const pending = [xml.locateElementHost(tree, record).host];
    while (pending.length) { const n = pending.pop()!; if (n.localName === 'contentPart') xml.setXmlAttribute(n, 'webPptInkEdit', record.id); pending.push(...xml.xmlElementChildren(n)); }
  },
  materializePackage: saveInk,
  generateParts(doc, parts) {
    const changes: Record<string, Uint8Array | null> = { ...parts }; saveInk(doc, {}, new Set(), changes, true);
    for (const [part, bytes] of Object.entries(changes)) { if (bytes) parts[part] = bytes; else delete parts[part]; }
  },
});
export function listEditableInk(doc: EditDoc) { return Object.values(doc.elements).filter((r) => inkSource(doc, r.id)).map((r) => ({ id: r.id, name: r.src.name ?? '墨迹' })); }
export function createInkEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  const change = (id: ElementId, action: (data: InkData) => void) => { const state = queryInk(editor.doc, id); action(state); editor.exec({ type: 'Extension', namespace: 'ink', id, payload: state }); };
  const stroke = (data: InkData, strokeId: string) => { const s = data.strokes.find((s) => s.id === strokeId); if (!s) throw new Error('笔画不存在'); return s; };
  return { query: (id: ElementId) => queryInk(editor.doc, id),
    setStyle(id: ElementId, strokeId: string, style: { color?: string; width?: number }) { change(id, (data) => { const s = stroke(data, strokeId); if (style.color !== undefined) s.color = style.color; if (style.width !== undefined) s.width = style.width; }); },
    setPoints(id: ElementId, strokeId: string, points: InkPoint[]) { change(id, (data) => { stroke(data, strokeId).points = points; }); },
    translate(id: ElementId, strokeId: string, dx: number, dy: number) { change(id, (data) => { for (const p of stroke(data, strokeId).points) { p.x += dx; p.y += dy; } }); },
    addStroke(id: ElementId, points: { x: number; y: number; pressure?: number }[], style: { color: string; width: number }, strokeId = 'ink-' + crypto.randomUUID()) {
      change(id, (data) => { data.strokes.push({ id: strokeId, points: points.map((p) => ({ x: p.x, y: p.y, values: [p.x, p.y, p.pressure ?? 0.5] })), channels: ['X', 'Y', 'F'], ...style }); }); return strokeId;
    },
    removeStroke(id: ElementId, strokeId: string) {
      const data = queryInk(editor.doc, id); stroke(data, strokeId);
      if (data.strokes.length === 1) editor.exec({ type: 'RemoveElement', id });
      else change(id, (data) => { data.strokes = data.strokes.filter((s) => s.id !== strokeId); });
    },
    reset(id: ElementId) { editor.exec({ type: 'Extension', namespace: 'ink', id, payload: null }); },
  };
}
