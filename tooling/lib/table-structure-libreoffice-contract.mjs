import { basename } from 'node:path';

const close = (left, right, tolerance = 40) => Math.abs(left - right) <= tolerance;

function tableFragment(markup) {
  const match = markup.match(
    /<g class="com\.sun\.star\.drawing\.TableShape">\s*<g>([\s\S]*?)<\/g>\s*<\/g>/,
  );
  if (!match) throw new Error('LibreOffice 表格结构 SVG 缺少 TableShape');
  return match[1];
}

function lineSegments(fragment) {
  return [...fragment.matchAll(/<path fill="none" stroke="rgb\(0,0,0\)"[^>]*\bd="([^"]+)"/g)]
    .map((match) => match[1].match(
      /M\s*(-?[\d.]+),?\s*(-?[\d.]+)\s+L\s*(-?[\d.]+),?\s*(-?[\d.]+)/,
    ))
    .filter(Boolean)
    .map((match) => ({ x1: Number(match[1]), y1: Number(match[2]), x2: Number(match[3]), y2: Number(match[4]) }));
}

function pathBounds(tag) {
  const values = tag.match(/\bd="([^"]+)"/)?.[1].match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (values.length < 8 || values.length % 2) throw new Error('LibreOffice 表格填充路径坐标无效');
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function mergedGridOracle(fragment) {
  if (!fragment.includes('>结构写回</tspan>')) throw new Error('LibreOffice 合并表格缺少目标文字');
  const segments = lineSegments(fragment);
  const verticals = segments.filter((line) => close(line.x1, line.x2, 0.01));
  const horizontals = segments.filter((line) => close(line.y1, line.y2, 0.01));
  if (!verticals.length || !horizontals.length) throw new Error('LibreOffice 合并表格缺少网格线');
  const left = Math.min(...verticals.map((line) => line.x1));
  const right = Math.max(...verticals.map((line) => line.x1));
  const top = Math.min(...horizontals.map((line) => line.y1));
  const bottom = Math.max(...horizontals.map((line) => line.y1));
  const fullVerticals = verticals.filter((line) =>
    close(Math.min(line.y1, line.y2), top) && close(Math.max(line.y1, line.y2), bottom));
  const internal = fullVerticals.find((line) => !close(line.x1, left) && !close(line.x1, right));
  const split = horizontals.find((line) => line.y1 > top + 40 && line.y1 < bottom - 40
    && internal && close(Math.min(line.x1, line.x2), internal.x1)
    && close(Math.max(line.x1, line.x2), right));
  const crossedMerge = horizontals.some((line) => split && close(line.y1, split.y1)
    && Math.min(line.x1, line.x2) < internal.x1 - 40);
  const fills = fragment.match(/<path\b[^>]*\bfill="rgb\([^)]*\)"[^>]*stroke="none"[^>]*>/g) ?? [];
  const merged = fills.find((tag) => tag.includes('fill="rgb(161,178,195)"'));
  const lowerRight = fills.find((tag) => tag.includes('fill="rgb(114,159,207)"'));
  if (!internal || !split || crossedMerge || fills.length !== 2 || !merged || !lowerRight) {
    throw new Error(`LibreOffice 合并表格拓扑无效：lines=${segments.length} fills=${fills.length}`);
  }
  const mergedBounds = pathBounds(merged);
  const lowerBounds = pathBounds(lowerRight);
  if (![mergedBounds.left - left, mergedBounds.right - internal.x1, mergedBounds.top - top,
    mergedBounds.bottom - bottom, lowerBounds.left - internal.x1, lowerBounds.right - right,
    lowerBounds.top - split.y1, lowerBounds.bottom - bottom].every((value) => Math.abs(value) <= 40)) {
    throw new Error('LibreOffice 合并表格填充区域与网格拓扑不一致');
  }
  return `2×3 网格保留 2×2 合并区（${segments.length} 条可见边）`;
}

