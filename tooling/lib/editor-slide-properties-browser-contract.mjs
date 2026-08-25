import { querySlideBackground, querySlideHidden } from '/out/editor/editor.mjs';

const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

const pngBytes = () => Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XxRcbAAAAABJRU5ErkJggg==',
), (value) => value.charCodeAt(0));

const asymmetricPng = async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 2;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const colors = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255],
    [255, 255, 0], [0, 255, 255], [255, 0, 255], [0, 0, 0],
  ];
  const pixels = context.createImageData(4, 2);
  colors.forEach((color, index) => pixels.data.set([...color, 255], index * 4));
  context.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Chrome 无法编码背景像素固件')),
    'image/png',
  ));
};

const rasterizedPixels = async (svg) => {
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', '1280');
  clone.setAttribute('height', '720');
  const image = document.createElement('img');
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Chrome 无法栅格化页面图片背景'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
};

const pixelAt = (pixels, x, y) => [...pixels.slice((y * 320 + x) * 4, (y * 320 + x) * 4 + 4)];

/** 真实浏览器验证整页背景上屏、隐藏元数据零重绘与 200 页批量预算。 */
export async function runEditorSlidePropertiesBrowserContract({ openEditor, load }) {
  const firstMount = document.createElement('div');
  const mirrorMount = document.createElement('div');
  const otherMount = document.createElement('div');
  firstMount.className = mirrorMount.className = otherMount.className = 'contract-offscreen';
  document.body.append(firstMount, mirrorMount, otherMount);
  const session = await openEditor(await load('sample-editor-slide-properties.pptx'), {
    idPrefix: 'browser-slide-properties-',
  });
  const [first, second] = session.editor.doc.slideOrder;
  const editView = session.mount(firstMount, {
    slideId: first, mode: 'edit', textMode: 'svg', snapping: false,
  });
  session.mount(mirrorMount, { slideId: first, mode: 'view', textMode: 'svg', snapping: false });
  session.mount(otherMount, { slideId: second, mode: 'edit', textMode: 'svg', snapping: false });
  const firstStatic = firstMount.querySelector('[data-ppt-layer="static"]');
  const mirrorStatic = mirrorMount.querySelector('[data-ppt-layer="static"]');
  const otherStatic = otherMount.querySelector('[data-ppt-layer="static"]');
  const firstBefore = firstStatic.querySelector('svg');
  const mirrorBefore = mirrorStatic.querySelector('svg');
  const otherBefore = otherStatic.querySelector('svg');
  session.editor.exec({
    type: 'SetBackground', id: first,
    fill: {
      type: 'gradient', angle: 45,
      stops: [{ pos: 0, color: '#DBEAFE' }, { pos: 1, color: '#1D4ED8' }],
    },
  });
  const firstAfter = firstStatic.querySelector('svg');
  const mirrorAfter = mirrorStatic.querySelector('svg');
  if (firstAfter === firstBefore || mirrorAfter === mirrorBefore
    || otherStatic.querySelector('svg') !== otherBefore
    || !firstAfter?.querySelector('linearGradient')
    || !querySlideBackground(session.editor.doc, [first]).direct) {
    throw new Error('Chrome 页面背景整页上屏或无关页 DOM 身份失败');
  }
  session.editor.exec({ type: 'SetHidden', id: first, v: true });
  if (!querySlideHidden(session.editor.doc, [first]).value
    || firstStatic.querySelector('svg') !== firstAfter
    || mirrorStatic.querySelector('svg') !== mirrorAfter
    || otherStatic.querySelector('svg') !== otherBefore) {
    throw new Error('Chrome 页面隐藏状态触发了无意义重绘或查询未同步');
  }
  const imageBefore = firstStatic.querySelector('svg');
  const mirrorImageBefore = mirrorStatic.querySelector('svg');
  await editView.setBackgroundImage(new Blob([pngBytes()], { type: 'image/png' }), {
    crop: { l: 0.1, t: 0.05, r: 0.2, b: 0.15 }, alpha: 0.8,
  });
  const imageState = querySlideBackground(session.editor.doc, [first]);
  if (firstStatic.querySelector('svg') === imageBefore
    || mirrorStatic.querySelector('svg') === mirrorImageBefore
    || otherStatic.querySelector('svg') !== otherBefore
    || imageState.value?.type !== 'image' || imageState.value.alpha !== 0.8
    || !imageState.value.src.startsWith('data:image/png;base64,')) {
    throw new Error('Chrome Blob 页面背景入口或同页多视图同步失败');
  }
  await editView.setBackgroundImage(await asymmetricPng(), {
    crop: { l: 0.25, t: 0, r: 0, b: 0 },
    tile: { sx: 20, sy: 20, flip: 'xy', tx: 8, ty: 4, algn: 'tl' },
  });
  const uploadedPattern = firstStatic.querySelector('pattern');
  const cellTransforms = [...uploadedPattern?.querySelectorAll(':scope > svg > g') ?? []]
    .map((node) => node.getAttribute('transform'));
  if (uploadedPattern?.getAttribute('x') !== '8' || uploadedPattern.getAttribute('y') !== '4'
    || uploadedPattern.getAttribute('width') !== '120' || uploadedPattern.getAttribute('height') !== '80'
    || cellTransforms.join('|') !== [
      'translate(60 0) scale(-1 1)', 'translate(0 40) scale(1 -1)',
      'translate(60 40) scale(-1 -1)',
    ].join('|')) {
    throw new Error(`Chrome 上传图平铺物理尺寸、偏移或交替翻转结构错误：${uploadedPattern?.outerHTML}`);
  }
  const tilePixels = await rasterizedPixels(firstStatic.querySelector('svg'));
  const sampled = [
    pixelAt(tilePixels, 5, 4), pixelAt(tilePixels, 15, 4),
    pixelAt(tilePixels, 20, 4), pixelAt(tilePixels, 5, 14),
  ];
  // Chromium 会在 4×2 原色边界插值；用通道关系证明裁掉红列、横向反转和纵向反转。
  if (!(sampled[0][1] > sampled[0][0] + 120 && sampled[0][1] > sampled[0][2] + 80)
    || !(sampled[1][0] > 180 && Math.max(...sampled[1].slice(0, 3)) - Math.min(...sampled[1].slice(0, 3)) < 20)
    || !(sampled[2][2] > sampled[2][1] + 30)
    || !(sampled[3][1] > sampled[3][0] + 120 && sampled[3][2] > sampled[3][0] + 120)) {
    throw new Error(`Chrome 页面图片背景裁剪或 x/y 交替翻转像素错误：${JSON.stringify([
      ...sampled,
    ])}`);
  }
  const sourceTileMount = document.createElement('div');
  sourceTileMount.className = 'contract-offscreen';
  document.body.append(sourceTileMount);
  const sourceTileSession = await openEditor(await load('sample-editor-slide-image-background.pptx'), {
    idPrefix: 'browser-source-slide-background-',
  });
  sourceTileSession.mount(sourceTileMount, {
    slideId: sourceTileSession.editor.doc.slideOrder[1], mode: 'view', textMode: 'svg', snapping: false,
  });
  const sourcePattern = sourceTileMount.querySelector('[data-ppt-layer="static"] pattern');
  if (sourcePattern?.getAttribute('x') !== '618.8'
    || sourcePattern.getAttribute('y') !== '336.4'
    || sourcePattern.getAttribute('width') !== '124.8'
    || sourcePattern.getAttribute('height') !== '86.4') {
    throw new Error(`Chrome 来源平铺未按图片物理尺寸、对齐和偏移定位：${sourcePattern?.outerHTML}`);
  }
  sourceTileSession.dispose();
  sourceTileMount.remove();
  while (session.editor.doc.slideOrder.length < 200) {
    session.editor.exec({ type: 'DuplicateSlide', id: second });
  }
  const ids = [...session.editor.doc.slideOrder];
  const imageRenderSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    session.editor.exec({
      type: 'SetBackgroundCrop', id: first,
      crop: { l: index % 2 ? 0.12 : 0.18, t: 0.05, r: 0.2, b: 0.15 },
    });
    imageRenderSamples.push(performance.now() - started);
  }
  const imageRenderP95 = percentile95(imageRenderSamples);
  if (imageRenderP95 > 16) {
    throw new Error(`Chrome 200 页图片背景裁剪完整上屏 p95 ${imageRenderP95.toFixed(3)}ms`);
  }
  const batchSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    session.editor.transaction((transaction) => {
      for (const id of ids) transaction.exec({ type: 'SetHidden', id, v: index % 2 === 0 });
    }, '批量页面隐藏');
    batchSamples.push(performance.now() - started);
  }
  const renderSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    session.editor.exec({
      type: 'SetBackground', id: first,
      fill: { type: 'solid', color: index % 2 ? '#0F172A' : '#F8FAFC' },
    });
    renderSamples.push(performance.now() - started);
  }
  const batchP95 = percentile95(batchSamples);
  const renderP95 = percentile95(renderSamples);
  if (ids.length !== 200 || batchP95 > 16 || renderP95 > 16) {
    throw new Error(`Chrome 200 页批量/单页上屏 p95 ${batchP95.toFixed(3)}/${renderP95.toFixed(3)}ms`);
  }
  const modelSession = await openEditor(await load('sample-editor-slide-properties.pptx'), {
    idPrefix: 'browser-slide-background-model-',
  });
  const [modelFirst, modelSecond] = modelSession.editor.doc.slideOrder;
  modelSession.editor.exec({
    type: 'SetBackgroundImage', id: modelFirst, bytes: pngBytes(), mime: 'image/png',
  });
  while (modelSession.editor.doc.slideOrder.length < 200) {
    modelSession.editor.exec({ type: 'DuplicateSlide', id: modelSecond });
  }
  const imageModelSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    modelSession.editor.exec({
      type: 'SetBackgroundCrop', id: modelFirst,
      crop: { l: index % 2 ? 0.12 : 0.18, t: 0.05, r: 0.2, b: 0.15 },
    });
    imageModelSamples.push(performance.now() - started);
  }
  const imageModelP95 = percentile95(imageModelSamples);
  modelSession.dispose();
  if (imageModelP95 > 16) {
    throw new Error(`Chrome 200 页图片背景模型提交 p95 ${imageModelP95.toFixed(3)}ms`);
  }
  session.dispose();
  firstMount.remove();
  mirrorMount.remove();
  otherMount.remove();
  console.info(`200 页属性批量/单页上屏 p95 ${batchP95.toFixed(3)}/${renderP95.toFixed(3)}ms`);
  console.info(`200 页图片背景模型/完整上屏 p95 ${imageModelP95.toFixed(3)}/${imageRenderP95.toFixed(3)}ms`);
  return { batchP95, renderP95, imageModelP95, imageRenderP95 };
}
