import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { decodePng } from './slide-image-background-libreoffice-contract.mjs';

function pathBounds(tag) {
  const values = tag.match(/\bd="([^"]+)"/)?.[1].match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (values.length < 8 || values.length % 2) throw new Error('版式标记 SVG 路径坐标无效');
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

const error = (actual, expected) => Math.max(...Object.keys(expected)
  .map((key) => Math.abs(actual[key] - expected[key])));

/** 独立办公软件同时验证共享版式新增图形的几何和背景实际像素。 */
export function runLayoutEditLibreOfficeContract({
  savedPath, out, exportSvg, exportPng,
}) {
  const files = unzipSync(new Uint8Array(readFileSync(savedPath)));
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  for (const part of ['ppt/slides/slide7.xml', 'ppt/slides/slide8.xml']) {
    files[part] = encoder.encode(decoder.decode(files[part]).replace('<p:sld show="0"', '<p:sld show="1"'));
  }
  const oracle = join(out, 'layout-editing-visible-oracle.pptx');
  if (existsSync(oracle)) unlinkSync(oracle);
  writeFileSync(oracle, zipSync(files));
  const markup = exportSvg('版式编辑几何', oracle);
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const marker = (markup.match(/<path\b[^>]*>/g) ?? []).find((tag) =>
    tag.includes('fill="rgb(250,100,50)"') || tag.includes('fill="#fa6432"'));
  if (!viewBox || !marker) throw new Error('LibreOffice 版式 SVG 缺少画布或共享标记');
  const expected = {
    left: 880 / 1280 * Number(viewBox[1]), right: 1100 / 1280 * Number(viewBox[1]),
    top: 540 / 720 * Number(viewBox[2]), bottom: 630 / 720 * Number(viewBox[2]),
  };
  const geometry = error(pathBounds(marker), expected);
  const image = decodePng(exportPng('版式编辑像素', oracle));
  const x = Math.floor(image.width * 0.5);
  const y = Math.floor(image.height * 0.95);
  const offset = (y * image.width + x) * image.channels;
  const pixel = [...image.pixels.subarray(offset, offset + 3)];
  const pixelError = Math.max(...pixel.map((value, index) => Math.abs(value - [17, 34, 51][index])));
  if (geometry > 3 || pixelError > 3) {
    throw new Error(`LibreOffice 版式 oracle 失败：geometry=${geometry.toFixed(3)} pixel=${pixel.join(',')}`);
  }
  return `，版式共享标记偏差 ${geometry.toFixed(3)} SVG unit/背景像素 ${pixel.join(',')}`;
}
