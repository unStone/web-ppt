import {presentationToVectorPdf,type PdfFontSource,type VectorPdfRasterizer,type VectorPdfImageNormalizer} from '@web-ppt/core/pdf/vector';
import {rasterizeVectorPdfObject,normalizeVectorPdfImage} from '@web-ppt/core/pdf/vector/browser';
import type {Presentation} from '@web-ppt/core';
import {createFontProvider,segmentFontText} from '@web-ppt/fonts/glyphs';

/** 真实 Provider 能直接进入公开端口，不要求 core 反向依赖 fonts 的类型。 */
export function exportWithFontProvider(presentation:Presentation,provider:ReturnType<typeof createFontProvider>) {
  const fonts:PdfFontSource = {provider,segmentText:segmentFontText};
  const rasterize:VectorPdfRasterizer = rasterizeVectorPdfObject;
  const normalizeImage:VectorPdfImageNormalizer = normalizeVectorPdfImage;
  return presentationToVectorPdf(presentation,{fonts,rasterize,normalizeImage,skipHidden:true});
}
