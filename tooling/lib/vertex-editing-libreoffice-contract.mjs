import { readFileSync } from 'node:fs';
import { decodePng } from './slide-image-background-libreoffice-contract.mjs';

function targetPath(markup) {
  return markup.match(/<path\b[^>]*(?:fill="rgb\(166,166,166\)"|fill="#a6a6a6")[^>]*>/i)?.[0];
}

function pathPoints(tag) {
  const data = tag?.match(/\bd="([^"]+)"/)?.[1] ?? '';
  const numbers = data.match(/-?[\d.]+/g)?.map(Number) ?? [];
  const points = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return { data, points };
}

/** 固定固件的右侧锚点被移到 path(4.5M,0.5M)；由 PPT 坐标独立推导 LO SVG 落点。 */
export function runVertexEditingLibreOfficeContract({ savedPath, exportSvg, exportPng }) {
  const markup = exportSvg('顶点编辑');
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const tag = targetPath(markup);
  if (!viewBox || !tag) throw new Error('LibreOffice 顶点 SVG 缺少 viewBox 或唯一自由形状');
  const { data, points } = pathPoints(tag);
  if (!/[CQL]/.test(data) || !/Z\s*$/.test(data)) {
    throw new Error('LibreOffice 没有把自由形状渲染为闭合曲线路径');
  }
  const frame = { x: 280, y: 170, w: 420, h: 300, rot: 15 };
  const local = { x: 4_500_000 / 4_000_000 * frame.w, y: 500_000 / 3_000_000 * frame.h };
  const center = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const source = { x: frame.x + local.x, y: frame.y + local.y };
  const radians = frame.rot * Math.PI / 180;
  const slide = {
    x: center.x + (source.x - center.x) * Math.cos(radians) - (source.y - center.y) * Math.sin(radians),
    y: center.y + (source.x - center.x) * Math.sin(radians) + (source.y - center.y) * Math.cos(radians),
  };
  const expected = {
    x: slide.x / 1280 * Number(viewBox[1]),
    y: slide.y / 720 * Number(viewBox[2]),
  };
  const error = Math.min(...points.map((point) => Math.hypot(point.x - expected.x, point.y - expected.y)));
  if (error > 3) throw new Error(`LibreOffice 顶点落点偏差 ${error.toFixed(3)} SVG unit`);
  const raster = decodePng(exportPng('顶点编辑像素'));
  if (!raster) throw new Error('LibreOffice 顶点 PNG 不是可验证的 8-bit RGB/RGBA');
  const slidePixel = (localX, localY) => {
    const localPoint = {
      x: frame.x + localX / 4_000_000 * frame.w,
      y: frame.y + localY / 3_000_000 * frame.h,
    };
    const point = {
      x: center.x + (localPoint.x - center.x) * Math.cos(radians)
        - (localPoint.y - center.y) * Math.sin(radians),
      y: center.y + (localPoint.x - center.x) * Math.sin(radians)
        + (localPoint.y - center.y) * Math.cos(radians),
    };
    const x = Math.round(point.x / 1280 * raster.width);
    const y = Math.round(point.y / 720 * raster.height);
    const offset = (y * raster.width + x) * raster.channels;
    return [...raster.pixels.subarray(offset, offset + 3)];
  };
  const near = (actual, expectedColor, tolerance = 3) => actual.every(
    (value, index) => Math.abs(value - expectedColor[index]) <= tolerance,
  );
  const fillPixels = [[800_000, 1_000_000], [2_000_000, 2_300_000], [3_200_000, 1_200_000]]
    .map(([x, y]) => slidePixel(x, y));
  const holePixel = slidePixel(2_066_000, 1_483_000);
  const strokePixel = slidePixel(200_000, 150_000);
  if (!fillPixels.every((pixel) => near(pixel, [166, 166, 166]))
    || !near(holePixel, [255, 255, 255]) || !near(strokePixel, [29, 78, 216], 8)) {
    throw new Error(`LibreOffice 顶点像素 oracle 失败：${JSON.stringify({ fillPixels, holePixel, strokePixel })}`);
  }
  if (!readFileSync(savedPath).length) throw new Error('LibreOffice 顶点 oracle 输入为空');
  return `，自由形状闭合曲线与移动锚点偏差 ${error.toFixed(3)} SVG unit、填充/孔洞/描边像素通过`;
}
