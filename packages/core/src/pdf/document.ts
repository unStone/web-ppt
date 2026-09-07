import type { SlideComment } from '../types';
import { pdfImage } from './png';
const utf8 = new TextEncoder();
const bytes = (s: string): Uint8Array => utf8.encode(s);
const num = (n: number): string => String(Math.round(n * 1000) / 1000);
export function pdfString(text: string): string {
  let hex = 'feff'; for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}

/** 独立于浏览器的 PDF 1.4 文件写入器；像素页面和原生批注，无时间戳以便重复交付。 */
export class PdfDocument {
  private objects: (Uint8Array[] | null)[] = [null, null, null];
  private pages: number[] = [];
  private total = 0;
  private closed = false;
  constructor(private width: number, private height: number, private title = '') {
    if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw new Error('PDF 页面尺寸必须为 0–14400 pt');
  }
  private reserve(): number { this.objects.push(null); return this.objects.length - 1; }
  private put(id: number, parts: (string | Uint8Array)[]): void {
    const encoded = parts.map(p => typeof p === 'string' ? bytes(p) : p);
    this.total += encoded.reduce((sum, p) => sum + p.length, 0);
    if (this.total > 256 * 1024 * 1024) throw new Error('PDF 文件超过浏览器导出大小限制');
    this.objects[id] = encoded;
  }
  addPage(png: Uint8Array, comments: readonly SlideComment[] = []): void {
    if (this.closed) throw new Error('PDF 已结束');
    if (this.pages.length >= 10000) throw new Error('PDF 页数超限');
    if (comments.length > 10000 || comments.some(c => ![c.x, c.y].every(Number.isFinite))) throw new Error('PDF 批注数量或坐标无效');
    const idsSeen = new Set<string>();
    for (const c of comments) {
      if (c.id && idsSeen.has(c.id)) throw new Error('PDF 批注身份重复');
      if (c.id) idsSeen.add(c.id);
    }
    const image = pdfImage(png), checkpoint = this.objects.length, total = this.total;
    try {
    const page = this.reserve(), pixels = this.reserve(), content = this.reserve();
    const body = `q ${num(this.width)} 0 0 ${num(this.height)} 0 0 cm /Im0 Do Q\n`;
    this.put(content, [`<< /Length ${bytes(body).length} >>\nstream\n`, body, 'endstream']);
    this.put(pixels, [`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.compressed.length} >>\nstream\n`, image.compressed, '\nendstream']);
    const annotations = comments.map(() => this.reserve()), ids = new Map(comments.map((c, i) => [c.id, annotations[i]]));
    comments.forEach((comment, i) => {
      const x = Math.max(0, Math.min(this.width - 12, (comment.x ?? 0) * 0.75)), y = Math.max(0, Math.min(this.height - 12, this.height - (comment.y ?? 0) * 0.75 - 12));
      const parent = comment.parentId ? ids.get(comment.parentId) : undefined;
      this.put(annotations[i], [`<< /Type /Annot /Subtype /Text /Rect [${[x, y, x + 12, y + 12].map(num).join(' ')}] /Contents ${pdfString(comment.text)} /T ${pdfString(comment.author ?? '')} /Name /Comment /F 4 /P ${page} 0 R${parent ? ` /IRT ${parent} 0 R /RT /R` : ''} >>`]);
    });
    this.put(page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] /Resources << /XObject << /Im0 ${pixels} 0 R >> >> /Contents ${content} 0 R${annotations.length ? ` /Annots [${annotations.map(id => `${id} 0 R`).join(' ')}]` : ''} >>`]);
    this.pages.push(page);
    } catch (error) { this.objects.length = checkpoint; this.total = total; throw error; }
  }
  finish(): Uint8Array {
    if (this.closed) throw new Error('PDF 已结束');
    if (!this.pages.length) throw new Error('没有可导出的 PDF 页面');
    this.closed = true;
    const info = this.reserve();
    this.put(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    this.put(2, [`<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map(id => `${id} 0 R`).join(' ')}] >>`]);
    this.put(info, [`<< /Producer ${pdfString('Web-PPT')} /Title ${pdfString(this.title)} >>`]);
    const chunks: Uint8Array[] = [bytes('%PDF-1.4\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 10])], offsets = [0];
    let size = chunks.reduce((sum, c) => sum + c.length, 0);
    const append = (p: Uint8Array) => { chunks.push(p); size += p.length; };
    for (let i = 1; i < this.objects.length; i++) {
      const object = this.objects[i]; if (!object) throw new Error('PDF 对象尚未写入');
      offsets.push(size); append(bytes(`${i} 0 obj\n`)); object.forEach(append); append(bytes('\nendobj\n'));
    }
    const start = size;
    append(bytes(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`));
    const output = new Uint8Array(size); let at = 0; for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
    this.objects.length = 0; return output;
  }
}
