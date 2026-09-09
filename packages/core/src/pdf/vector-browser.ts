import type {VectorPdfRasterRequest,VectorPdfRasterResult} from './vector-types';
export {normalizeVectorPdfImage} from './vector-image-browser';

/** 可选浏览器适配；只在调用时使用 DOM，宿主也可把同一端口转发到独立渲染环境。 */
export async function rasterizeVectorPdfObject(request:VectorPdfRasterRequest):Promise<VectorPdfRasterResult | null> {
  const {signal} = request, scale = 2, width = Math.ceil(request.width * scale), height = Math.ceil(request.height * scale);
  const abort = ():void => {if (signal?.aborted) throw new DOMException('PDF 导出已取消','AbortError');};
  abort();
  if (![width,height].every(v => Number.isSafeInteger(v) && v > 0) || width * height > 16_000_000) throw new Error('PDF 局部回退画布尺寸超限');
  const canvas = document.createElement('canvas'), crop = document.createElement('canvas'), image = new Image();
  try {
    const svg = request.svg.replace('<svg ',`<svg width="${width}" height="${height}" `);
    await new Promise<void>((resolve,reject) => {
      const clean = ():void => {signal?.removeEventListener('abort',cancel); image.onload = image.onerror = null;};
      const cancel = ():void => {clean(); image.removeAttribute('src'); reject(new DOMException('PDF 导出已取消','AbortError'));};
      image.onload = () => {clean(); resolve();};
      image.onerror = () => {clean(); reject(new Error('PDF 局部 SVG 渲染失败'));};
      signal?.addEventListener('abort',cancel,{once:true});
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    abort(); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d',{willReadFrequently:true}), target = crop.getContext('2d');
    if (!context || !target) throw new Error('PDF 局部回退无法获取 canvas 上下文');
    context.drawImage(image,0,0,width,height);
    const pixels = context.getImageData(0,0,width,height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3]) {
      left = Math.min(left,x); top = Math.min(top,y); right = Math.max(right,x); bottom = Math.max(bottom,y);
    }
    abort(); if (right < left) return null;
    crop.width = right - left + 1; crop.height = bottom - top + 1;
    target.drawImage(canvas,left,top,crop.width,crop.height,0,0,crop.width,crop.height);
    const blob = await new Promise<Blob>((resolve,reject) => crop.toBlob(value => value ? resolve(value) : reject(new Error('PDF 局部 PNG 编码失败')),'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer()); abort();
    return {bytes,x:left / scale,y:top / scale,width:crop.width / scale,height:crop.height / scale};
  } finally {image.removeAttribute('src'); canvas.width = canvas.height = crop.width = crop.height = 0;}
}
