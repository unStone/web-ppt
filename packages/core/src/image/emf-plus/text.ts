import { esc, n } from '../gdi';
import type { Box } from './binary';
import type { Font, Format } from './objects';

export function fontAttrs(font: Font, size: number): string {
  return `font-family="${esc(font.name)}" font-size="${n(size)}"${font.style & 1 ? ' font-weight="700"' : ''}${font.style & 2 ? ' font-style="italic"' : ''}${font.style & 12 ? ` text-decoration="${[font.style & 4 ? 'underline' : '', font.style & 8 ? 'line-through' : ''].filter(Boolean).join(' ')}"` : ''}`;
}
/** 与 GDI 一样输出原生 text；字体度量不可用时保留字符语义，按 em 估算折行。 */
export function textLayout(text: string, box: Box, size: number, format: Format): string {
  if (format.flags & 2) throw new Error('EMF+ 竖排字符串暂不支持');
  const width = (s: string) => Array.from(s).reduce((sum, c) => sum + (c.charCodeAt(0) >= 0x2e80 ? 1 : /[il.,' ]/.test(c) ? 0.3 : 0.56) * size, 0);
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+\s*|\s+/g) ?? ['']) {
      if (!(format.flags & 0x1000) && box.w > 0 && line && width(line + token) > box.w) { lines.push(line.trimEnd()); line = ''; }
      line += token;
    }
    lines.push(line);
  }
  const height = lines.length * size * 1.2, top = box.y + Math.max(0, box.h - height) * (format.lineAlign === 1 ? 0.5 : format.lineAlign === 2 ? 1 : 0);
  const rtl = !!(format.flags & 1), align = rtl ? 2 - format.align : format.align;
  const x = box.x + box.w * (align === 1 ? 0.5 : align === 2 ? 1 : 0);
  return lines.map((line, i) => `<tspan x="${n(x)}" y="${n(top + size + i * size * 1.2)}" text-anchor="${['start', 'middle', 'end'][align] ?? 'start'}"${rtl ? ' direction="rtl" unicode-bidi="embed"' : ''}>${esc(line)}</tspan>`).join('');
}
