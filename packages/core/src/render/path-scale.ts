import { round as r } from './serialize';

/**
 * 按轴缩放 SVG path data，覆盖 SVG 1.1 全部路径命令（含相对命令、隐式重复与紧凑弧线标志）。
 *
 * 组合的外框映射只能改几何，不能像 `scale()` 那样连描边一起放大；解析期路径已按子坐标外框生成，
 * 渲染时只能对 path data 本身做缩放。core 只允许 fflate 一个运行时依赖，所以这里实现完整语法。
 */

type Arg = 'x' | 'y' | 'flag' | 'rx' | 'ry' | 'angle';

const ARGS: Record<string, readonly Arg[]> = {
  m: ['x', 'y'], l: ['x', 'y'], t: ['x', 'y'],
  h: ['x'], v: ['y'],
  c: ['x', 'y', 'x', 'y', 'x', 'y'],
  s: ['x', 'y', 'x', 'y'], q: ['x', 'y', 'x', 'y'],
  a: ['rx', 'ry', 'angle', 'flag', 'flag', 'x', 'y'],
  z: [],
};

interface Segment { command: string; values: number[] }

const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

function parsePathData(d: string): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  const invalid = (expected: string): Error =>
    new Error(`路径数据无效：位置 ${at} 期望${expected}，实际为「${d.slice(at, at + 12)}」（${d.slice(0, 60)}）`);
  const skipSeparators = (): void => {
    while (at < d.length && isSpace(d[at])) at++;
    if (d[at] === ',') {
      at++;
      while (at < d.length && isSpace(d[at])) at++;
    }
  };
  const readNumber = (): number => {
    const start = at;
    if (d[at] === '+' || d[at] === '-') at++;
    let digits = 0;
    while (isDigit(d[at])) { at++; digits++; }
    if (d[at] === '.') {
      at++;
      while (isDigit(d[at])) { at++; digits++; }
    }
    if (!digits) { at = start; throw invalid('数值'); }
    if (d[at] === 'e' || d[at] === 'E') {
      const exponent = at;
      at++;
      if (d[at] === '+' || d[at] === '-') at++;
      if (!isDigit(d[at])) { at = exponent; throw invalid('指数'); }
      while (isDigit(d[at])) at++;
    }
    return Number(d.slice(start, at));
  };
  const readFlag = (): number => {
    if (d[at] !== '0' && d[at] !== '1') throw invalid('弧线标志 0 或 1');
    return Number(d[at++]);
  };
  while (at < d.length && isSpace(d[at])) at++;
  while (at < d.length) {
    const command = d[at];
    const args = ARGS[command.toLowerCase()];
    if (!args) throw invalid('路径命令');
    if (!segments.length && command.toLowerCase() !== 'm') throw invalid('以 M/m 开头');
    at++;
    skipSeparators();
    if (!args.length) {
      segments.push({ command, values: [] });
      continue;
    }
    // 同一命令字母后可跟多组参数；M/m 之后的隐式重复按 L/l 解释。
    let repeat = command;
    do {
      const values = args.map((arg, index) => {
        if (index) skipSeparators();
        return arg === 'flag' ? readFlag() : readNumber();
      });
      segments.push({ command: repeat, values });
      if (repeat === 'M') repeat = 'L';
      else if (repeat === 'm') repeat = 'l';
      skipSeparators();
    } while (at < d.length && !ARGS[d[at].toLowerCase()]);
  }
  return segments;
}

/** 轴对齐缩放把椭圆 diag(rx,ry) 旋转 φ 后再拉伸；新半轴与倾角取 M·Mᵀ 的特征分解。 */
function scaleArc(rx: number, ry: number, angle: number, kx: number, ky: number): [number, number, number] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  if (kx === ky || sin === 0 || cos === 0) {
    const swap = cos === 0 && sin !== 0;
    return [rx * (swap ? ky : kx), ry * (swap ? kx : ky), angle];
  }
  const a = (rx * rx * cos * cos + ry * ry * sin * sin) * kx * kx;
  const b = (rx * rx - ry * ry) * cos * sin * kx * ky;
  const c = (rx * rx * sin * sin + ry * ry * cos * cos) * ky * ky;
  const mean = (a + c) / 2;
  const spread = Math.hypot((a - c) / 2, b);
  return [
    Math.sqrt(mean + spread),
    Math.sqrt(Math.max(0, mean - spread)),
    Math.atan2(2 * b, a - c) / 2 * 180 / Math.PI,
  ];
}

export function scalePathData(d: string, kx: number, ky: number): string {
  if (!(Number.isFinite(kx) && kx > 0 && Number.isFinite(ky) && ky > 0)) {
    throw new Error(`路径缩放比例必须是正有限数：kx=${kx}，ky=${ky}`);
  }
  return parsePathData(d).map(({ command, values }) => {
    const args = ARGS[command.toLowerCase()];
    if (args.includes('rx')) {
      const [rx, ry, angle] = scaleArc(values[0], values[1], values[2], kx, ky);
      values = [rx, ry, angle, values[3], values[4], values[5] * kx, values[6] * ky];
    } else {
      values = values.map((value, index) => value * (args[index] === 'y' ? ky : kx));
    }
    return values.length ? `${command} ${values.map(r).join(' ')}` : command;
  }).join(' ');
}
