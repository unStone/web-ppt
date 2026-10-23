import type { EmbeddedFont } from '@web-ppt/core';

export interface SvgContrastSamplerOptions {
  readonly rasterize: (svg: string, width: number, height: number, signal?: AbortSignal) => Promise<Uint8Array | Uint8ClampedArray>;
  readonly embeddedFonts?: readonly EmbeddedFont[];
  readonly fontFamily?: string;
  readonly scale?: number;
  readonly maxPixels?: number;
}
export { createSvgContrastSampler } from './sampler-batch';
