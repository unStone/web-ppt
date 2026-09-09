import {pdfString} from './document';
import type {SlideComment} from '../types';

const encode = (text:string):Uint8Array => new TextEncoder().encode(text);
export const pdfNumber = (n:number):string => {
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error('PDF 坐标无效');
  return String(Math.round(n * 1e6) / 1e6);
};

/** 按需矢量输出的对象容器；字节长度和 xref 偏移均在 UTF-8 编码后计算。 */
export class VectorDocument {
  private objects:(Uint8Array[] | null)[] = [null,null,null];
  private pages:number[] = [];
  private size = 0;
  constructor(private width:number,private height:number,private title = '') {
    if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw new Error('PDF 页面尺寸必须为 0–14400 pt');
  }
  reserve():number {this.objects.push(null); return this.objects.length - 1;}
  put(id:number,parts:(string|Uint8Array)[]):void {
    if (this.objects[id]) throw new Error('PDF 对象重复写入');
    const chunks = parts.map(p => typeof p === 'string' ? encode(p) : p);
    this.size += chunks.reduce((n,p) => n + p.length,0);
    if (this.size > 256 * 1024 * 1024) throw new Error('PDF 文件超过浏览器导出大小限制');
    this.objects[id] = chunks;
  }
  add(body:string):number {const id = this.reserve(); this.put(id,[body]); return id;}
  stream(bytes:Uint8Array|string,extra = ''):number {
    const data = typeof bytes === 'string' ? encode(bytes) : bytes, id = this.reserve();
    this.put(id,[`<< /Length ${data.length} ${extra} >>\nstream\n`,data,'\nendstream']); return id;
  }
  page(commands:string,resources:string,comments:readonly SlideComment[] = []):void {
    if (this.pages.length >= 10000) throw new Error('PDF 页数超限');
    if (comments.length > 10000 || comments.some(c => ![c.x,c.y].every(Number.isFinite))) throw new Error('PDF 批注数量或坐标无效');
    const seen = new Set<string>();
    for (const comment of comments) {
      if (comment.id && seen.has(comment.id)) throw new Error('PDF 批注身份重复');
      if (comment.id) seen.add(comment.id);
    }
    const page = this.reserve(), annotations = comments.map(() => this.reserve());
    const ids = new Map(comments.map((c,i) => [c.id,annotations[i]]));
    comments.forEach((comment,i) => {
      const x = Math.max(0,Math.min(this.width - 12,comment.x * .75));
      const y = Math.max(0,Math.min(this.height - 12,this.height - comment.y * .75 - 12));
      const parent = comment.parentId ? ids.get(comment.parentId) : undefined;
      this.put(annotations[i],[`<< /Type /Annot /Subtype /Text /Rect [${[x,y,x + 12,y + 12].map(pdfNumber).join(' ')}] /Contents ${pdfString(comment.text)} /T ${pdfString(comment.author ?? '')} /Name /Comment /F 4 /P ${page} 0 R${parent ? ` /IRT ${parent} 0 R /RT /R` : ''} >>`]);
    });
    const stream = this.stream(`q .75 0 0 -.75 0 ${pdfNumber(this.height)} cm\n${commands}\nQ`);
    this.put(page,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(this.width)} ${pdfNumber(this.height)}] /Resources << ${resources} >> /Contents ${stream} 0 R${annotations.length ? ` /Annots [${annotations.map(id => `${id} 0 R`).join(' ')}]` : ''} >>`]);
    this.pages.push(page);
  }
  finish():Uint8Array {
    if (!this.pages.length) throw new Error('没有可导出的 PDF 页面');
    this.put(1,['<< /Type /Catalog /Pages 2 0 R >>']);
    this.put(2,[`<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map(p => `${p} 0 R`).join(' ')}] >>`]);
    const info = this.add(`<< /Producer ${pdfString('Web-PPT')} /Title ${pdfString(this.title)} >>`);
    const chunks = [encode('%PDF-1.7\n%'),new Uint8Array([0xe2,0xe3,0xcf,0xd3,10])], offsets = [0];
    let size = chunks.reduce((n,c) => n + c.length,0);
    const append = (bytes:Uint8Array) => {chunks.push(bytes); size += bytes.length;};
    for (let i = 1; i < this.objects.length; i++) {
      const object = this.objects[i]; if (!object) throw new Error('PDF 对象尚未写入');
      offsets.push(size); append(encode(`${i} 0 obj\n`)); object.forEach(append); append(encode('\nendobj\n'));
    }
    const start = size;
    append(encode(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`));
    const output = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) {output.set(chunk,at); at += chunk.length;}
    this.objects.length = 0; return output;
  }
}
