import {inspectPdfImage,imageDimensions,validateNormalizedImage} from './vector-image-input';
import type {VectorPdfImageRequest,VectorPdfImageResult} from './vector-types';

/** 浏览器拥有颜色管理与格式解码；输出像素不再携带需要 PDF 阅读器解释的方向或 ICC 元数据。 */
export async function normalizeVectorPdfImage(request:VectorPdfImageRequest):Promise<VectorPdfImageResult> {
  const abort = ():void => {if (request.signal?.aborted) throw new DOMException('PDF 导出已取消','AbortError');};
  abort(); const input = inspectPdfImage(request.bytes);
  let bitmap:ImageBitmap | undefined, canvas:HTMLCanvasElement | undefined;
  try {
    // Bitmap 解码不可中途终止；等待迟到结果并关闭后，调用方才可结束文稿的资源作用域。
    bitmap = await createImageBitmap(new Blob([request.bytes.slice().buffer as ArrayBuffer],{type:input.mimeType}),
      {imageOrientation:'from-image',colorSpaceConversion:'default',premultiplyAlpha:'none'});
    abort(); imageDimensions(bitmap.width,bitmap.height);
    canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
    if (!context) throw new Error('PDF 图片无法获取 sRGB canvas 上下文');
    context.drawImage(bitmap,0,0);
    const pixels = context.getImageData(0,0,canvas.width,canvas.height);
    const result = {width:canvas.width,height:canvas.height,rgba:new Uint8Array(pixels.data.buffer,pixels.data.byteOffset,pixels.data.byteLength)};
    validateNormalizedImage(result,input); abort(); return result;
  } finally {bitmap?.close(); if (canvas) canvas.width = canvas.height = 0;}
}
