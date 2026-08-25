import type { Fill, Stroke, TableCell, TextRun } from '@web-ppt/core';

const DASHES: readonly [string, readonly number[]][] = [
  ['dash', [4, 3]], ['dashDot', [4, 3, 1, 3]], ['dot', [1, 3]], ['lgDash', [8, 3]],
  ['lgDashDot', [8, 3, 1, 3]], ['lgDashDotDot', [8, 3, 1, 3, 1, 3]],
  ['sysDash', [3, 3]], ['sysDashDot', [3, 3, 1, 3]],
  ['sysDashDotDot', [3, 3, 1, 3, 1, 3]], ['sysDot', [1, 1]],
];

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function colorMarkup(color: string): string {
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1]
    ?? match?.slice(1, 4).map((value) => Math.max(0, Math.min(255, Math.round(Number(value))))
      .toString(16).padStart(2, '0')).join('');
  if (!hex) throw new Error(`表格直接格式包含不支持的颜色：${color}`);
  const alpha = match?.[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4])));
  return alpha < 1
    ? `<a:srgbClr val="${hex.toUpperCase()}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr>`
    : `<a:srgbClr val="${hex.toUpperCase()}"/>`;
}

function fillMarkup(fill: Fill | null): string {
  if (!fill) return '<a:noFill/>';
  if (fill.type === 'none') return '<a:noFill/>';
  if (fill.type === 'solid') return `<a:solidFill>${colorMarkup(fill.color)}</a:solidFill>`;
  if (fill.type === 'pattern') {
    return `<a:pattFill prst="${escapeAttribute(fill.preset)}"><a:fgClr>${colorMarkup(fill.fg)}</a:fgClr><a:bgClr>${colorMarkup(fill.bg)}</a:bgClr></a:pattFill>`;
  }
  if (fill.type === 'gradient') {
    const stops = fill.stops.map((stop) =>
      `<a:gs pos="${Math.round(stop.pos * 100000)}">${colorMarkup(stop.color)}</a:gs>`).join('');
    const direction = fill.radial
      ? '<a:path path="circle"><a:fillToRect l="100000" t="100000"/></a:path>'
      : `<a:lin ang="${Math.round(fill.angle * 60000)}" scaled="1"/>`;
    return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${direction}</a:gradFill>`;
  }
  throw new Error('新增表格默认样式不能包含缺少 OPC 关系的图片填充');
}

function dashName(stroke: Stroke): string | null {
  if (!stroke.dash) return null;
  const unit = Math.max(stroke.width, 1);
  const normalized = stroke.dash.map((value) => Math.round(value / unit * 1000) / 1000);
  return DASHES.find(([, values]) => values.length === normalized.length
    && values.every((value, index) => Math.abs(value - normalized[index]) < 1e-3))?.[0] ?? 'dash';
}

function lineMarkup(tag: string, stroke: Stroke | null | undefined): string {
  if (!stroke) return `<a:${tag}><a:noFill/></a:${tag}>`;
  const cap = stroke.cap === 'butt' ? 'flat' : stroke.cap === 'round' ? 'rnd'
    : stroke.cap === 'square' ? 'sq' : undefined;
  const attributes = [
    `w="${Math.max(1, Math.round(stroke.width * 9525))}"`,
    ...(cap ? [`cap="${cap}"`] : []),
    ...(stroke.compound ? [`cmpd="${escapeAttribute(stroke.compound)}"`] : []),
  ].join(' ');
  const dash = dashName(stroke);
  const join = stroke.join === 'round' ? '<a:round/>'
    : stroke.join === 'bevel' ? '<a:bevel/>'
      : stroke.join === 'miter' ? '<a:miter/>' : '';
  return `<a:${tag} ${attributes}><a:solidFill>${colorMarkup(stroke.color)}</a:solidFill>${dash ? `<a:prstDash val="${dash}"/>` : ''}${join}</a:${tag}>`;
}

function runProperties(run: TextRun): string {
  const attributes = [
    'lang="zh-CN"', `sz="${Math.max(100, Math.round(run.size * 75))}"`,
    `b="${run.b ? 1 : 0}"`, `i="${run.i ? 1 : 0}"`,
    `u="${run.u ? 'sng' : 'none'}"`, `strike="${run.strike ? 'sngStrike' : 'noStrike'}"`,
  ];
  if (run.baseline) attributes.push(`baseline="${Math.round(run.baseline * 1000)}"`);
  if (run.spacing) attributes.push(`spc="${Math.round(run.spacing * 75)}"`);
  const latin = run.fonts[0] ? escapeAttribute(run.fonts[0]) : null;
  const ea = run.fonts[1] ? escapeAttribute(run.fonts[1]) : latin;
  const cs = run.fonts[2] ? escapeAttribute(run.fonts[2]) : ea;
  const fonts = latin
    ? `<a:latin typeface="${latin}"/><a:ea typeface="${ea}"/><a:cs typeface="${cs}"/>` : '';
  return `<a:endParaRPr ${attributes.join(' ')}><a:solidFill>${colorMarkup(run.color)}</a:solidFill>${fonts}</a:endParaRPr>`;
}

/** 新表格把已求值视觉写成直接格式，跨文档粘贴不再依赖来源 tableStyles/theme。 */
export function directTableCellMarkup(cell: TableCell): string {
  const body = cell.editInfo?.textTemplate ?? cell.text;
  const run = body?.paragraphs[0]?.runs[0];
  if (!run) throw new Error('新增表格单元格缺少可写文字模板');
  const text = `<a:txBody><a:bodyPr/><a:lstStyle/><a:p>${runProperties(run)}</a:p></a:txBody>`;
  const borders = lineMarkup('lnL', cell.borders?.l) + lineMarkup('lnR', cell.borders?.r)
    + lineMarkup('lnT', cell.borders?.t) + lineMarkup('lnB', cell.borders?.b);
  const margins = cell.margins ?? [4.8, 9.6, 4.8, 9.6];
  const anchor = cell.vAlign === 'middle' ? 'ctr' : cell.vAlign === 'bottom' ? 'b' : 't';
  const properties = `marT="${Math.round(margins[0] * 9525)}" marR="${Math.round(margins[1] * 9525)}" marB="${Math.round(margins[2] * 9525)}" marL="${Math.round(margins[3] * 9525)}" anchor="${anchor}" vert="${escapeAttribute(cell.vert ?? 'horz')}"`;
  return `<a:tc>${text}<a:tcPr ${properties}>${borders}${fillMarkup(cell.fill)}</a:tcPr></a:tc>`;
}
