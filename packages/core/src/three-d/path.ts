export interface Point { x: number; y: number }
export interface Ring { points: Point[]; closed: boolean }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** 挤出侧面需要离散轮廓；正面继续使用原 SVG，不把贝塞尔和文字降为位图。 */
export function flattenPath(path: string, tolerance = 0.5): Ring[] {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  if (tokens.length > 200000) throw new Error('三维轮廓超出复杂度限制');
  let at = 0, command = '', current: Point = { x: 0, y: 0 }, start = current, lastC: Point | undefined, lastQ: Point | undefined;
  const rings: Ring[] = []; let ring: Ring | undefined, count = 0;
  const scalar = () => { const n = Number(tokens[at++]); if (!Number.isFinite(n)) throw new Error('三维路径参数不足'); return n; };
  const add = (p: Point) => {
    if (!ring) throw new Error('三维轮廓缺少起点');
    if (++count > 20000) throw new Error('三维轮廓顶点超限');
    if (!ring.points.length || distance(ring.points[ring.points.length - 1], p) > 1e-8) ring.points.push(p);
    current = p;
  };
  const cubic = (a: Point, b: Point, c: Point, d: Point, depth = 0): void => {
    const flat = distance(a, b) + distance(b, c) + distance(c, d) - distance(a, d);
    if (depth >= 12 || flat < tolerance) { add(d); return; }
    const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd);
    cubic(a, ab, abc, center, depth + 1); cubic(center, bcd, cd, d, depth + 1);
  };
  while (at < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[at])) command = tokens[at++];
    else if (!command || command.toUpperCase() === 'Z') throw new Error('三维路径命令缺失');
    const relative = command === command.toLowerCase(), kind = command.toUpperCase(), origin = current;
    const point = (): Point => ({ x: scalar() + (relative ? origin.x : 0), y: scalar() + (relative ? origin.y : 0) });
    if (kind === 'M') { const p = point(); ring = { points: [], closed: false }; rings.push(ring); add(p); start = p; command = relative ? 'l' : 'L'; }
    else if (kind === 'Z') { if (ring) ring.closed = true; current = start; }
    else if (kind === 'L') add(point());
    else if (kind === 'H') add({ x: scalar() + (relative ? origin.x : 0), y: origin.y });
    else if (kind === 'V') add({ x: origin.x, y: scalar() + (relative ? origin.y : 0) });
    else if (kind === 'C' || kind === 'S') {
      const b = kind === 'C' ? point() : lastC ? { x: 2 * origin.x - lastC.x, y: 2 * origin.y - lastC.y } : origin;
      const c = point(), d = point(); cubic(origin, b, c, d); lastC = c;
    } else if (kind === 'Q' || kind === 'T') {
      const q = kind === 'Q' ? point() : lastQ ? { x: 2 * origin.x - lastQ.x, y: 2 * origin.y - lastQ.y } : origin, d = point();
      cubic(origin, { x: origin.x + (q.x - origin.x) * 2 / 3, y: origin.y + (q.y - origin.y) * 2 / 3 },
        { x: d.x + (q.x - d.x) * 2 / 3, y: d.y + (q.y - d.y) * 2 / 3 }, d); lastQ = q;
    } else if (kind === 'A') {
      const rx = scalar(), ry = scalar(), rotation = scalar(), large = scalar(), sweep = scalar(), end = point();
      for (const p of arcPoints(origin, end, rx, ry, rotation, !!large, !!sweep, tolerance)) add(p);
    } else throw new Error(`三维路径不支持 ${command}`);
    if (kind !== 'C' && kind !== 'S') lastC = undefined;
    if (kind !== 'Q' && kind !== 'T') lastQ = undefined;
  }
  for (const r of rings) if (r.points.length > 1 && distance(r.points[0], r.points[r.points.length - 1]) < 1e-8) r.points.pop();
  return rings.filter(r => r.points.length > 1);
}

function arcPoints(a: Point, b: Point, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, tolerance: number): Point[] {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || distance(a, b) < 1e-8) return [b];
  const phi = rotation * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (a.x - b.x) / 2, dy = (a.y - b.y) / 2, x = cos * dx + sin * dy, y = -sin * dx + cos * dy;
  const correction = Math.sqrt(Math.max(1, x * x / (rx * rx) + y * y / (ry * ry))); rx *= correction; ry *= correction;
  const multiplier = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x)));
  const cx1 = multiplier * rx * y / ry, cy1 = -multiplier * ry * x / rx;
  const cx = cos * cx1 - sin * cy1 + (a.x + b.x) / 2, cy = sin * cx1 + cos * cy1 + (a.y + b.y) / 2;
  const start = Math.atan2((y - cy1) / ry, (x - cx1) / rx);
  let delta = Math.atan2((-y - cy1) / ry, (-x - cx1) / rx) - start;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const count = Math.max(1, Math.min(1024, Math.ceil(Math.abs(delta) / (2 * Math.acos(Math.max(-1, 1 - tolerance / Math.max(rx, ry)))))));
  return Array.from({ length: count }, (_, i) => {
    const angle = start + delta * (i + 1) / count;
    return { x: cx + cos * rx * Math.cos(angle) - sin * ry * Math.sin(angle), y: cy + sin * rx * Math.cos(angle) + cos * ry * Math.sin(angle) };
  });
}

export function inset(points: Point[], width: number): Point[] {
  if (!width) return points;
  return points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
    const a = Math.max(1e-8, distance(prev, p)), b = Math.max(1e-8, distance(p, next));
    const ax = -(p.y - prev.y) / a, ay = (p.x - prev.x) / a, bx = -(next.y - p.y) / b, by = (next.x - p.x) / b;
    const factor = Math.min(width * 4, width / Math.max(0.25, 1 + ax * bx + ay * by));
    return { x: p.x + (ax + bx) * factor, y: p.y + (ay + by) * factor };
  });
}
