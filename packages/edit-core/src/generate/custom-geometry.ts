const TOKEN = /[A-Za-z]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi;

function emu(value: number, label: string): string {
  const result = Math.round(value * 9525);
  if (!Number.isSafeInteger(result)) throw new Error(`自定义几何 ${label} 超出 OOXML 安全整数范围`);
  return String(result);
}

type Point = readonly [number, number];

function point(tokens: readonly string[], index: number, label: string): Point {
  const x = Number(tokens[index]);
  const y = Number(tokens[index + 1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`自定义几何 ${label} 坐标无效`);
  return [x, y];
}

const pt = ([x, y]: Point, label: string): string =>
  `<a:pt x="${emu(x, `${label}.x`)}" y="${emu(y, `${label}.y`)}"/>`;

function angle(value: number, label: string): string {
  const result = Math.round((value * 180 * 60000) / Math.PI);
  if (!Number.isSafeInteger(result)) throw new Error(`自定义几何 ${label} 角度无效`);
  return String(result);
}

function arcMarkup(
  tokens: readonly string[],
  index: number,
  current: Point | null,
): { markup: string; target: Point } {
  if (!current) throw new Error('生成保存的自定义圆弧缺少起点');
  let rx = Math.abs(Number(tokens[index]));
  let ry = Math.abs(Number(tokens[index + 1]));
  const rotation = Number(tokens[index + 2]);
  const largeArc = Number(tokens[index + 3]);
  const sweep = Number(tokens[index + 4]);
  const target = point(tokens, index + 5, 'A');
  if (![rx, ry, rotation, largeArc, sweep].every(Number.isFinite)
      || (largeArc !== 0 && largeArc !== 1) || (sweep !== 0 && sweep !== 1)) {
    throw new Error('自定义几何 A 参数无效');
  }
  // DrawingML arcTo 只能表达轴对齐椭圆；core 的 custGeom 投影固定生成 rotation=0。
  if (Math.abs(rotation) > 1e-9) throw new Error('生成保存不支持旋转椭圆的自定义圆弧');
  if (rx === 0 || ry === 0) {
    return { markup: `<a:lnTo>${pt(target, 'A')}</a:lnTo>`, target };
  }
  const [x0, y0] = current;
  const [x1, y1] = target;
  if (x0 === x1 && y0 === y1) return { markup: '', target };

  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const scale = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (scale > 1) {
    const factor = Math.sqrt(scale);
    rx *= factor;
    ry *= factor;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const denominator = rx2 * dy * dy + ry2 * dx * dx;
  const numerator = Math.max(0, rx2 * ry2 - denominator);
  const sign = largeArc === sweep ? -1 : 1;
  const factor = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cx = (x0 + x1) / 2 + factor * ((rx * dy) / ry);
  const cy = (y0 + y1) / 2 - factor * ((ry * dx) / rx);
  const start = Math.atan2((y0 - cy) / ry, (x0 - cx) / rx);
  const end = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx);
  let delta = end - start;
  if (sweep === 1 && delta < 0) delta += Math.PI * 2;
  if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
  return {
    markup: `<a:arcTo wR="${emu(rx, 'A.rx')}" hR="${emu(ry, 'A.ry')}" stAng="${angle(start, 'A.start')}" swAng="${angle(delta, 'A.sweep')}"/>`,
    target,
  };
}

/** core 的无损路径是绝对 M/L/C/Q/A/Z；这里反向写成等比例 DrawingML custGeom。 */
export function customGeometryMarkup(
  path: string,
  width: number,
  height: number,
  open: boolean,
): string {
  const tokens = path.match(TOKEN) ?? [];
  const commands: string[] = [];
  let index = 0;
  let current: Point | null = null;
  let subpathStart: Point | null = null;
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'Z' || command === 'z') {
      commands.push('<a:close/>');
      current = subpathStart;
      continue;
    }
    if (command === 'M' || command === 'L') {
      const target = point(tokens, index, command);
      index += 2;
      const tag = command === 'M' ? 'moveTo' : 'lnTo';
      commands.push(`<a:${tag}>${pt(target, command)}</a:${tag}>`);
      current = target;
      if (command === 'M') subpathStart = target;
      continue;
    }
    if (command === 'C') {
      const points = [point(tokens, index, 'C1'), point(tokens, index + 2, 'C2'),
        point(tokens, index + 4, 'C3')];
      index += 6;
      commands.push(`<a:cubicBezTo>${points.map((value, i) => pt(value, `C${i + 1}`)).join('')}</a:cubicBezTo>`);
      current = points[2];
      continue;
    }
    if (command === 'Q') {
      const points = [point(tokens, index, 'Q1'), point(tokens, index + 2, 'Q2')];
      index += 4;
      commands.push(`<a:quadBezTo>${points.map((value, i) => pt(value, `Q${i + 1}`)).join('')}</a:quadBezTo>`);
      current = points[1];
      continue;
    }
    if (command === 'A') {
      const arc = arcMarkup(tokens, index, current);
      index += 7;
      if (arc.markup) commands.push(arc.markup);
      current = arc.target;
      continue;
    }
    throw new Error(`生成保存不支持自定义路径命令：${command}`);
  }
  if (!commands.length) throw new Error('生成保存的自定义路径为空');
  const w = emu(width, 'width');
  const h = emu(height, 'height');
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>
<a:pathLst><a:path w="${w}" h="${h}" fill="${open ? 'none' : 'norm'}" stroke="1">${commands.join('')}</a:path></a:pathLst></a:custGeom>`;
}
