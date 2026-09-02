import { Zip, ZipPassThrough } from 'fflate';
import { staticHidden } from './anim-steps';
import { slideToPngWithOptions, validateRasterSize } from './browser-export';
import type { Presentation, Slide } from './types';

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 8;
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0, 0);

export interface PresentationImageZipProgress {
  readonly completed: number;
  readonly total: number;
  readonly slideNumber: number;
  readonly fileName: string;
}

export interface PresentationImageZipOptions {
  /** 相对演示文稿原始像素尺寸的倍数，默认 2。 */
  scale?: number;
  /** 是否跳过被标记为隐藏的页；默认 false。 */
  skipHidden?: boolean;
  /** 同时光栅化的页数，整数 1–8，默认 2。 */
  concurrency?: number;
  /** 每个文件写入 ZIP 后调用一次，适合驱动产品层进度条。 */
  onProgress?: (progress: PresentationImageZipProgress) => void;
}

export class PresentationImageExportError extends Error {
  readonly slideNumber: number;
  readonly fileName: string;
  readonly cause: unknown;

  constructor(slideNumber: number, fileName: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`第 ${slideNumber} 页（${fileName}）导出失败：${detail}`);
    this.name = 'PresentationImageExportError';
    this.slideNumber = slideNumber;
    this.fileName = fileName;
    this.cause = cause;
  }
}

interface PageJob {
  readonly slide: Slide;
  readonly slideNumber: number;
  readonly fileName: string;
}

function optionsOf(options: PresentationImageZipOptions): Required<Pick<
  PresentationImageZipOptions, 'scale' | 'skipHidden' | 'concurrency'
>> & Pick<PresentationImageZipOptions, 'onProgress'> {
  const scale = options.scale ?? 2;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('scale 必须是大于 0 的有限数');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new RangeError(`concurrency 必须是 1–${MAX_CONCURRENCY} 的整数`);
  }
  return { scale, concurrency, skipHidden: options.skipHidden ?? false, onProgress: options.onProgress };
}

function jobsOf(pres: Presentation, skipHidden: boolean): PageJob[] {
  const digits = Math.max(3, String(pres.slides.length).length);
  return pres.slides.flatMap((slide, index) => {
    if (skipHidden && slide.hidden) return [];
    const slideNumber = index + 1;
    return [{ slide, slideNumber, fileName: `slide-${String(slideNumber).padStart(digits, '0')}.png` }];
  });
}

async function renderPage(pres: Presentation, job: PageJob, scale: number): Promise<Uint8Array> {
  try {
    const blob = await slideToPngWithOptions(pres, job.slide, {
      scale,
      hiddenElements: [...staticHidden(job.slide)],
      strictResources: true,
    });
    return new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    throw new PresentationImageExportError(job.slideNumber, job.fileName, error);
  }
}

/**
 * 将整份演示导出为 PNG ZIP。PNG 已压缩，因此 ZIP 使用 pass-through，既避免无效二次压缩，
 * 又能以固定批次释放 canvas 与 Blob；任何一页失败都只拒绝 Promise，不暴露半成品。
 */
export async function presentationToImageZip(
  pres: Presentation,
  options: PresentationImageZipOptions = {},
): Promise<Blob> {
  const normalized = optionsOf(options);
  validateRasterSize(pres, normalized.scale);
  const jobs = jobsOf(pres, normalized.skipHidden);
  const chunks: Uint8Array[] = [];
  let zipError: Error | undefined;
  let finish: (() => void) | undefined;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const zip = new Zip((error, chunk, final) => {
    if (error) zipError = error;
    else if (chunk) chunks.push(chunk);
    if (error || final) finish?.();
  });

  let completed = 0;
  try {
    // 固定大小批次让最坏情况下同时存活的 canvas、Blob 与未写入 PNG 都有明确上界。
    for (let start = 0; start < jobs.length; start += normalized.concurrency) {
      const batch = jobs.slice(start, start + normalized.concurrency);
      const outcomes = await Promise.allSettled(
        batch.map((job) => renderPage(pres, job, normalized.scale)),
      );
      const failed = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const images = outcomes.map((outcome) => (outcome as PromiseFulfilledResult<Uint8Array>).value);
      for (let index = 0; index < batch.length; index++) {
        const job = batch[index];
        const entry = new ZipPassThrough(job.fileName);
        entry.mtime = ZIP_MTIME;
        entry.os = 0;
        zip.add(entry);
        entry.push(images[index], true);
        completed++;
        try {
          normalized.onProgress?.({
            completed,
            total: jobs.length,
            slideNumber: job.slideNumber,
            fileName: job.fileName,
          });
        } catch (error) {
          throw new PresentationImageExportError(job.slideNumber, job.fileName, error);
        }
        if (zipError) throw zipError;
      }
    }
    zip.end();
    await done;
    if (zipError) throw zipError;
    const parts = chunks.map((chunk) => chunk.buffer.slice(
      chunk.byteOffset, chunk.byteOffset + chunk.byteLength,
    ) as ArrayBuffer);
    return new Blob(parts, { type: 'application/zip' });
  } catch (error) {
    zip.terminate();
    if (error instanceof PresentationImageExportError) throw error;
    const next = jobs[Math.min(completed, Math.max(0, jobs.length - 1))];
    if (next) throw new PresentationImageExportError(next.slideNumber, next.fileName, error);
    throw error;
  }
}
