/** SVG 与 XHTML 共用双引号属性转义和有限坐标序列化，避免两条输出路径漂移。 */
export const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const round = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';

/** 字体名同时处于 CSS 字符串与 XML 中，十六进制转义也挡住 style 标签终止符。 */
export function escapeCssString(value: string): string {
  return value.replace(/['"\\<>&\u0000-\u001f\u007f]/gu,ch => `\\${ch.codePointAt(0)!.toString(16)} `);
}
