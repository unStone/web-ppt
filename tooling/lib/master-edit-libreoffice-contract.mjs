import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { decodePng } from './slide-image-background-libreoffice-contract.mjs';

function pathBounds(tag) {
  const values = tag.match(/\bd="([^"]+)"/)?.[1].match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (values.length < 8 || values.length % 2) return null;
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

const geometryError = (actual, expected) => actual
  ? Math.max(...Object.keys(expected).map((key) => Math.abs(actual[key] - expected[key])))
  : Infinity;

/** 让独立办公软件证明母版背景、共享图形和文字默认值真正进入有效页面。 */
export function runMasterEditLibreOfficeContract({ savedPath, out, exportSvg, exportPng }) {
  const files = unzipSync(new Uint8Array(readFileSync(savedPath)));
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  for (const part of ['ppt/slides/slide7.xml', 'ppt/slides/slide8.xml']) {
    files[part] = encoder.encode(decoder.decode(files[part]).replace('<p:sld show="0"', '<p:sld show="1"'));
  }
  // PNG 导出只取第一页；临时把目标母版的继承页置首，避免采到另一个母版的合法白背景。
  files['ppt/presentation.xml'] = encoder.encode(
    decoder.decode(files['ppt/presentation.xml'])
      .replace(/(<p:sldIdLst>)([\s\S]*?)(<p:sldId id="301" r:id="rId43"\/>)([\s\S]*?<\/p:sldIdLst>)/,
        '$1$3$2$4'),
  );
  const oracle = join(out, 'master-editing-visible-oracle.pptx');
  if (existsSync(oracle)) unlinkSync(oracle);
  writeFileSync(oracle, zipSync(files));

  const markup = exportSvg('母版编辑几何与文字默认值', oracle);
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) throw new Error('LibreOffice 母版 SVG 缺少 viewBox');
  const expected = {
    left: 916 / 1280 * Number(viewBox[1]), right: 1096 / 1280 * Number(viewBox[1]),
    top: 18 / 720 * Number(viewBox[2]), bottom: 46 / 720 * Number(viewBox[2]),
  };
  const geometry = Math.min(...(markup.match(/<path\b[^>]*\bfill="(?!none)[^"]+"[^>]*>/g) ?? [])
    .map((tag) => geometryError(pathBounds(tag), expected)));
  const secondLevel = markup.match(/<tspan class="TextPosition" x="([\d.]+)"[^>]*><tspan\b[^>]*>母版二级<\/tspan><\/tspan>/);
  const fontSize = Number(secondLevel?.[0].match(/\bfont-size="([\d.]+)(?:px|pt)?"/)?.[1]);
  const expectedFontSize = 30 / 1280 * Number(viewBox[1]);
  const alignedX = Number(secondLevel?.[1]);
  const bodyMiddle = (180 + 880 / 2) / 1280 * Number(viewBox[1]);

  const image = decodePng(exportPng('母版编辑背景像素', oracle));
  const x = Math.floor(image.width * 0.1);
  const y = Math.floor(image.height * 0.9);
  const offset = (y * image.width + x) * image.channels;
  const pixel = [...image.pixels.subarray(offset, offset + 3)];
  const pixelError = Math.max(...pixel.map((value, index) => Math.abs(value - [17, 34, 51][index])));
  if (geometry > 3 || !secondLevel || Math.abs(fontSize - expectedFontSize) > 3
    || alignedX <= bodyMiddle || pixelError > 3) {
    throw new Error(`LibreOffice 母版 oracle 失败：geometry=${geometry.toFixed(3)} fontSize=${fontSize} alignedX=${alignedX} pixel=${pixel.join(',')}`);
  }
  return `，母版标记偏差 ${geometry.toFixed(3)} SVG unit/二级正文 ${fontSize} 且右对齐/背景像素 ${pixel.join(',')}`;
}
