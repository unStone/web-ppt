import type {
  CustomGeometry, CustomGeometryCommand, CustomGeometryPath, CustomGeometryPoint,
} from '@web-ppt/core';
import { arcToCubicSegments } from '@web-ppt/core/geometry';

const EMU_PER_PX = 9525;
const scalar = (value: number) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return { expression: String(rounded), value: rounded };
};

interface MutablePath {
  id: string;
  width: number;
  height: number;
  fill: string;
  stroke: boolean;
  extrusionOk: boolean;
  closed: boolean;
  commands: CustomGeometryCommand[];
}

function svgTokens(d: string): string[] {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const normalized = d.replace(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?|[\s,]/g, '');
  if (normalized) throw new Error('SVG path 包含不支持的语法');
  return tokens;
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/** SVG 端点弧先转中心参数，再物化为可拖动的三次贝塞尔段。 */
function svgArc(
  fromX: number,
  fromY: number,
  values: readonly number[],
): { segments: ReturnType<typeof arcToCubicSegments>; x: number; y: number } {
  let [rx, ry, rotation, largeArc, sweep, x, y] = values;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rotation !== 0) throw new Error('预设路径含不支持的旋转椭圆弧');
  if (!rx || !ry || (fromX === x && fromY === y)) {
    throw new Error('预设路径含无法物化的退化椭圆弧');
  }
  const dx = (fromX - x) / 2;
  const dy = (fromY - y) / 2;
  const lambda = dx * dx / (rx * rx) + dy * dy / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx);
  const denominator = rx * rx * dy * dy + ry * ry * dx * dx;
  const coefficient = (largeArc === sweep ? -1 : 1) * Math.sqrt(numerator / denominator);
  const centerPrimeX = coefficient * rx * dy / ry;
  const centerPrimeY = coefficient * -ry * dx / rx;
  const ux = (dx - centerPrimeX) / rx;
  const uy = (dy - centerPrimeY) / ry;
  const vx = (-dx - centerPrimeX) / rx;
  const vy = (-dy - centerPrimeY) / ry;
  const start = vectorAngle(1, 0, ux, uy);
  let delta = vectorAngle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  return {
    segments: arcToCubicSegments(fromX, fromY, rx, ry, start * 180 / Math.PI, delta * 180 / Math.PI),
    x, y,
  };
}

/** 将 core 已求值的预设 SVG 路径显式物化为稳定寻址的自由形状模型。 */
export function customGeometryFromSvgPath(
  d: string,
  width: number,
  height: number,
  open = false,
): CustomGeometry {
  if (typeof d !== 'string' || !d.trim()) throw new Error('SVG path 不能为空');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('自由形状坐标空间必须大于零');
  }
  const tokens = svgTokens(d);
  const paths: MutablePath[] = [];
  let path: MutablePath | null = null;
  let cursor = 0;
  let command = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cubicControl: readonly [number, number] | null = null;
  let quadControl: readonly [number, number] | null = null;
  const read = (count: number): number[] => {
    const values = tokens.slice(cursor, cursor + count).map(Number);
    if (values.length !== count || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`SVG path 命令 ${command} 参数不足`);
    }
    cursor += count;
    return values;
  };
  const ensurePath = (): MutablePath => {
    if (!path) throw new Error('SVG path 必须从 M 开始');
    return path;
  };
  const point = (px: number, py: number, role: 'anchor' | 'control', id: string): CustomGeometryPoint => ({
    id, role, x: scalar(px * EMU_PER_PX), y: scalar(py * EMU_PER_PX),
  });
  const push = (
    type: 'move' | 'line' | 'quadratic' | 'cubic',
    values: readonly (readonly [number, number])[],
  ): void => {
    const target = ensurePath();
    const id = `${target.id}-c${target.commands.length}`;
    target.commands.push({
      id, type,
      points: values.map(([px, py], index) =>
        point(px, py, index === values.length - 1 ? 'anchor' : 'control',
          `${id}-${index === values.length - 1 ? 'a' : `c${index}`}`)),
    } as CustomGeometryCommand);
    [x, y] = values[values.length - 1];
  };
  const finish = (): void => {
    if (!path) return;
    paths.push(path);
    path = null;
  };
  while (cursor < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[cursor])) command = tokens[cursor++];
    if (!command || command !== command.toUpperCase()) throw new Error('只支持 core 生成的绝对 SVG path');
    if (command === 'Z') {
      const target = ensurePath();
      if (cursor === tokens.length) target.closed = true;
      else target.commands.push({ id: `${target.id}-c${target.commands.length}`, type: 'close', points: [] });
      x = startX;
      y = startY;
      cubicControl = null;
      quadControl = null;
      command = '';
      continue;
    }
    if (command === 'M') {
      const [nextX, nextY] = read(2);
      path ??= {
        id: `p${paths.length}`, width: width * EMU_PER_PX, height: height * EMU_PER_PX,
        fill: open ? 'none' : 'norm', stroke: true, extrusionOk: true, closed: false, commands: [],
      };
      startX = nextX;
      startY = nextY;
      push('move', [[nextX, nextY]]);
      command = 'L';
    } else if (command === 'L') {
      const values = read(2);
      push('line', [[values[0], values[1]]]);
    } else if (command === 'H') push('line', [[read(1)[0], y]]);
    else if (command === 'V') push('line', [[x, read(1)[0]]]);
    else if (command === 'C') {
      const values = read(6);
      push('cubic', [[values[0], values[1]], [values[2], values[3]], [values[4], values[5]]]);
      cubicControl = [values[2], values[3]];
      quadControl = null;
    } else if (command === 'S') {
      const values = read(4);
      const first: readonly [number, number] = cubicControl
        ? [2 * x - cubicControl[0], 2 * y - cubicControl[1]] : [x, y];
      push('cubic', [first, [values[0], values[1]], [values[2], values[3]]]);
      cubicControl = [values[0], values[1]];
      quadControl = null;
    } else if (command === 'Q') {
      const values = read(4);
      push('quadratic', [[values[0], values[1]], [values[2], values[3]]]);
      quadControl = [values[0], values[1]];
      cubicControl = null;
    } else if (command === 'T') {
      const values = read(2);
      const control: readonly [number, number] = quadControl
        ? [2 * x - quadControl[0], 2 * y - quadControl[1]] : [x, y];
      push('quadratic', [control, [values[0], values[1]]]);
      quadControl = control;
      cubicControl = null;
    } else if (command === 'A') {
      const arc = svgArc(x, y, read(7));
      for (const segment of arc.segments) push('cubic', segment);
      x = arc.x;
      y = arc.y;
      cubicControl = null;
      quadControl = null;
    } else throw new Error(`不支持 SVG path 命令：${command}`);
    if (!['C', 'S'].includes(command)) cubicControl = null;
    if (!['Q', 'T'].includes(command)) quadControl = null;
  }
  finish();
  return { adjustments: [], guides: [], paths: paths as CustomGeometryPath[] };
}
