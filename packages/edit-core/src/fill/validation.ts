import { readImageMetadata } from '@web-ppt/core';
import type { ImageMetadata } from '@web-ppt/core';
import { decodeBase64 } from '../agent/base64';
import { createImageResource } from '../commands/image-resource';
import validate from './generated-validator';
import type { TemplateFillChart, TemplateFillOutline } from './types';
import { TemplateFillError } from './errors';
import { normalizedOutline } from './text-validation';

const validator = validate as typeof validate & {
  readonly errors?: readonly { readonly instancePath: string; readonly message?: string }[] | null;
};

export interface PreparedFillImage {
  readonly bytes: Uint8Array;
  readonly metadata: ImageMetadata;
}

function chartData(chart: TemplateFillChart, page: number): void {
  const fail = (field: string, detail: string): never => {
    throw new TemplateFillError('invalid-chart-data', `第 ${page} 页图表 ${field}：${detail}`, page, `chart.${field}`);
  };
  const xy = chart.type === 'scatter' || chart.type === 'bubble';
  if (!chart.series.length) fail('series', '至少需要一个系列');
  if (xy && chart.categories.length) fail('categories', '散点和气泡图使用 x 数组，categories 必须为空');
  if (!xy && !chart.categories.length) fail('categories', '类别图至少需要一个类别');
  if (chart.type === 'pie' && chart.series.length !== 1) fail('series', '饼图必须恰有一个系列');
  chart.series.forEach((series, index) => {
    const field = `series[${index}]`;
    if (!series.values.length) fail(`${field}.values`, '至少需要一个数据点');
    if (!xy && series.values.length !== chart.categories.length) {
      fail(`${field}.values`, `实际 ${series.values.length} 个值，预期与 ${chart.categories.length} 个类别一致`);
    }
    if (xy && (!series.x || series.x.length !== series.values.length)) {
      fail(`${field}.x`, `x 必须与 ${series.values.length} 个 values 一一对应`);
    }
    if (!xy && series.x !== undefined) fail(`${field}.x`, '类别图不能带 x 数据');
    if (chart.type === 'bubble') {
      if (!series.sizes || series.sizes.length !== series.values.length) {
        fail(`${field}.sizes`, `sizes 必须与 ${series.values.length} 个 values 一一对应`);
      }
      if (series.sizes?.some((value) => value !== null && value < 0)) fail(`${field}.sizes`, '气泡尺寸不能为负');
    } else if (series.sizes !== undefined) fail(`${field}.sizes`, '只有气泡图接受 sizes');
  });
}

export function prepareOutline(input: unknown): {
  readonly outline: TemplateFillOutline;
  readonly images: ReadonlyMap<number, PreparedFillImage>;
} {
  if (!validator(input)) {
    const error = validator.errors?.[0];
    const page = /^\/slides\/(\d+)(?:\/|$)/.exec(error?.instancePath ?? '');
    throw new TemplateFillError(
      'invalid-outline',
      `大纲不符合 template-fill Schema：${error?.instancePath || '/'} ${error?.message ?? ''}`,
      page ? Number(page[1]) + 1 : null,
      error?.instancePath ?? null,
    );
  }
  const outline = normalizedOutline(input as TemplateFillOutline);
  const images = new Map<number, PreparedFillImage>();
  outline.slides.forEach((slide, index) => {
    const page = index + 1;
    if (slide.type === 'chart') chartData(slide.chart, page);
    if (slide.type !== 'image') return;
    try {
      const bytes = decodeBase64(slide.image.bytes, index);
      createImageResource(bytes, slide.image.mime, `第 ${page} 页 image`);
      const metadata = readImageMetadata(bytes);
      if (!metadata || metadata.width <= 0 || metadata.height <= 0) {
        throw new Error('图片必须含可读取的正宽高');
      }
      images.set(index, { bytes, metadata });
    } catch (error) {
      throw new TemplateFillError(
        'invalid-image',
        `第 ${page} 页图片无效：${error instanceof Error ? error.message : String(error)}`,
        page,
        'image',
      );
    }
  });
  return { outline, images };
}
