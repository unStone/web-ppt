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

export function runTableStructureLibreOfficeContract({ savedPath, exportSvg }) {
  const name = basename(savedPath);
  if (!['table-structure-patch.pptx', 'table-structure-generated.pptx',
    'table-structure-delete.pptx'].includes(name)) return '';
  const fragment = tableFragment(exportSvg('表格结构网格'));
  const evidence = name === 'table-structure-delete.pptx'
    ? decomposedGridOracle(fragment) : mergedGridOracle(fragment);
  return `，${evidence}`;
}
