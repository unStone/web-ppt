import { unzipSync } from 'fflate';
import { setChartExParser } from '@web-ppt/core';
import type { ChartParser } from './chart/hook';

let ready: Promise<ChartParser> | undefined;

/** 产品打开文件前调用；普通 PPTX 只读取内容类型，不下载现代图表实现。 */
export async function prepareModernCharts(bytes: Uint8Array | ArrayBuffer): Promise<void> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] !== 0x50 || data[1] !== 0x4b) return;
  let types: Uint8Array | undefined;
  try {
    types = unzipSync(data, { filter: (entry) => entry.name === '[Content_Types].xml'
      && entry.originalSize <= 4 * 1024 * 1024 })['[Content_Types].xml'];
  } catch { return; }
  if (!types || !new TextDecoder().decode(types).includes('vnd.ms-office.chartex+xml')) return;
  try {
    ready ??= import('@web-ppt/core/chart-ex').then(({ parseChartEx }) => parseChartEx);
    setChartExParser(await ready);
  } catch {
    // 按需块失败仍可显示来源预览，下一次打开允许重新加载。
    ready = undefined;
  }
}
