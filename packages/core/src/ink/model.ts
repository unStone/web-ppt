import { attr, kid, kids, parseXml } from '../xml';
export interface InkPoint { x: number; y: number; values: number[] }
export interface InkStroke { id: string; points: InkPoint[]; channels: string[]; color: string; width: number }
export interface InkData { strokes: InkStroke[]; bounds: { x: number; y: number; width: number; height: number } }
export const INK = 'http://www.w3.org/2003/InkML';
export const allInk = (root: Element, name: string) => [...root.getElementsByTagName('*')].filter((n) => n.namespaceURI === INK && n.localName === name);
/** 数字可直接与下一个带符号值或差分前缀相接，不能按空格切分 Office 的 trace。 */
export function decodeInkPoints(text: string, channels: string[]): InkPoint[] {
  if (text.length > 4_000_000) throw new Error('InkML 采样数据超限');
  const points: InkPoint[] = [], values: number[] = [], delta: number[] = [], modes: string[] = [];
  const xi = channels.indexOf('X'), yi = channels.indexOf('Y');
  if (xi < 0 || yi < 0 || channels.length > 32) throw new Error('InkML 通道不支持编辑');
  for (const chunk of text.split(',')) {
    if (!chunk.trim()) continue;
    const re = /\s*([!'\"]?)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\*)/gy;
    let at = 0, index = 0;
    while (at < chunk.length && chunk.slice(at).trim()) {
      re.lastIndex = at; const match = re.exec(chunk);
      if (!match || index >= channels.length) throw new Error('InkML 含无法编辑的采样编码');
      at = re.lastIndex; const [, prefix, token] = match;
      if (token !== '*') {
        const n = Number(token); if (!Number.isFinite(n)) throw new Error('InkML 非有限采样值');
        const mode = !points.length ? '!' : prefix || modes[index] || '!'; modes[index] = mode;
        if (mode === "'") { delta[index] = n; values[index] = (values[index] ?? 0) + n; }
        else if (mode === '"') { delta[index] = (delta[index] ?? 0) + n; values[index] = (values[index] ?? 0) + delta[index]; }
        else { values[index] = n; delta[index] = 0; }
      }
      if (!Number.isFinite(values[index])) throw new Error('InkML 缺少首点通道值');
      index++;
    }
    if (!Number.isFinite(values[xi]) || !Number.isFinite(values[yi])) throw new Error('InkML 缺少坐标');
    points.push({ x: values[xi], y: values[yi], values: values.slice(0, index) });
    if (points.length > 100000) throw new Error('InkML 笔画采样超限');
  }
  return points;
}

export function readInkData(xml: string): InkData { return readInkRoot(parseXml(xml)); }
export function readInkRoot(root: Element): InkData { if (root.namespaceURI !== INK || root.localName !== 'ink') throw new Error('不是 InkML 文档');
  const nodes = [root, ...root.getElementsByTagName('*')], ids = new Map<string, Element>();
  const parents = new Map<Element, Element>();
  for (const n of nodes) for (const c of Array.from(n.children)) parents.set(c, n);
  const inherited = (node: Element, key: string): string | null => {
    let current: Element | undefined = node;
    while (current) { const value = attr(current, key); if (value !== null) return value; current = parents.get(current); }
    return null;
  };
  for (const node of nodes) {
    const id = attr(node, 'xml:id'); if (!id) continue;
    if (ids.has(id)) throw new Error('InkML 身份重复'); ids.set(id, node);
  }
  const lookup = (ref: string | null) => ref?.startsWith('#') ? ids.get(ref.slice(1)) : undefined;
  const traces = allInk(root, 'trace'), strokes: InkStroke[] = [];
  if (traces.length > 1000) throw new Error('InkML 笔画数量超限');
  const globalFormat = kid(root, 'traceFormat') ?? allInk(root, 'traceFormat')[0];
  const brushes = allInk(root, 'brush');
  let bounds: InkData['bounds'] | undefined, total = 0;
  traces.forEach((trace, index) => {
    const contexts: Element[] = [], seen = new Set<Element>();
    let context = lookup(inherited(trace, 'contextRef'));
    while (context) {
      if (seen.has(context) || contexts.length > 32) throw new Error('InkML 上下文引用循环');
      seen.add(context); contexts.push(context); context = lookup(attr(context, 'contextRef'));
    }
    const contextAttr = (name: string) => contexts.map((c) => attr(c, name)).find((v) => v !== null) ?? null;
    const contextChild = (name: string) => contexts.map((c) => kid(c, name)).find((v) => v !== null) ?? null;
    const source = contextChild('inkSource') ?? lookup(contextAttr('inkSourceRef'));
    const format = contextChild('traceFormat') ?? lookup(contextAttr('traceFormatRef')) ?? kid(source ?? null, 'traceFormat') ?? globalFormat;
    const channels = format ? kids(format, 'channel').map((n) => (attr(n, 'name') ?? '').toUpperCase()) : ['X', 'Y'];
    const points = decodeInkPoints(trace.textContent ?? '', channels);
    if ((total += points.length) > 100000) throw new Error('InkML 采样总量超限');
    const brush = lookup(inherited(trace, 'brushRef')) ?? lookup(contextAttr('brushRef')) ?? brushes[0];
    let color = '#000000', width = 0;
    for (const property of kids(brush ?? null, 'brushProperty')) {
      const name = attr(property, 'name')?.toLowerCase(), value = attr(property, 'value') ?? '';
      if (name === 'color') color = /^[\da-f]{6}$/i.test(value) ? '#' + value : value;
      else if (name === 'width' || name === 'height') width = Math.max(width, Number(value) || 0);
    }
    const canvas = lookup(contextAttr('canvasRef')), canvasFormat = kid(canvas ?? null, 'traceFormat');
    const x = kids(canvasFormat, 'channel').find((n) => attr(n, 'name') === 'X'), y = kids(canvasFormat, 'channel').find((n) => attr(n, 'name') === 'Y');
    if (x && y && ['min', 'max'].every((key) => attr(x, key) !== null && attr(y, key) !== null)) {
      const b = { x: Number(attr(x, 'min')), y: Number(attr(y, 'min')), width: Number(attr(x, 'max')) - Number(attr(x, 'min')), height: Number(attr(y, 'max')) - Number(attr(y, 'min')) };
      if (Object.values(b).every(Number.isFinite) && b.width >= 0 && b.height >= 0) {
        if (bounds && JSON.stringify(bounds) !== JSON.stringify(b)) throw new Error('InkML 多画布不支持共同编辑'); bounds = b;
      }
    }
    strokes.push({ id: attr(trace, 'xml:id') ?? `trace-${index + 1}`, points, channels, color, width });
  });
  if (!bounds) {
    let x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const stroke of strokes) for (const p of stroke.points) { x = Math.min(x, p.x); y = Math.min(y, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
    bounds = Number.isFinite(x) ? { x, y, width: x2 - x, height: y2 - y } : { x: 0, y: 0, width: 1, height: 1 };
  }
  return { strokes, bounds };
}
