import type { Presentation } from '@web-ppt/core';
import {
  PresentationImageExportError,
  presentationToImageZip,
  type PresentationImageZipOptions,
} from '@web-ppt/core/image-zip';

declare const presentation: Presentation;
const options: PresentationImageZipOptions = {
  scale: 2,
  skipHidden: true,
  concurrency: 2,
  onProgress: ({ completed, total, slideNumber, fileName }) => {
    void [completed, total, slideNumber, fileName];
  },
};
const result: Promise<Blob> = presentationToImageZip(presentation, options);
void result;
void PresentationImageExportError;
