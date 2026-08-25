import { unzlibSync } from 'fflate';

const decoder = new TextDecoder();

function pngPixels(base64) {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (bytes[24] !== 8 || bytes[25] !== 2 || bytes[28] !== 0) return null;
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const compressed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let compressedAt = 0;
  for (const chunk of chunks) { compressed.set(chunk, compressedAt); compressedAt += chunk.length; }
  const raw = unzlibSync(compressed);
  const stride = width * 3;
  const pixels = new Uint8Array(height * stride);
  const paeth = (left, up, upperLeft) => {
    const estimate = left + up - upperLeft;
    const leftError = Math.abs(estimate - left);
    const upError = Math.abs(estimate - up);
    const upperLeftError = Math.abs(estimate - upperLeft);
    return leftError <= upError && leftError <= upperLeftError ? left
      : upError <= upperLeftError ? up : upperLeft;
  };
  let sourceAt = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[sourceAt++];
    if (filter > 4) return null;
    for (let x = 0; x < stride; x++) {
      const left = x >= 3 ? pixels[y * stride + x - 3] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= 3 ? pixels[(y - 1) * stride + x - 3] : 0;
      let value = raw[sourceAt++];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upperLeft);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const colors = new Set();
  for (let at = 0; at < pixels.length; at += 3) {
    colors.add(`${pixels[at]},${pixels[at + 1]},${pixels[at + 2]}`);
  }
  return { width, height, colors, pixels };
}

const pixelAt = (image, x, y) => [...image.pixels.subarray(
  (y * image.width + x) * 3, (y * image.width + x + 1) * 3,
)].join(',');

/** 用 LibreOffice 的最终像素证明替换、裁剪与翻转共同生效，而不只证明包能打开。 */
export function runImageContentLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('图片替换与裁剪');
  const pngs = [...markup.matchAll(
    /<image\b[^>]*xlink:href="data:image\/png;base64,([^"]+)"/g,
  )].map((match) => pngPixels(match[1])).filter(Boolean);
  const replacement = pngs.find((image) => image.width === 5 && image.height === 4
    && pixelAt(image, 1, 1) === '195,70,144'
    && pixelAt(image, 2, 2) === '160,125,144'
    && pixelAt(image, 4, 3) === '90,180,120');
  const reusedBitmaps = markup.match(/<use\b[^>]*xlink:href="#bitmap\(/g)?.length ?? 0;
  if (!replacement || reusedBitmaps < 2) {
    throw new Error(`LibreOffice 图片内容像素证据无效：${JSON.stringify({
      pngs: pngs.map(({ width, height, colors }) => ({ width, height, colors: [...colors] })),
      reusedBitmaps,
    })}`);
  }
  return `，图片替换/四边裁剪/翻转由 ${replacement.width}×${replacement.height} 非对称像素验证，${reusedBitmaps} 个共享位图复用`;
}