function decomposedGridOracle(fragment) {
  const expectedText = ['横向合并', '右上', '右上末', '纵向占位', '下二', '下三'];
  if (expectedText.some((text) => !fragment.includes(`>${text}</tspan>`))) {
    throw new Error('LibreOffice 拆分表格没有显示六个逻辑格文字');
  }
  const segments = lineSegments(fragment);
  const verticals = segments.filter((line) => close(line.x1, line.x2, 0.01));
  const horizontals = segments.filter((line) => close(line.y1, line.y2, 0.01));
  const left = Math.min(...verticals.map((line) => line.x1));
  const right = Math.max(...verticals.map((line) => line.x1));
  const top = Math.min(...horizontals.map((line) => line.y1));
  const bottom = Math.max(...horizontals.map((line) => line.y1));
  const fullVerticals = verticals.filter((line) => close(Math.min(line.y1, line.y2), top)
    && close(Math.max(line.y1, line.y2), bottom));
  const fullHorizontals = horizontals.filter((line) => close(Math.min(line.x1, line.x2), left)
    && close(Math.max(line.x1, line.x2), right));
  if (segments.length !== 7 || fullVerticals.length !== 4 || fullHorizontals.length !== 3) {
    throw new Error(`LibreOffice 拆分表格网格不完整：all=${segments.length} vertical=${fullVerticals.length} horizontal=${fullHorizontals.length}`);
  }
  return '删除穿过来源合并区后得到完整 2×3 网格（4 纵线/3 横线）';
}

function adjacentMergeOracle(fragment) {
  const segments = lineSegments(fragment);
  const verticals = segments.filter((line) => close(line.x1, line.x2, 0.01));
  const horizontals = segments.filter((line) => close(line.y1, line.y2, 0.01));
  const unique = (values) => [...values].sort((left, right) => left - right)
    .filter((value, index, all) => index === 0 || !close(value, all[index - 1]));
  const xs = unique(verticals.map((line) => line.x1));
  const ys = unique(horizontals.map((line) => line.y1));
  if (xs.length !== 5 || ys.length !== 5) {
    throw new Error(`LibreOffice 相邻合并网格边界无效：x=${xs.length} y=${ys.length}`);
  }
  const coversVertical = (x, from, to) => verticals.some((line) => close(line.x1, x)
    && Math.min(line.y1, line.y2) <= from + 40 && Math.max(line.y1, line.y2) >= to - 40);
  const coversHorizontal = (y, from, to) => horizontals.some((line) => close(line.y1, y)
    && Math.min(line.x1, line.x2) <= from + 40 && Math.max(line.x1, line.x2) >= to - 40);
  const topology = coversVertical(xs[1], ys[0], ys[2])
    && !coversVertical(xs[1], ys[2], ys[4])
    && coversVertical(xs[2], ys[0], ys[4])
    && coversVertical(xs[3], ys[0], ys[2])
    && !coversVertical(xs[3], ys[2], ys[3])
    && coversVertical(xs[3], ys[3], ys[4])
    && !coversHorizontal(ys[1], xs[0], xs[3])
    && coversHorizontal(ys[1], xs[3], xs[4])
    && coversHorizontal(ys[2], xs[0], xs[4])
    && coversHorizontal(ys[3], xs[0], xs[4]);
  if (!topology) throw new Error('LibreOffice 相邻纵向、横向与 L 形合并拓扑不一致');
  return `相邻纵向、横向与 L 形合并保持独立（${segments.length} 条可见边）`;
}

export function runTableStructureLibreOfficeContract({ savedPath, exportSvg }) {
  const name = basename(savedPath);
  if (!['table-structure-patch.pptx', 'table-structure-generated.pptx',
    'table-structure-delete.pptx', 'table-structure-adjacent-merges.pptx'].includes(name)) return '';
  const fragment = tableFragment(exportSvg('表格结构网格'));
  const evidence = name === 'table-structure-delete.pptx' ? decomposedGridOracle(fragment)
    : name === 'table-structure-adjacent-merges.pptx' ? adjacentMergeOracle(fragment)
      : mergedGridOracle(fragment);
  return `，${evidence}`;
}
