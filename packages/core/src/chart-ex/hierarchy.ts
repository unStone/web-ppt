import type { Rect } from '../chart/util';
import type { Series } from './model';
export interface TreeNode {
  name: string;
  value: number;
  point: number;
  children: TreeNode[];
}
/** 父空槽仅在同一祖先内继承；末端空槽表示短分支，不能沿用上一叶子。 */
export function hierarchy(series: Series): TreeNode {
  const levels = [...series.categories].reverse();
  if (!levels.length || levels.length > 32)
    throw new Error('ChartEx 层级缺失或过深');
  const root: TreeNode = { name: '', value: 0, point: -1, children: [] };
  let previous: string[] = [];
  const paths = new Set<string>();
  const max = series.values.reduce<number>((n, v) => Math.max(n, v ?? 0), 0);
  if (!(max > 0))
    throw new Error('ChartEx 层级无正面积');
  series.values.forEach((value, point) => {
    if (value !== null && value < 0)
      throw new Error('ChartEx 层级负面积');
    const raw = levels.map((level) => level[point] ?? '');
    let last = raw.length - 1;
    while (last >= 0 && !raw[last])
      last--;
    if (last < 0)
      throw new Error('ChartEx 层级路径缺失');
    const path: string[] = [];
    for (let depth = 0; depth <= last; depth++) {
      const sameParent = path.every((name, at) => name === previous[at]);
      const name = raw[depth] || (sameParent ? previous[depth] : '');
      if (!name)
        throw new Error('ChartEx 层级父路径不明');
      path.push(name);
    }
    previous = path;
    if (value === null || value === 0)
      return;
    const key = JSON.stringify(path);
    if (paths.has(key))
      throw new Error('ChartEx 同路径重复叶未定义');
    paths.add(key);
    let parent = root;
    const weight = value / max;
    if (!(weight > 0)) throw new Error('ChartEx 层级权重下溢');
    parent.value += weight;
    path.forEach((name, depth) => {
      let node = parent.children.find((child) => child.name === name);
      if (!node) {
        node = { name, value: 0, point, children: [] };
        parent.children.push(node);
      }
      if (depth < path.length - 1 && paths.has(JSON.stringify(path.slice(0, depth + 1))))
        throw new Error('ChartEx 父叶角色冲突');
      if (depth === path.length - 1 && node.children.length)
        throw new Error('ChartEx 父叶角色冲突');
      node.value += weight;
      parent = node;
    });
  });
  return root;
}
export interface Tile {
  node: TreeNode;
  rect: Rect;
}
/** 稳定面积排序与 squarify；相等权重沿用源点序，不受字符串排序影响。 */
export function squarify(nodes: readonly TreeNode[], region: Rect): Tile[] {
  const sorted = [...nodes].filter((n) => n.value > 0).sort((a, b) => b.value - a.value || a.point - b.point);
  const total = sorted.reduce((n, item) => n + item.value, 0);
  if (!total || !(region.w > 0 && region.h > 0))
    return [];
  const area = region.w * region.h;
  const values = sorted.map((node) => ({ node, area: node.value / total * area }));
  const result: Tile[] = [];
  let rest = { ...region }, at = 0;
  const worst = (row: typeof values, side: number): number => {
    const sum = row.reduce((n, item) => n + item.area, 0);
    if (!sum || !side)
      return Infinity;
    return Math.max(side * side * row[0].area / (sum * sum), sum * sum / (side * side * row[row.length - 1].area));
  };
  while (at < values.length) {
    const side = Math.min(rest.w, rest.h);
    const row = [values[at++]];
    while (at < values.length && worst([...row, values[at]], side) <= worst(row, side))
      row.push(values[at++]);
    const sum = row.reduce((n, item) => n + item.area, 0);
    const vertical = rest.w >= rest.h;
    const width = vertical ? sum / rest.h : rest.w;
    const height = vertical ? rest.h : sum / rest.w;
    let offset = 0;
    row.forEach((item, i) => {
      const length = i === row.length - 1 ? (vertical ? rest.h : rest.w) - offset : item.area / (vertical ? width : height);
      result.push({ node: item.node, rect: { x: rest.x + (vertical ? 0 : offset), y: rest.y + (vertical ? offset : 0), w: vertical ? width : length, h: vertical ? length : height } });
      offset += length;
    });
    rest = vertical ? { ...rest, x: rest.x + width, w: Math.max(0, rest.w - width) } : { ...rest, y: rest.y + height, h: Math.max(0, rest.h - height) };
  }
  return result;
}
export interface Sector {
  node: TreeNode;
  depth: number;
  start: number;
  end: number;
  group: number;
}
export function sunburst(root: TreeNode): {
  sectors: Sector[];
  depth: number;
} {
  const sectors: Sector[] = [];
  let depth = 0;
  const visit = (parent: TreeNode, start: number, end: number, level: number, group: number): void => {
    let angle = start;
    parent.children.forEach((node, index) => {
      const next = index === parent.children.length - 1 ? end : angle + (end - start) * node.value / parent.value;
      const branch = level === 0 ? index : group;
      sectors.push({ node, depth: level, start: angle, end: next, group: branch });
      depth = Math.max(depth, level + 1);
      if (node.children.length)
        visit(node, angle, next, level + 1, branch);
      angle = next;
    });
  };
  visit(root, -Math.PI / 2, Math.PI * 1.5, 0, 0);
  return { sectors, depth };
}
