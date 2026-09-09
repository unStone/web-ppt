import type {TextMeasure,TextRun} from '../index';
import type {PdfFontFace,PdfFontSource,PdfGlyphRun} from './vector-types';
import {escapeCssString,escapeXml} from '../render/serialize';
import {PdfFontError} from './vector-error';

export interface PdfTextStyle {fonts:string[]; b?:boolean; i?:boolean}
export interface PdfShapedPart {face:PdfFontFace; run:PdfGlyphRun; text:string}

/** 每次导出独占缓存，取消或返回后即由调用栈释放；不接管宿主 Provider。 */
export class VectorFonts {
  private cache = new Map<string,PdfShapedPart[]>();
  private characters = 0;
  constructor(private source:PdfFontSource,private language:string,private signal?:AbortSignal) {}
  abort():void {if (this.signal?.aborted) throw new DOMException('PDF 导出已取消','AbortError');}
  private key(text:string,style:PdfTextStyle):string {return JSON.stringify([text,style.fonts,!!style.b,!!style.i]);}
  async shape(text:string,style:PdfTextStyle):Promise<PdfShapedPart[]> {
    this.abort();
    const key = this.key(text,style), cached = this.cache.get(key);
    if (cached) return cached;
    this.characters += text.length;
    if (this.cache.size >= 8192 || this.characters > 1_000_000) throw new Error('PDF 字体测量资源超限');
    const segmented = this.source.segmentText(text,{language:this.language,direction:'ltr'});
    if (!segmented.ok) throw new PdfFontError(segmented.reason,style.fonts,text);
    const parts:PdfShapedPart[] = [], request = {purpose:'view-print' as const,signal:this.signal};
    for (const part of segmented.value) {
      let selected:PdfShapedPart | undefined, resolveReason = 'face-unavailable', shapeReason:string | undefined;
      const families = style.fonts.length ? style.fonts : ['Helvetica','Arial'];
      for (const family of families) {
        const face = await this.source.provider.resolve({...request,family,weight:style.b ? 700 : 400,italic:!!style.i});
        this.abort();
        if (!face.ok) {resolveReason = face.reason; continue;}
        const shaped = await this.source.provider.shape(face.value.id,part.text,{...request,
          script:part.script,direction:part.direction,language:part.language});
        this.abort();
        if (!shaped.ok) {shapeReason = shaped.reason; continue;}
        selected = {face:face.value,run:shaped.value,text:part.text}; break;
      }
      // 已找到字体但整形失败，比后续备用家族不存在更接近真实原因。
      if (!selected) throw new PdfFontError(shapeReason ?? resolveReason,families,part.text);
      parts.push(selected);
    }
    this.cache.set(key,parts); return parts;
  }
  async embedding(part:PdfShapedPart):Promise<Uint8Array> {
    const loaded = await this.source.provider.embedding(part.face.id,{purpose:'view-print',signal:this.signal});
    this.abort();
    if (!loaded.ok) throw new PdfFontError(loaded.reason,[part.face.family],part.text);
    if (!loaded.value.info.embedding.outlineAllowed) throw new PdfFontError('embedding-restricted',[part.face.family],part.text);
    return loaded.value.bytes;
  }
  async styleTag(parts:readonly PdfShapedPart[]):Promise<string> {
    const faces = new Map(parts.map(part => [part.face.id,part])), rules:string[] = [];
    for (const part of faces.values()) {
      const face = part.face, bytes = await this.embedding(part); let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset,offset + 16384));
      rules.push(`@font-face{font-family:'${escapeCssString(face.family)}';font-weight:${face.weight};font-style:${face.italic ? 'italic' : 'normal'};src:url('data:font/ttf;base64,${btoa(binary)}');}`);
    }
    return rules.length ? `<style>${escapeXml(rules.join(''))}</style>` : '';
  }
  async render(render:(measure:TextMeasure)=>string):Promise<string> {
    const pending = new Map<string,{text:string; style:PdfTextStyle}>();
    const measure:TextMeasure = (text,run:Readonly<TextRun>,scale) => {
      if (!text) return 0;
      const key = this.key(text,run), parts = this.cache.get(key);
      const size = run.size * scale * (run.baseline ? .65 : 1);
      if (!parts) pending.set(key,{text,style:{fonts:run.fonts,b:run.b,i:run.i}});
      return (parts ? parts.reduce((n,p) => n + p.run.xAdvance / p.run.unitsPerEm,0) : text.length) * size
        + (run.spacing ?? 0) * text.length;
    };
    // 只补齐异步测量，行切分与坐标始终由已有同步排版器决定。
    for (let pass = 0; pass < 8; pass++) {
      this.abort(); pending.clear();
      const svg = render(measure);
      if (!pending.size) return svg;
      for (const query of pending.values()) await this.shape(query.text,query.style);
    }
    throw new Error('PDF 字体测量未收敛');
  }
}
