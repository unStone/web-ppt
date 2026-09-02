function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function readU32Be(bytes, offset) {
  return (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8)
    | bytes[offset + 3]) >>> 0);
}

export async function zipFiles(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let end = bytes.length - 22;
  while (end >= 0 && readU32(bytes, end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('批量导出产物缺少 ZIP 目录');
  const count = readU16(bytes, end + 10);
  let cursor = readU32(bytes, end + 16);
  const decoder = new TextDecoder();
  const files = [];
  for (let index = 0; index < count; index++) {
    if (readU32(bytes, cursor) !== 0x02014b50) throw new Error(`ZIP 第 ${index + 1} 项目录损坏`);
    const compression = readU16(bytes, cursor + 10);
    const dosTime = readU16(bytes, cursor + 12);
    const dosDate = readU16(bytes, cursor + 14);
    const size = readU32(bytes, cursor + 20);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const local = readU32(bytes, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = readU16(bytes, local + 26);
    const localExtraLength = readU16(bytes, local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    files.push({ name, compression, dosTime, dosDate, bytes: bytes.slice(start, start + size) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { bytes, files };
}

function sameBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function shape(id, color, x, y, w, h) {
  return {
    kind: 'shape', id, x, y, w, h, rot: 0, flipH: false, flipV: false,
    path: `M0 0 H${w} V${h} H0 Z`, fill: { type: 'solid', color }, stroke: null, text: null,
  };
}

async function pixelAt(png, x, y) {
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, -x, -y);
  bitmap.close();
  return [...context.getImageData(0, 0, 1, 1).data];
}

function near(pixel, color, tolerance = 5) {
  return color.every((value, index) => Math.abs(pixel[index] - value) <= tolerance);
}

export async function runCoreImageZipBrowserContract({ presentationToImageZip, parse, load }) {
  const hidden = await parse(await load('sample-image-zip.pptx'));
  const progress = [];
  const first = await presentationToImageZip(hidden, {
    scale: 0.1,
    concurrency: 2,
    onProgress: (value) => progress.push(value.fileName),
  });
  const firstZip = await zipFiles(first);
  const names = firstZip.files.map((file) => file.name);
  if (names.length !== hidden.slides.length || names[0] !== 'slide-001.png'
    || names.at(-1) !== `slide-${String(hidden.slides.length).padStart(3, '0')}.png`) {
    throw new Error(`批量导出命名或页序错误：${names.join(',')}`);
  }
  if (progress.join(',') !== names.join(',')) throw new Error('进度清单与 ZIP 页序不一致');
  if (firstZip.files.some((file) => file.compression !== 0 || file.dosTime !== 0 || file.dosDate !== 33)) {
    throw new Error('ZIP 项不是 pass-through 或时间元数据不确定');
  }
  const width = Math.round(hidden.width * 0.1);
  const height = Math.round(hidden.height * 0.1);
  for (const file of firstZip.files) {
    if (readU32Be(file.bytes, 16) !== width || readU32Be(file.bytes, 20) !== height) {
      throw new Error(`${file.name} PNG 尺寸错误`);
    }
  }
  const secondZip = await zipFiles(await presentationToImageZip(hidden, { scale: 0.1, concurrency: 2 }));
  if (!sameBytes(firstZip.bytes, secondZip.bytes)) throw new Error('连续两次批量导出字节不确定');
  const visibleZip = await zipFiles(await presentationToImageZip(hidden, { scale: 0.1, skipHidden: true }));
  const expectedVisible = hidden.slides
    .map((slide, index) => ({ slide, name: `slide-${String(index + 1).padStart(3, '0')}.png` }))
    .filter(({ slide }) => !slide.hidden).map(({ name }) => name);
  if (visibleZip.files.map((file) => file.name).join(',') !== expectedVisible.join(',')) {
    throw new Error('隐藏页策略改变了原始页码或页序');
  }

  const pixel = await pixelAt(firstZip.files[0].bytes, Math.floor(width / 2), Math.floor(height / 2));
  if (!near(pixel, [67, 160, 71])) {
    throw new Error(`动画终态未隐藏退出元素：${pixel.join(',')}`);
  }

  const inlineCanvas = document.createElement('canvas');
  inlineCanvas.width = 2;
  inlineCanvas.height = 2;
  const inlineContext = inlineCanvas.getContext('2d');
  inlineContext.fillStyle = '#e53935';
  inlineContext.fillRect(0, 0, 2, 2);
  const inlineUrl = inlineCanvas.toDataURL('image/png');
  const externalUrl = `${location.origin}/fixtures/image-zip-external.png`;
  const resources = {
    width: 40, height: 20, source: 'pptx',
    slides: [{ elements: [
      { kind: 'image', id: 1, x: 0, y: 0, w: 20, h: 20, rot: 0, flipH: false, flipV: false,
        src: inlineUrl, crop: null },
      { kind: 'image', id: 2, x: 20, y: 0, w: 20, h: 20, rot: 0, flipH: false, flipV: false,
        src: externalUrl, crop: null },
    ] }],
  };
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = (...args) => {
    fetched.push(String(args[0]));
    return realFetch(...args);
  };
  let fontPresentation;
  try {
    const resourceZip = await zipFiles(await presentationToImageZip(resources, { scale: 1 }));
    const leftPixel = await pixelAt(resourceZip.files[0].bytes, 10, 10);
    const rightPixel = await pixelAt(resourceZip.files[0].bytes, 30, 10);
    if (!fetched.includes(externalUrl) || !near(leftPixel, [229, 57, 53])
      || !near(rightPixel, [17, 34, 51])) {
      throw new Error(`内联/外链图片未进入输出像素：left=${leftPixel}, right=${rightPixel}, fetched=${fetched}`);
    }

    fontPresentation = await parse(await load('sample-embedfont.pptx'));
    if ((fontPresentation.embeddedFonts ?? []).length < 3) throw new Error('有效嵌入字体固件没有解析出字体');
    const withFont = await zipFiles(await presentationToImageZip(fontPresentation, { scale: 0.2 }));
    const withoutFont = await zipFiles(await presentationToImageZip(
      { ...fontPresentation, embeddedFonts: [] },
      { scale: 0.2 },
    ));
    if (!fetched.some((url) => url.startsWith('blob:'))
      || sameBytes(withFont.files[0].bytes, withoutFont.files[0].bytes)) {
      throw new Error(`有效嵌入字体未改变输出像素：${fetched.join(',')}`);
    }
  } finally {
    globalThis.fetch = realFetch;
    fontPresentation?.dispose?.();
  }

  const prototype = HTMLCanvasElement.prototype;
  const nativeToBlob = prototype.toBlob;
  let securityCalls = 0;
  prototype.toBlob = function wrapped(callback, ...args) {
    if (securityCalls++ === 0) throw new DOMException('tainted', 'SecurityError');
    return nativeToBlob.call(this, callback, ...args);
  };
  try {
    const fallback = await presentationToImageZip({ ...hidden, slides: [hidden.slides[2]] }, { scale: 0.1 });
    if (!(await zipFiles(fallback)).files[0]?.bytes.length || securityCalls !== 2) {
      throw new Error('SecurityError 没有回退到原生 SVG 文本');
    }
  } finally {
    prototype.toBlob = nativeToBlob;
  }

  const many = { width: 4, height: 4, source: 'pptx', slides: Array.from({ length: 210 }, () => ({
    elements: [shape(1, '#336699', 0, 0, 4, 4)],
  })) };
  let active = 0;
  let peak = 0;
  let released = 0;
  prototype.toBlob = function delayed(callback, ...args) {
    active++;
    peak = Math.max(peak, active);
    return nativeToBlob.call(this, (blob) => {
      setTimeout(() => {
        active--;
        callback(blob);
        queueMicrotask(() => { if (this.width === 0 && this.height === 0) released++; });
      }, 2);
    }, ...args);
  };
  try {
    const manyZip = await zipFiles(await presentationToImageZip(many, { scale: 1, concurrency: 3 }));
    await new Promise((resolve) => queueMicrotask(resolve));
    if (manyZip.files.length !== 210 || peak !== 3 || active !== 0 || released !== 210) {
      throw new Error(`210 页资源边界错误：files=${manyZip.files.length}, peak=${peak}, active=${active}, released=${released}`);
    }
  } finally {
    prototype.toBlob = nativeToBlob;
  }

  let calls = 0;
  prototype.toBlob = function failSecond(callback, ...args) {
    calls++;
    if (calls === 2) return void queueMicrotask(() => callback(null));
    return nativeToBlob.call(this, callback, ...args);
  };
  let failure;
  try {
    await presentationToImageZip({ ...many, slides: many.slides.slice(0, 3) }, { scale: 1, concurrency: 1 });
  } catch (error) {
    failure = error;
  } finally {
    prototype.toBlob = nativeToBlob;
  }
  if (failure?.slideNumber !== 2 || failure?.fileName !== 'slide-002.png') {
    throw new Error(`逐页原子错误缺少第 2 页上下文：${String(failure)}`);
  }
  return { pages: 210, concurrency: peak, released };
}
