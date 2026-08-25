import { unzlibSync } from 'fflate';
import { roundtripSlideNotes } from './libreoffice-slide-roundtrip.mjs';

const decoder = new TextDecoder();

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const dl = Math.abs(estimate - left);
  const da = Math.abs(estimate - above);
  const du = Math.abs(estimate - upperLeft);
  return dl <= da && dl <= du ? left : da <= du ? above : upperLeft;
}

function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (bitDepth !== 8 || !channels) return null;
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const compressed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { compressed.set(chunk, at); at += chunk.length; }
  const raw = unzlibSync(compressed);
  const stride = width * channels;
  const output = new Uint8Array(stride * height);
  for (let y = 0, source = 0; y < height; y++) {
    const filter = raw[source++];
    for (let x = 0; x < stride; x++, source++) {
      const left = x >= channels ? output[y * stride + x - channels] : 0;
      const above = y ? output[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? output[(y - 1) * stride + x - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
        : filter === 3 ? Math.floor((left + above) / 2)
          : filter === 4 ? paeth(left, above, upperLeft) : Number.NaN;
      if (!Number.isFinite(predictor)) throw new Error(`LibreOffice PNG 使用未知过滤器：${filter}`);
      output[y * stride + x] = (raw[source] + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels: output };
}

function pngFirstPixel(bytes) {
  const decoded = decodePng(bytes);
  return decoded && { width: decoded.width, height: decoded.height, rgb: [...decoded.pixels.subarray(0, 3)] };
}

function pngPixel(image, xRatio, yRatio) {
  const x = Math.max(0, Math.min(image.width - 1, Math.round((image.width - 1) * xRatio)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round((image.height - 1) * yRatio)));
  const offset = (y * image.width + x) * image.channels;
  return [...image.pixels.subarray(offset, offset + 3)];
}

function sourceCropPixel(xRatio, yRatio) {
  const x = Math.max(0, Math.min(95, Math.round(96 * (0.2 + 0.65 * xRatio))));
  const y = Math.max(0, Math.min(53, Math.round(54 * (0.1 + 0.85 * yRatio))));
  return [20 + (x * 2) % 220, 15 + (y * 4) % 220, (x * 11 + y * 17) % 256];
}

const overWhite = (rgb, alpha) => rgb.map((channel) => Math.round(channel * alpha + 255 * (1 - alpha)));

function libreOfficeBackgroundPixel(xRatio, yRatio) {
  // LibreOffice 26.2 对页面背景忽略 srcRect，但会应用 fillRect@l=1000 与 alphaModFix。
  const x = Math.max(0, Math.min(95, Math.round(96 * ((xRatio - 0.01) / 0.99))));
  const y = Math.max(0, Math.min(53, Math.round(54 * yRatio)));
  return overWhite([20 + (x * 2) % 220, 15 + (y * 4) % 220, (x * 11 + y * 17) % 256], 0.72);
}

const background = (xml) => xml.match(/<p:bg>[^]*?<\/p:bg>/)?.[0] ?? '';
const imageTarget = (xml) => xml.match(
  /<Relationship\b[^>]*\bType="[^"]*\/image"[^>]*\bTarget="([^"]+)"/,
)?.[1] ?? '';

/** SVG 像素证明背景图真的参与渲染；重存 XML 独立证明五页图片语义。 */
export function runSlideImageBackgroundLibreOfficeContract({
  savedPath, out, root, soffice, exportSvg, exportPng,
}) {
  const markup = exportSvg('页面图片背景');
  const images = [...markup.matchAll(/xlink:href="data:image\/png;base64,([^"]+)"/g)]
    .map((match) => decodePng(new Uint8Array(Buffer.from(match[1], 'base64'))))
    .filter(Boolean);
  const uploaded = images.find((image) => image.width === 11 && image.height === 7);
  const source = images.find((image) => image.width === 96 && image.height === 54);
  const renderedCrop = decodePng(exportPng('页面图片背景首屏'));
  const cropPoints = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]];
  const cropSamples = renderedCrop && cropPoints.map(([x, y]) => ({
    actual: pngPixel(renderedCrop, x, y),
    libreOffice: libreOfficeBackgroundPixel(x, y),
    cropped: overWhite(sourceCropPixel(x, y), 0.72),
  }));
  const rasterMatches = cropSamples?.every(({ actual, libreOffice }) =>
    Math.abs(actual[0] - libreOffice[0]) <= 5 && Math.abs(actual[1] - libreOffice[1]) <= 5)
    && cropSamples.some(({ actual, cropped }) =>
      Math.abs(actual[0] - cropped[0]) > 12 || Math.abs(actual[1] - cropped[1]) > 12);
  if (JSON.stringify(uploaded && pngPixel(uploaded, 0, 0)) !== JSON.stringify([240, 25, 0])
    || JSON.stringify(source && pngPixel(source, 0, 0)) !== JSON.stringify([20, 15, 0])
    || !rasterMatches) {
    throw new Error(`LibreOffice 页面背景像素无效：${JSON.stringify({
      uploaded: uploaded && pngPixel(uploaded, 0, 0), source: source && pngPixel(source, 0, 0), cropSamples,
    })}`);
  }

  const roundtrip = roundtripSlideNotes({
    savedPath, out, root, soffice, name: 'slide-image-background',
  });
  const slides = roundtrip.slideParts.map((part) => background(decoder.decode(roundtrip.parts[part])));
  const targets = roundtrip.slideParts.map((part) => imageTarget(decoder.decode(
    roundtrip.parts[`ppt/slides/_rels/${part.slice('ppt/slides/'.length)}.rels`],
  )));
  const evidence = {
    pages: slides.length === 5,
    images: slides.every((xml) => xml.includes('<a:blipFill')),
    resourceGroups: targets[0] && targets[1] && targets[2]
      && targets[0] !== targets[1] && targets[0] !== targets[2] && targets[1] !== targets[2]
      && targets[2] === targets[3] && targets[1] === targets[4],
    alpha: slides[0].includes('amt="72000"') && slides[1].includes('amt="65000"'),
    tile: /<a:tile\b[^>]*\bsx="50000"[^>]*\bsy="75000"/.test(slides[1]),
  };
  if (!Object.values(evidence).every(Boolean)) {
    throw new Error(`LibreOffice 页面图片背景重存证据无效：${JSON.stringify(evidence)}`);
  }
  return '，源图/上传图像素及首屏多点栅格通过（LibreOffice 忽略背景 srcRect）；5 页裁剪 XML、透明度、平铺与复制/新增页媒体复用经重存验证';
}

/** 一页固件把 tile 放到 LibreOffice 首屏；读取其实际 pattern，避免只拿本引擎模型自证。 */
export function runSlideImageTileOracleLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('页面图片背景平铺像素真值');
  const source = [...markup.matchAll(/xlink:href="data:image\/png;base64,([^"]+)"/g)]
    .map((match) => pngFirstPixel(new Uint8Array(Buffer.from(match[1], 'base64'))))
    .find((image) => image?.width === 96 && image.height === 54);
  const pattern = markup.match(/<pattern\b[^>]*\bid="bg-pattern\.[^"]+"[^>]*>/)?.[0];
  const number = (name) => Number(pattern?.match(new RegExp(`\\b${name}="(-?[\\d.]+)"`))?.[1]);
  const actual = { x: number('x'), y: number('y'), width: number('width'), height: number('height') };
  const expected = {
    width: 1651, height: 1143,
    x: (33867 - 1651) / 2 + 10 * 2540 / 96,
    y: (19050 - 1143) / 2 - 2 * 2540 / 96,
  };
  const modulo = (value, period) => ((value % period) + period) % period;
  const circularError = (left, right, period) => {
    const error = Math.abs(modulo(left, period) - modulo(right, period));
    return Math.min(error, period - error);
  };
  const evidence = source && JSON.stringify(source.rgb) === JSON.stringify([20, 15, 0])
    && Math.abs(actual.width - expected.width) <= 2
    && Math.abs(actual.height - expected.height) <= 2
    && circularError(actual.x, expected.x, actual.width) <= 6
    && circularError(actual.y, expected.y, actual.height) <= 6;
  if (!evidence) {
    throw new Error(`LibreOffice 平铺背景图片、物理块尺寸或相位无效：${JSON.stringify({ source, actual, expected })}`);
  }
  return `，LibreOffice pattern ${actual.width}×${actual.height} 验证图片物理尺寸与居中偏移相位`;
}
