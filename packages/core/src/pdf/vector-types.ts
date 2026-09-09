import type {PdfExportOptions} from '../pdf';

/** 结构化字体端口；基础包不反向依赖可选 fonts 包或整形器。 */
export type PdfFontResult<T> = {ok:true; value:T} | {ok:false; reason:string; faceId?:string};
export interface PdfFontRequest {purpose:'view-print'; signal?:AbortSignal}
export interface PdfFontFace {
  id:string; family:string; weight:number; unitsPerEm:number; bbox:readonly [number,number,number,number];
  italic:boolean; embedding:{outlineAllowed:boolean};
}
export interface PdfGlyphRun {
  unitsPerEm:number; xAdvance:number;
  glyphs:Array<{id:number; xAdvance:number; yAdvance:number; xOffset:number; yOffset:number}>;
  clusters:Array<{start:number; end:number; text:string; glyphStart:number; glyphEnd:number}>;
}
export interface PdfFontSegment {text:string; script:'Latn'|'Hani'; direction:'ltr'; language:string}
export interface PdfFontSource {
  provider:{
    resolve(request:PdfFontRequest & {family:string; weight:number; italic:boolean}):Promise<PdfFontResult<PdfFontFace>>;
    embedding(faceId:string,request:PdfFontRequest):Promise<PdfFontResult<{bytes:Uint8Array; info:PdfFontFace}>>;
    shape(faceId:string,text:string,options:PdfFontRequest & Omit<PdfFontSegment,'text'>):Promise<PdfFontResult<PdfGlyphRun>>;
  };
  segmentText(text:string,options:{direction:'ltr'; language:string}):PdfFontResult<PdfFontSegment[]>;
}
/** SVG 已限定为一个对象，坐标使用幻灯片像素；返回透明 PNG 的紧边界。 */
export interface VectorPdfRasterRequest {svg:string; width:number; height:number; signal?:AbortSignal}
export interface VectorPdfRasterResult {bytes:Uint8Array; x:number; y:number; width:number; height:number}
export type VectorPdfRasterizer = (request:VectorPdfRasterRequest)=>Promise<VectorPdfRasterResult | null>;
export interface VectorPdfImageRequest {bytes:Uint8Array; mimeType:string; signal?:AbortSignal}
/** 已应用方向、转换为 sRGB 的非预乘 RGBA；保持原像素尺寸，方向旋转可交换宽高。 */
export interface VectorPdfImageResult {width:number; height:number; rgba:Uint8Array}
export type VectorPdfImageNormalizer = (request:VectorPdfImageRequest)=>Promise<VectorPdfImageResult>;
export interface VectorPdfOptions extends Omit<PdfExportOptions,'scale'> {
  fonts:PdfFontSource; language?:string; rasterize?:VectorPdfRasterizer; normalizeImage?:VectorPdfImageNormalizer;
}
export interface VectorPdfIssue {
  slideNumber:number; elementId?:number;
  /** 对象没有来源 ID 时，使用原始 slide.elements / group.children 的零基索引路径。 */
  elementPath?:number[];
  reason:string;
  /** 字体失败时实际尝试的家族；不依赖 UI 解析异常文案。 */
  fontFamilies?:string[];
  /** 失败测量或绘制的文字片段，最多 80 个 UTF-16 单元且不截断代理对。 */
  text?:string;
}
export interface VectorPdfResult {blob:Blob; issues:VectorPdfIssue[]}
