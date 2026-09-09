import { Unzlib, zlibSync } from 'fflate';

/** 浏览器 canvas 的 8-bit PNG；只解码像素，不依赖 DOM 或第三方 PDF 运行时。 */
export function pdfImage(png: Uint8Array, preserveAlpha = false): { width: number; height: number; compressed: Uint8Array; softMask?: Uint8Array } {
  if (png.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((v, i) => png[i] !== v)) throw new Error('PDF 页面不是 PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), idat: Uint8Array[] = [];
  let width = 0, height = 0, channels = 0, end = false, dataEnded = false;
  for (let at = 8; at + 12 <= png.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (length > png.length - at - 12) throw new Error('PDF 页面 PNG 已截断');
    const b = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      if (width || length !== 13 || at !== 8) throw new Error('PDF 页面 PNG 头无效');
      width = view.getUint32(at + 8); height = view.getUint32(at + 12);
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[b[9]];
      if (!width || !height || width * height > 16000000 || b[8] !== 8 || !channels || b[10] || b[11] || b[12]) throw new Error('PDF 页面需要不超过 1600 万像素的非交错 8-bit PNG');
    } else if (type === 'IDAT') {
      if (!channels || dataEnded) throw new Error('PDF 页面 PNG 数据块顺序无效');
      idat.push(b);
    } else if (type === 'IEND') {
      if (length || at + 12 !== png.length) throw new Error('PDF 页面 PNG 结束块无效');
      end = true; break;
    }
    else if (type === 'tRNS') throw new Error('PDF 页面 PNG 透明色键暂不支持');
    if (type !== 'IDAT' && idat.length) dataEnded = true;
    if (type !== 'IHDR' && type !== 'IDAT' && type !== 'IEND' && !(png[at + 4] & 32)) throw new Error('PDF 页面 PNG 存在不支持的关键块');
    at += length + 12;
  }
  if (!end || !channels || !idat.length) throw new Error('PDF 页面 PNG 不完整');
  const row = width * channels, expected = (row + 1) * height, raw = new Uint8Array(expected); let written = 0;
  const decoder = new Unzlib(chunk => {
    if (written + chunk.length > expected) throw new Error('PDF 页面 PNG 解压超限');
    raw.set(chunk, written); written += chunk.length;
  });
  for (let part = 0; part < idat.length; part++) {
    for (let at = 0; at < idat[part].length; at += 4096) decoder.push(idat[part].subarray(at, at + 4096), false);
  }
  decoder.push(new Uint8Array(), true);
  if (written !== expected) throw new Error('PDF 页面 PNG 像素长度不符');
  const rgb = new Uint8Array(width * height * 3);
  // 局部图片必须把透明度交给 PDF 合成；旧整页入口仍默认合成到白底。
  const mask = preserveAlpha && (channels === 2 || channels === 4) ? new Uint8Array(width * height) : undefined;
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, aa = Math.abs(p - a), bb = Math.abs(p - b), cc = Math.abs(p - c);
    return aa <= bb && aa <= cc ? a : bb <= cc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const offset = y * (row + 1), filter = raw[offset];
    if (filter > 4) throw new Error('PDF 页面 PNG 滤波器无效');
    for (let i = 1; i <= row; i++) {
      const a = i > channels ? raw[offset + i - channels] : 0, b = y ? raw[offset + i - row - 1] : 0, c = y && i > channels ? raw[offset + i - row - 1 - channels] : 0;
      raw[offset + i] += filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
    }
    for (let x = 0; x < width; x++) {
      const source = offset + 1 + x * channels, target = (y * width + x) * 3;
      const alpha = channels === 2 || channels === 4 ? raw[source + channels - 1] / 255 : 1;
      if (mask) mask[y * width + x] = raw[source + channels - 1];
      for (let c = 0; c < 3; c++) rgb[target + c] = preserveAlpha ? raw[source + (channels <= 2 ? 0 : c)]
        : Math.round(raw[source + (channels <= 2 ? 0 : c)] * alpha + 255 * (1 - alpha));
    }
  }
  return { width, height, compressed: zlibSync(rgb, { level: 6 }),
    ...(mask ? {softMask:zlibSync(mask,{level:6})} : {}) };
}
