import type { OleContent } from './content';
import { cellPosition } from './content';

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** 本地预览只展开有限窗口，完整数据仍保存在原生工作簿/文档中。 */
export function olePreviewSvg(content: OleContent): string {
  const width = 800, height = 500, header = '<rect width="800" height="500" fill="#fff"/>';
  let body = '';
  const label = (x: number, y: number, value: string, size = 20) => `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="#172033">${esc(value)}</text>`;
  if (content.kind === 'docx') {
    let line = 0;
    for (const p of content.paragraphs) {
      const chars = [...p.text];
      for (let start = 0; start < Math.max(chars.length, 1) && line < 15; start += 38) body += label(24, 36 + line++ * 30, chars.slice(start, start + 38).join(''));
      if (line >= 15) break;
    }
  } else {
    const sheet = content.sheets[0]; body += label(20, 30, sheet?.name ?? '');
    for (let row = 0; row < 12; row++) body += `<path d="M20 ${50 + row * 36}H780" stroke="#cbd5e1"/>`;
    for (let col = 0; col < 6; col++) body += `<path d="M${20 + col * 152} 50V446" stroke="#cbd5e1"/>`;
    for (const cell of sheet?.cells ?? []) {
      const [r, c] = cellPosition(cell.ref); if (r > 11 || c > 5) continue;
      // 公式结果要由 Excel 重算，预览显示公式本身，避免把旧缓存当作新结果。
      const value = cell.formula !== undefined ? '=' + cell.formula : cell.value === null ? '' : String(cell.value);
      body += label(26 + (c - 1) * 152, 75 + (r - 1) * 36, [...value].slice(0, 11).join(''), 17);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${header}${body}</svg>`;
}
