import type {Presentation,Slide,SlideElement} from '../types';
import {vectorSlideMarkup} from './vector-render';
import {groupSteps,hiddenBefore,staticHidden} from '../anim-steps';
import {VectorFonts} from './vector-fonts';
import {VectorDocument} from './vector-document';
import {VectorSvg} from './vector-svg';
import type {VectorPdfOptions,VectorPdfResult,VectorPdfIssue} from './vector-types';
export type {PdfFontSource,VectorPdfOptions,VectorPdfResult,VectorPdfIssue,VectorPdfRasterizer,VectorPdfRasterRequest,VectorPdfRasterResult} from './vector-types';
export type {VectorPdfImageNormalizer,VectorPdfImageRequest,VectorPdfImageResult} from './vector-types';
export {VectorPdfError} from './vector-error';

export async function presentationToVectorPdf(pres:Presentation,options:VectorPdfOptions):Promise<VectorPdfResult> {
  const fonts = new VectorFonts(options.fonts,options.language ?? 'und',options.signal);
  const issues:VectorPdfIssue[] = [];
  const pdf = new VectorDocument(pres.width * .75,pres.height * .75,options.title), svg = new VectorSvg(pdf,fonts,options,issues);
  const jobs:Array<{slide:Slide; slideNumber:number; hidden:number[]}> = [];
  pres.slides.forEach((slide,index) => {
    if (options.skipHidden && slide.hidden) return;
    const groups = options.animationSteps ? groupSteps(slide.animations) : [];
    if (groups.length) for (let step = 0; step <= groups.length; step++) jobs.push({slide,slideNumber:index + 1,hidden:[...hiddenBefore(groups,step)]});
    else jobs.push({slide,slideNumber:index + 1,hidden:[...staticHidden(slide)]});
  });
  for (const [index,job] of jobs.entries()) {
    fonts.abort();
    // SVG 屏幕路径先排版再写 hidden；PDF 在测字之前剔除不可见对象，避免索取根本不导出的字体。
    const hidden = new Set(job.hidden), used = new Set<number>(), anonymous = new Map<number,number[]>();
    const ids = (elements:SlideElement[]):void => {for (const el of elements) {
      if (el.id !== undefined) used.add(el.id); if (el.kind === 'group') ids(el.children);
    }};
    ids(job.slide.elements); let synthetic = -1;
    const visible = (elements:SlideElement[],parent:number[] = []):SlideElement[] => elements.flatMap((el,index) => {
      if (el.id !== undefined && hidden.has(el.id)) return [];
      const path = [...parent,index]; let id = el.id;
      // .ppt / 宿主 Schema 可没有 spid；临时标记只属于导出副本，问题定位仍指向原文稿。
      if (id === undefined) {while (used.has(synthetic)) synthetic--; id = synthetic--; anonymous.set(id,path);}
      return [el.kind === 'group' ? {...el,id,children:visible(el.children,path)} : {...el,id}];
    });
    const slide = {...job.slide,elements:visible(job.slide.elements)};
    const markup = await vectorSlideMarkup(pres,slide,job.slideNumber,fonts,anonymous);
    await svg.page(markup,job.slideNumber,options.showComments ? job.slide.comments : undefined,anonymous);
    fonts.abort(); options.onProgress?.({completed:index + 1,total:jobs.length,slideNumber:job.slideNumber});
  }
  fonts.abort(); svg.finish(); const data = pdf.finish();
  return {blob:new Blob([data.buffer as ArrayBuffer],{type:'application/pdf'}),issues};
}
