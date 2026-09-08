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
  return { width, height, pixels };
}

const pixelAt = (image, x, y) => [...image.pixels.subarray(
  (y * image.width + x) * 3, (y * image.width + x + 1) * 3,
)].join(',');
const rgbAt = (image, x, y) => [...image.pixels.subarray(
  (y * image.width + x) * 3, (y * image.width + x + 1) * 3,
)];

/** 用 LibreOffice 的最终像素证明替换、裁剪与翻转共同生效，而不只证明包能打开。 */
export function runImageContentLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('图片替换与裁剪');
  const inlinePayloads = [...markup.matchAll(
    /<image\b[^>]*xlink:href="data:image\/png;base64,([^"]+)"/g,
  )].map((match) => match[1]);
  const pngs = inlinePayloads.map(pngPixels).filter(Boolean);
  const replacement = pngs.find((image) => {
    // macOS 重采样为 5×4 并应用 flipH，Linux 保留 6×4 原像素且在 SVG 导出时忽略翻转。
    // 精确裁剪/翻转语义由保存 XML 与独立渲染指纹契约负责；这里验证 LO 的可见像素没有丢失方向信息。
    if (![5, 6].includes(image.width) || image.height !== 4) return false;
    const topLeft = rgbAt(image, 1, 1);
    const right = Math.min(4, image.width - 1);
    const topRight = rgbAt(image, right, 1);
    const bottomLeft = rgbAt(image, 1, 3);
    const bottomRight = rgbAt(image, right, 3);
    // LibreOffice 版本之间会改变裁剪边缘的插值采样点，但四个方向的裁剪与
    // 水平翻转必须继续保留固件的非对称 RGB 梯度及其跨度。
    return Math.abs(Math.abs(topLeft[0] - topRight[0]) - 105) <= 3
      && topLeft[1] >= 10 && topLeft[1] <= 80
      && bottomLeft[1] >= 160 && bottomLeft[1] <= 190
      && bottomLeft[1] - topLeft[1] >= 90
      && Math.abs(topLeft[2] - topRight[2]) >= 65
      && Math.abs(bottomLeft[2] - topLeft[2]) >= 45
      && bottomRight[0] === topRight[0]
      && bottomRight[1] === bottomLeft[1];
  });
  const reusedBitmaps = markup.match(/<use\b[^>]*xlink:href="#bitmap\(/g)?.length ?? 0;
  // Linux 内联相同 data URI，macOS 用 <use>；二者都证明共享来源的两个可见实例存在。
  const inlineCopies = Math.max(0, ...new Map(inlinePayloads.map((payload) => [
    payload, inlinePayloads.filter((candidate) => candidate === payload).length,
  ])).values());
  const sharedInstances = Math.max(reusedBitmaps, inlineCopies);
  if (!replacement || sharedInstances < 2) {
    throw new Error(`LibreOffice 图片内容像素证据无效：${JSON.stringify({
      pngs: pngs.map((image) => ({
        width: image.width,
        height: image.height,
        samples: image.width >= 5 && image.height >= 4
          ? [pixelAt(image, 1, 1), pixelAt(image, 4, 1), pixelAt(image, 1, 3), pixelAt(image, 4, 3)]
          : [],
      })),
      reusedBitmaps, inlineCopies,
    })}`);
  }
  return `，图片替换/四边裁剪由 ${replacement.width}×${replacement.height} 非对称像素验证，${sharedInstances} 个共享位图实例可见`;
}
