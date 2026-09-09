import type {VectorPdfIssue} from './vector-types';

/** 测量尚未进入 SVG 对象遍历，先保留结构化原因，再由导出边界补上来源位置。 */
export class PdfFontError extends Error {
  readonly detail:Pick<VectorPdfIssue,'reason'|'fontFamilies'|'text'>;
  constructor(reason:string,families:readonly string[],text:string) {
    super(`PDF 字体：${reason}`);
    this.detail = {reason,fontFamilies:[...families],text:text.slice(0,80).replace(/[\ud800-\udbff]$/u,'')};
  }
}

export class PdfImageError extends Error {
  readonly detail:Pick<VectorPdfIssue,'reason'>;
  constructor(reason:string) {super(`PDF 图片：${reason}`); this.detail = {reason};}
}

export function vectorIssueLocation(slideNumber:number,id:number | undefined,anonymous:ReadonlyMap<number,number[]>):Pick<VectorPdfIssue,'slideNumber'|'elementId'|'elementPath'> {
  const path = id === undefined ? undefined : anonymous.get(id);
  return {slideNumber,...(path ? {elementPath:[...path]} : id !== undefined ? {elementId:id} : {})};
}

export function locateVectorError(error:unknown,slideNumber:number,id:number | undefined,anonymous:ReadonlyMap<number,number[]>):never {
  if (error instanceof PdfFontError || error instanceof PdfImageError) throw new VectorPdfError({...vectorIssueLocation(slideNumber,id,anonymous),...error.detail});
  throw error;
}

export class VectorPdfError extends Error {
  readonly name = 'VectorPdfError';
  constructor(readonly issue:VectorPdfIssue) {
    const object = issue.elementId !== undefined ? `对象 ${issue.elementId}` : issue.elementPath ? `对象路径 ${issue.elementPath.map(i => i + 1).join('/')}` : '';
    super(`第 ${issue.slideNumber} 页${object} PDF 导出失败：${issue.reason}`);
  }
}
