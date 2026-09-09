import {VectorDocument,pdfNumber as n} from './vector-document';
import type {VectorResources} from './vector-resources';

export interface PdfColor {rgb:number[]; alpha:number}
export function pdfColor(value:string):PdfColor {
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/.exec(value);
  if (match && match.slice(1,4).every(v => Number(v) <= 255) && Number(match[4] ?? 1) <= 1) {
    return {rgb:match.slice(1,4).map(v => Number(v) / 255),alpha:Number(match[4] ?? 1)};
  }
  if (/^#[0-9a-f]{3}$/i.test(value)) value = '#' + [...value.slice(1)].map(c => c + c).join('');
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`PDF 暂不支持填充：${value}`);
  return {rgb:[1,3,5].map(at => parseInt(value.slice(at,at + 2),16) / 255),alpha:1};
}
interface GraphicsState {name:string; object:number}
export class VectorPaint {
  private states = new Map<string,GraphicsState>();
  constructor(private pdf:VectorDocument,private resources:VectorResources) {}
  alpha(fill:number,stroke:number,mask?:number):string {
    if (![fill,stroke].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('PDF 透明度无效');
    const key = `${n(fill)} ${n(stroke)} ${mask ?? ''}`; let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= 4096) throw new Error('PDF 透明度资源超限');
      state = {name:`GS${this.states.size + 1}`,object:this.pdf.add(`<< /Type /ExtGState /ca ${n(fill)} /CA ${n(stroke)} /BM /Normal /SMask ${mask ? `<< /S /Luminosity /G ${mask} 0 R /BC [0] >>` : '/None'} >>`)};
      this.states.set(key,state);
    }
    this.resources.use('ExtGState',state); return `/${state.name} gs`;
  }
  solid(fill:string,stroke = 'none'):string {
    const f = fill === 'none' ? undefined : pdfColor(fill), s = stroke === 'none' ? undefined : pdfColor(stroke);
    return [this.alpha(f?.alpha ?? 1,s?.alpha ?? 1),f && `${f.rgb.map(n).join(' ')} rg`,s && `${s.rgb.map(n).join(' ')} RG`].filter(Boolean).join('\n');
  }
}
