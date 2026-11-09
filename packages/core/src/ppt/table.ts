/**
 * .ppt 表格还原：二进制格式只存一组单元格形状，表格结构由几何关系推出。
 */
import type { ShapeElement, SlideElement, TableCell, TableElement, TableRow } from '../types';

/**
 * 把落在同一格的多个图形合并成一个单元格：
 * 包围盒基本重合时，取有填充的那个作底色、有文字的那个作内容。
 */
export function mergeCellLayers(els: SlideElement[]): SlideElement[] {
  const shapes = els.filter((e): e is ShapeElement => e.kind === 'shape');
  if (shapes.length !== els.length) return els;

  const TOL = 3;
  const out: ShapeElement[] = [];
  for (const s of shapes) {
    const hit = out.find(
      (o) => Math.abs(o.x - s.x) <= TOL && Math.abs(o.y - s.y) <= TOL &&
        Math.abs(o.w - s.w) <= TOL * 2 && Math.abs(o.h - s.h) <= TOL * 2,
    );
    if (!hit) {
      out.push({ ...s });
      continue;
    }
    if (!hit.text && s.text) hit.text = s.text;
    if ((!hit.fill || hit.fill.type === 'none') && s.fill && s.fill.type !== 'none') hit.fill = s.fill;
    if (!hit.stroke && s.stroke) hit.stroke = s.stroke;
  }
  return out;
}

/**
 * 网格启发式：一组矩形要构成表格，需满足行列都 ≥2、单元格数接近行列乘积、
 * 且相邻单元格紧邻（无明显间隙）。条件从严，避免把普通图形组误判成表格。
 */
export function looksLikeGrid(cells: SlideElement[]): boolean {
  const shapes = cells.filter((c): c is ShapeElement => c.kind === 'shape' && c.path !== null);
  if (shapes.length < 4 || shapes.length !== cells.length) return false;

  const TOL = 2.5;
  const cluster = (vals: number[]): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > TOL) out.push(v);
    return out;
  };
  const cols = cluster(shapes.map((s) => s.x));
  const rows = cluster(shapes.map((s) => s.y));
  if (cols.length < 2 || rows.length < 2) return false;
  if (shapes.length > cols.length * rows.length) return false;
  // 允许合并单元格造成的缺口，但不能太稀疏
  if (shapes.length < cols.length * rows.length * 0.5) return false;

  // 相邻列/行之间不能有空隙：下一条边界应落在上一格右/下边缘附近
  const edgeFits = (edges: number[], starts: number[], ends: number[]): boolean => {
    for (let i = 0; i + 1 < edges.length; i++) {
      const near = starts.some((s, k) => Math.abs(s - edges[i]) <= TOL && Math.abs(ends[k] - edges[i + 1]) <= TOL * 2);
      if (!near) return false;
    }
    return true;
  };
  const okCols = edgeFits(cols, shapes.map((s) => s.x), shapes.map((s) => s.x + s.w));
  const okRows = edgeFits(rows, shapes.map((s) => s.y), shapes.map((s) => s.y + s.h));
  return okCols && okRows;
}

/**
 * 由单元格形状还原表格结构。
 * 二进制格式不直接存列宽，用所有单元格的左边界聚类得到列边界，
 * 单元格跨列数由其宽度覆盖了几个列区间推出。
 */
export function buildTable(cells: SlideElement[], rowHeights: number[]): TableElement | null {
  const shapes = cells.filter((c): c is ShapeElement => c.kind === 'shape');
  if (shapes.length < 2) return null;

  const TOL = 2;
  const uniq = (vals: number[]): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > TOL) out.push(v);
    return out;
  };

  const colEdges = uniq(shapes.map((s) => s.x));
  const rowEdges = uniq(shapes.map((s) => s.y));
  if (colEdges.length < 1 || rowEdges.length < 1) return null;

  const x0 = colEdges[0];
  const y0 = rowEdges[0];
  const right = Math.max(...shapes.map((s) => s.x + s.w));
  const bottom = Math.max(...shapes.map((s) => s.y + s.h));

  const colWidths = colEdges.map((edge, i) => (i + 1 < colEdges.length ? colEdges[i + 1] : right) - edge);
  const heights = rowEdges.map((edge, i) => (i + 1 < rowEdges.length ? rowEdges[i + 1] : bottom) - edge);
  const finalHeights = rowHeights.length === rowEdges.length ? rowHeights : heights;

  const colOf = (x: number): number => {
    let best = 0;
    for (let i = 0; i < colEdges.length; i++) if (x >= colEdges[i] - TOL) best = i;
    return best;
  };
  const rowOf = (y: number): number => {
    let best = 0;
    for (let i = 0; i < rowEdges.length; i++) if (y >= rowEdges[i] - TOL) best = i;
    return best;
  };

  const grid: (TableCell | null)[][] = rowEdges.map(() => colEdges.map(() => null));
  for (const s of shapes) {
    const r = rowOf(s.y);
    const c = colOf(s.x);
    if (grid[r][c]) continue;
    let colSpan = 0;
    for (let i = c; i < colEdges.length && colEdges[i] < s.x + s.w - TOL; i++) colSpan++;
    let rowSpan = 0;
    for (let i = r; i < rowEdges.length && rowEdges[i] < s.y + s.h - TOL; i++) rowSpan++;
    grid[r][c] = {
      colSpan: Math.max(1, colSpan),
      rowSpan: Math.max(1, rowSpan),
      merged: false,
      fill: s.fill,
      text: s.text,
      borders: { l: s.stroke, r: s.stroke, t: s.stroke, b: s.stroke },
      vAlign: s.text?.anchor === 'middle' ? 'middle' : s.text?.anchor === 'bottom' ? 'bottom' : 'top',
    };
    // 被跨越覆盖的格子标记为已合并
    for (let rr = r; rr < r + Math.max(1, rowSpan); rr++) {
      for (let cc = c; cc < c + Math.max(1, colSpan); cc++) {
        if (rr === r && cc === c) continue;
        if (grid[rr]?.[cc] === null) {
          grid[rr][cc] = { colSpan: 1, rowSpan: 1, merged: true, fill: null, text: null };
        }
      }
    }
  }

  const rows: TableRow[] = grid.map((cellRow, i) => ({
    height: finalHeights[i] ?? 0,
    cells: cellRow.map((c) => c ?? { colSpan: 1, rowSpan: 1, merged: false, fill: null, text: null }),
  }));

  return {
    kind: 'table',
    x: x0, y: y0, w: right - x0, h: bottom - y0,
    rot: 0, flipH: false, flipV: false,
    colWidths,
    rows,
    name: '表格',
  };
}
