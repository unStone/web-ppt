import type {PdfFontFace} from './vector-types';
import {VectorDocument,pdfNumber as n} from './vector-document';

export const pdfHex = (value:number):string => value.toString(16).padStart(4,'0');
export const unicodeHex = (text:string):string => {
  let value = ''; for (let i = 0; i < text.length; i++) value += pdfHex(text.charCodeAt(i)); return value;
};

/** 同一个 GID 可来自不同原文（例如 ffi / ﬃ），CID 身份必须同时包含原文。 */
export class VectorFontResource {
  readonly object:number;
  private entries:Array<{gid:number; text:string}> = [{gid:0,text:''}];
  private cids = new Map<string,number>();
  constructor(private pdf:VectorDocument,readonly name:string,readonly face:PdfFontFace,private bytes:Uint8Array) {
    this.object = pdf.reserve();
  }
  cid(gid:number,text:string):number {
    const key = JSON.stringify([gid,text]), found = this.cids.get(key);
    if (found !== undefined) return found;
    if (this.entries.length >= 65536) throw new Error('PDF 字体 CID 数量超限');
    const cid = this.entries.length; this.entries.push({gid,text}); this.cids.set(key,cid); return cid;
  }
  decoration(line:'underline'|'line-through',size:number):{offset:number; thickness:number} {
    // 原生 SVG 使用 CSS auto 装饰线：粗细由字号决定，删除线相对实际字体 ascent 定位。
    // post / OS/2 的建议装饰线度量属于 from-font，不能替代当前原生路径的 auto 语义。
    const thickness = size / 10;
    if (line === 'underline') return {offset:Math.max(1,Math.ceil(thickness / 2)),thickness};
    const view = new DataView(this.bytes.buffer,this.bytes.byteOffset,this.bytes.byteLength);
    for (let i = 0; i < view.getUint16(4); i++) {
      const at = 12 + i * 16;
      if (String.fromCharCode(...this.bytes.subarray(at,at + 4)) !== 'hhea') continue;
      const table = view.getUint32(at + 8), scale = size / this.face.unitsPerEm;
      return {offset:-view.getInt16(table + 4) * scale / 3 - thickness / 2,thickness};
    }
    throw new Error('PDF 字体缺少 hhea');
  }
  finish():void {
    const view = new DataView(this.bytes.buffer,this.bytes.byteOffset,this.bytes.byteLength);
    const tables = new Map<string,number>();
    for (let i = 0; i < view.getUint16(4); i++) {
      const at = 12 + i * 16, tag = String.fromCharCode(...this.bytes.subarray(at,at + 4));
      tables.set(tag,view.getUint32(at + 8));
    }
    const table = (tag:string):number => {const at = tables.get(tag); if (at === undefined) throw new Error(`PDF 字体缺少 ${tag}`); return at;};
    const scale = 1000 / this.face.unitsPerEm, hhea = table('hhea'), hmtx = table('hmtx');
    const metrics = view.getUint16(hhea + 34), os2 = tables.get('OS/2'), post = tables.get('post');
    const ascent = view.getInt16(hhea + 4) * scale, descent = view.getInt16(hhea + 6) * scale;
    const cap = os2 !== undefined && view.getUint16(os2) >= 2 ? view.getInt16(os2 + 88) * scale : ascent;
    const angle = post === undefined ? 0 : view.getInt32(post + 4) / 65536;
    const font = this.pdf.stream(this.bytes,`/Length1 ${this.bytes.length}`);
    const descriptor = this.pdf.add(`<< /Type /FontDescriptor /FontName /${this.name} /Flags ${4 + (this.face.italic ? 64 : 0)} /FontBBox [${this.face.bbox.map(v => n(v * scale)).join(' ')}] /ItalicAngle ${n(angle)} /Ascent ${n(ascent)} /Descent ${n(descent)} /CapHeight ${n(cap)} /StemV 80 /FontFile2 ${font} 0 R >>`);
    const mapping = new Uint8Array(this.entries.length * 2), widths:string[] = [], unicode:string[] = [];
    this.entries.forEach(({gid,text},cid) => {
      mapping[cid * 2] = gid >> 8; mapping[cid * 2 + 1] = gid & 255;
      widths.push(n(view.getUint16(hmtx + Math.min(gid,metrics - 1) * 4) * scale));
      if (text) unicode.push(`<${pdfHex(cid)}> <${unicodeHex(text)}>`);
    });
    const map = this.pdf.stream(mapping), blocks:string[] = [];
    // PDF CMap 的单个 bfchar 块至多 100 项。
    for (let i = 0; i < unicode.length; i += 100) {
      const block = unicode.slice(i,i + 100); blocks.push(`${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`);
    }
    const cmap = this.pdf.stream(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /${this.name}Unicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end`);
    const cidFont = this.pdf.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${this.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${map} 0 R /DW 1000 /W [0 [${widths.join(' ')}]] >>`);
    this.pdf.put(this.object,[`<< /Type /Font /Subtype /Type0 /BaseFont /${this.name} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${cmap} 0 R >>`]);
  }
}
