import type { Presentation, Slide } from './types';
import { slideToPng } from '@web-ppt/core';
import { validateRasterSize } from './raster-size';
import { groupSteps, hiddenBefore, staticHidden } from './anim-steps';
import { PdfDocument } from './pdf/document';
export { PdfDocument };
export interface PdfExportOptions {
  /** 图片页面的像素倍率，默认 2；文字外观固定，不生成矢量字形。 */
  scale?: number;
  skipHidden?: boolean;
  /** 显示批注标记并写入 PDF 批注，包括回复关系。 */
  showComments?: boolean;
  /** 将每个点击批次展开为一页；默认只导出幻灯片终态。 */
  animationSteps?: boolean;
  title?: string;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number; slideNumber: number }) => void;
}
export async function presentationToPdf(pres: Presentation, options: PdfExportOptions = {}): Promise<Blob> {
  const scale = options.scale ?? 2, size = validateRasterSize(pres, scale);
  if (size.width * size.height > 16000000) throw new Error('PDF 单页不能超过 1600 万像素，请降低导出倍率');
  const jobs: { slide: Slide; slideNumber: number; hidden: number[] }[] = [];
  pres.slides.forEach((slide, index) => {
    if (options.skipHidden && slide.hidden) return;
    const groups = options.animationSteps ? groupSteps(slide.animations) : [];
    if (groups.length) for (let step = 0; step <= groups.length; step++) jobs.push({ slide, slideNumber: index + 1, hidden: [...hiddenBefore(groups, step)] });
    else jobs.push({ slide, slideNumber: index + 1, hidden: [...staticHidden(slide)] });
  });
  const pdf = new PdfDocument(pres.width * 0.75, pres.height * 0.75, options.title);
  const abort = () => { if (options.signal?.aborted) throw new DOMException('PDF 导出已取消', 'AbortError'); };
  for (let i = 0; i < jobs.length; i++) {
    abort(); const job = jobs[i];
    try {
      const png = await slideToPng(pres, job.slide, scale, { showComments: options.showComments, hiddenElements: job.hidden, strictResources: true });
      abort(); pdf.addPage(new Uint8Array(await png.arrayBuffer()), options.showComments ? job.slide.comments : undefined);
    } catch (error) {
      if (options.signal?.aborted) { abort(); }
      throw new Error(`第 ${job.slideNumber} 页 PDF 导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
    options.onProgress?.({ completed: i + 1, total: jobs.length, slideNumber: job.slideNumber });
  }
  abort(); const data = pdf.finish();
  return new Blob([data.buffer as ArrayBuffer], { type: 'application/pdf' });
}
