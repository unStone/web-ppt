import { readInkData } from '@web-ppt/core/ink-edit';
import type { InkData } from '@web-ppt/core/ink-edit';
import { parseXmlTree, serializeXmlTree, xmlElementChildren, createXmlElement, createXmlText,
  insertXmlChildUnchecked as append, removeXmlChild, setXmlAttribute } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { attr, child } from '../ole/container';
import { INK } from './source';
const descendants = (root: XmlElement, name: string) => {
  const result: XmlElement[] = [], pending = [root];
  while (pending.length) { const n = pending.pop()!; if (n.namespaceUri === INK && n.localName === name) result.push(n); pending.push(...xmlElementChildren(n).reverse()); }
  return result;
};
export function normalizeInkData(input: unknown): InkData {
  const data = input as InkData;
  if (!data || !Array.isArray(data.strokes) || !data.strokes.length || data.strokes.length > 1000 || !data.bounds) throw new Error('墨迹笔画数量无效');
  const { x, y, width, height } = data.bounds;
  if (![x, y, width, height].every((v) => Number.isFinite(v) && Math.abs(v) < 1e9) || width < 0 || height < 0) throw new Error('墨迹画布无效');
  const ids = new Set<string>(); let count = 0;
  const strokes = data.strokes.map((stroke) => {
    if (!stroke || typeof stroke.id !== 'string' || !/^[a-z_][\w.-]{0,100}$/i.test(stroke.id) || ids.has(stroke.id)) throw new Error('墨迹笔画身份无效'); ids.add(stroke.id);
    if (!Array.isArray(stroke.channels) || stroke.channels.length < 2 || stroke.channels.length > 32 || new Set(stroke.channels).size !== stroke.channels.length
      || !stroke.channels.includes('X') || !stroke.channels.includes('Y') || stroke.channels.some((name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,30}$/.test(name))) throw new Error('墨迹采样通道无效');
    if (!Array.isArray(stroke.points) || stroke.points.length < 2 || (count += stroke.points.length) > 100000) throw new Error('墨迹采样数量无效');
    if (!Number.isFinite(stroke.width) || stroke.width < 0 || stroke.width > 1e6 || typeof stroke.color !== 'string'
      || !/^(?:#[\da-f]{3}(?:[\da-f]{3})?|[a-z]{1,30}|rgba?\([\d.,%\s]+\))$/i.test(stroke.color)) throw new Error('墨迹笔刷无效');
    const points = stroke.points.map((p) => {
      if (!p || ![p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) < 1e9) || !Array.isArray(p.values)
        || p.values.length > stroke.channels.length || !p.values.every((n) => Number.isFinite(n) && Math.abs(n) < 1e12)) throw new Error('墨迹采样值无效');
      const values = [...p.values]; values[stroke.channels.indexOf('X')] = p.x; values[stroke.channels.indexOf('Y')] = p.y;
      return { x: p.x, y: p.y, values };
    });
    return { id: stroke.id, points, channels: [...stroke.channels], color: stroke.color, width: stroke.width };
  });
  return { strokes, bounds: { x, y, width, height } };
}

/** 未改笔画的压力、时间及未知元数据保留；编辑用独立 brush/context，避免共享定义联动。 */
export function writeInkData(source: string, data: InkData): string {
  const original = readInkData(source), tree = parseXmlTree(source), traces = descendants(tree.root, 'trace');
  const targets = new Map(original.strokes.map((stroke, i) => [stroke.id, traces[i]]));
  const selected = new Set(data.strokes.map((s) => s.id));
  const parents = new Map<XmlElement, XmlElement>(), pending = [tree.root];
  while (pending.length) { const n = pending.pop()!; for (const c of xmlElementChildren(n)) { parents.set(c, n); pending.push(c); } }
  let definitions = child(tree.root, 'definitions');
  if (!definitions) { definitions = createXmlElement('inkml:definitions', { attributes: [['xmlns:inkml', INK]] }); append(tree.root, definitions, xmlElementChildren(tree.root)[0] ?? null); }
  const ids = new Set<string>(); for (const n of [tree.root, ...parents.keys()]) { const id = n.attributes.find((a) => a.name === 'xml:id')?.value; if (id) ids.add(id); }
  const unique = (base: string) => { let id = base, i = 1; while (ids.has(id)) id = base + i++; ids.add(id); return id; };
  const add = (parent: XmlElement, name: string, attributes: [string, string][] = []) => {
    const n = createXmlElement('inkml:' + name, { attributes: [['xmlns:inkml', INK], ...attributes] }); append(parent, n); return n;
  };
  const canvasId = unique('webPptInkCanvas'), canvas = add(definitions, 'canvas', [['xml:id', canvasId]]), canvasFormat = add(canvas, 'traceFormat');
  for (const name of ['X', 'Y'] as const) {
    const min = name === 'X' ? data.bounds.x : data.bounds.y, span = name === 'X' ? data.bounds.width : data.bounds.height;
    add(canvasFormat, 'channel', [['name', name], ['type', 'decimal'], ['min', String(min)], ['max', String(min + span)]]);
  }
  for (const [id, trace] of targets) if (!selected.has(id)) removeXmlChild(parents.get(trace)!, trace);
  for (const [i, stroke] of data.strokes.entries()) {
    let trace = targets.get(stroke.id);
    if (!trace) { if (ids.has(stroke.id)) throw new Error('新增墨迹身份与原始定义冲突'); trace = add(tree.root, 'trace', [['xml:id', stroke.id]]); }
    const contextId = unique('webPptInkContext' + i), context = add(definitions, 'context', [['xml:id', contextId], ['canvasRef', '#' + canvasId]]);
    const format = add(context, 'traceFormat');
    for (const channel of stroke.channels) add(format, 'channel', [['name', channel], ['type', 'decimal']]);
    // contextRef 继承时间戳、来源设备等；显式 traceFormat 固定编辑后数据的通道顺序。
    let owner: XmlElement | undefined = trace;
    while (owner) { const ref = attr(owner, 'contextRef'); if (ref) { setXmlAttribute(context, 'contextRef', ref); break; } owner = parents.get(owner); }
    setXmlAttribute(trace, 'contextRef', '#' + contextId);
    const brushId = unique('webPptInkBrush' + i), brush = add(definitions, 'brush', [['xml:id', brushId]]);
    for (const [name, value] of [['width', String(stroke.width)], ['height', String(stroke.width)], ['color', stroke.color]]) add(brush, 'brushProperty', [['name', name], ['value', value]]);
    setXmlAttribute(trace, 'brushRef', '#' + brushId);
    for (const n of [...trace.children]) if (n.type === 'text' || n.type === 'cdata') removeXmlChild(trace, n);
    append(trace, createXmlText(stroke.points.map((p) => stroke.channels.map((_, j) => '!' + (p.values[j] ?? 0)).join(' ')).join(',')));
  }
  return serializeXmlTree(tree);
}
