import { sourcePartBytes } from '@web-ppt/edit-core';
import type { EditDoc, Editor, ElementId, ExtensionCommand, ExtensionPatch } from '@web-ppt/edit-core';
import { renderDiagramXml } from '@web-ppt/core/diagram-edit';
import { objectSource } from '../object-source';
import { registerEditExtension } from '../extension-runtime';
import { DGM, normalizeNodes, readSmartArtNodes, writeSmartArtNodes } from './model';
import type { SmartArtNode } from './model';
import { saveSmartArt, storedSmartArt } from './save';

export type { SmartArtNode } from './model';
const namespace = 'smartart';
const source = (doc: EditDoc, id: ElementId) => {
  const value = objectSource(doc, id, DGM, 'dm'); if (!value) throw new Error('对象不是 SmartArt'); return value;
};
export function querySmartArt(doc: EditDoc, id: ElementId): SmartArtNode[] {
  const value = storedSmartArt(doc, id); return value ? normalizeNodes(JSON.parse(value)) : readSmartArtNodes(source(doc, id).xml);
}
function validatePatch(doc: EditDoc, patch: ExtensionPatch) {
  if (patch.path[0] !== 'elements' || patch.path.length !== 6 || patch.path[5] !== 'value') throw new Error('SmartArt 补丁路径无效');
  const original = source(doc, patch.path[1]);
  if (patch.op === 'set') {
    if (typeof patch.value !== 'string' || patch.value.length > 1000000) throw new Error('SmartArt 补丁值无效');
    writeSmartArtNodes(original.xml, normalizeNodes(JSON.parse(patch.value)));
  }
}
function command(doc: EditDoc, cmd: ExtensionCommand, origin: string) {
  if (doc.meta.readonly) throw new Error('文稿只读');
  const original = source(doc, cmd.id), before = storedSmartArt(doc, cmd.id);
  let value = cmd.payload === null ? undefined : JSON.stringify(normalizeNodes(cmd.payload));
  if (value === JSON.stringify(readSmartArtNodes(original.xml))) value = undefined;
  if (value !== undefined) writeSmartArtNodes(original.xml, JSON.parse(value));
  const path = ['elements', cmd.id, 'ovr', 'extensions', namespace, 'value'] as const;
  if (before === value) return { forward: [], inverse: [] };
  const patch = (v: string | undefined) => v === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, value: v, origin };
  return { forward: [patch(value)], inverse: [patch(before)] };
}
registerEditExtension(namespace, { command, validatePatch,
  project(doc, id, element) {
    const value = storedSmartArt(doc, id); if (!value || element.kind !== 'group') return element;
    const original = source(doc, id), data = writeSmartArtNodes(original.xml, normalizeNodes(JSON.parse(value)));
    const text = (part: string | undefined) => part ? new TextDecoder().decode(sourcePartBytes(doc, part)) : undefined;
    return { ...element, children: renderDiagramXml(data, text(original.references.lo), text(original.references.cs), element.w, element.h, original.context) };
  },
  materializePackage: saveSmartArt,
  generateParts(doc, parts) {
    const changes: Record<string, Uint8Array | null> = { ...parts };
    saveSmartArt(doc, {}, new Set(), changes, true);
    for (const [part, bytes] of Object.entries(changes)) { if (bytes) parts[part] = bytes; else delete parts[part]; }
  },
});
export function listEditableSmartArt(doc: EditDoc) {
  return Object.values(doc.elements).filter((record) => objectSource(doc, record.id, DGM, 'dm'))
    .map((record) => ({ id: record.id, name: record.src.name ?? 'SmartArt' }));
}
export function createSmartArtEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  const change = (id: ElementId, action: (nodes: SmartArtNode[]) => void) => {
    const nodes = querySmartArt(editor.doc, id); action(nodes);
    editor.exec({ type: 'Extension', namespace, id, payload: nodes });
  };
  const node = (nodes: SmartArtNode[], id: string) => {
    const current = nodes.find((n) => n.id === id); if (!current) throw new Error('SmartArt 节点不存在'); return current;
  };
  return {
    query: (id: ElementId) => querySmartArt(editor.doc, id),
    setText(id: ElementId, nodeId: string, text: string) { change(id, (nodes) => { node(nodes, nodeId).text = text; }); },
    addNode(id: ElementId, parentId: string | null, text: string, nodeId = `{${crypto.randomUUID().toUpperCase()}}`) {
      change(id, (nodes) => { nodes.push({ id: nodeId, parentId, text }); }); return nodeId;
    },
    removeNode(id: ElementId, nodeId: string) {
      change(id, (nodes) => {
        node(nodes, nodeId); const removed = new Set([nodeId]);
        for (let changed = true; changed;) {
          changed = false;
          for (const n of nodes) if (n.parentId && removed.has(n.parentId) && !removed.has(n.id)) { removed.add(n.id); changed = true; }
        }
        for (let i = nodes.length - 1; i >= 0; i--) if (removed.has(nodes[i].id)) nodes.splice(i, 1);
      });
    },
    moveNode(id: ElementId, nodeId: string, parentId: string | null, beforeId?: string) {
      change(id, (nodes) => {
        const target = node(nodes, nodeId); target.parentId = parentId;
        if (beforeId === nodeId) return;
        nodes.splice(nodes.indexOf(target), 1);
        const before = beforeId ? node(nodes, beforeId) : undefined;
        if (before && before.parentId !== parentId) throw new Error('SmartArt 排序目标不是同级节点');
        nodes.splice(before ? nodes.indexOf(before) : nodes.length, 0, target);
      });
    },
    reset(id: ElementId) { editor.exec({ type: 'Extension', namespace, id, payload: null }); },
  };
}
