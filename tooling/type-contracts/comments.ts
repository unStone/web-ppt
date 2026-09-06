import { slideToPng, slideToSvgFile, presentationToPrintableHtml, type Presentation, type CommentExportOptions } from '@web-ppt/core';
import { presentationToImageZip } from '@web-ppt/core/image-zip';
import { createCommentsPanel, type CommentsPanel } from '@web-ppt/viewer-core/comments';

export async function commentContract(pres: Presentation, container: HTMLElement): Promise<void> {
  const options: CommentExportOptions = { showComments: true };
  const panel: CommentsPanel = createCommentsPanel(container);
  panel.setSlide(pres.slides[0]); panel.setSlide(null); panel.dispose();
  await slideToPng(pres, pres.slides[0]);
  await slideToPng(pres, pres.slides[0], 1, options);
  await slideToSvgFile(pres, pres.slides[0], [], options);
  await presentationToPrintableHtml(pres, options);
  await presentationToImageZip(pres, options);
  // @ts-expect-error 批注开关必须为布尔值。
  await slideToPng(pres, pres.slides[0], 1, { showComments: 'yes' });
}
