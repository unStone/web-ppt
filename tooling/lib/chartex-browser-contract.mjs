import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function mountFallback({ path, mode }) {
  const core = await import('/chartex-core.mjs');
  const bytes = await fetch(path).then((response) => response.arrayBuffer());
  const hex = (digest) => [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const sourceSha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const slide = presentation.slides[0];
  const element = slide.elements[0];
  if (slide.elements.length !== 1 || element.kind !== 'image') throw new Error('回退不是唯一图片对象');
  const asset = presentation.package.assets[element.src];
  const digest = await crypto.subtle.digest('SHA-256', asset.bytes);
  const imageHash = hex(digest);
  const load = async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  };
  const sourceImage = await load(element.src);
  const overlay = document.createElement('div');
  const scale = 960 / presentation.width;
  const height = Math.ceil(presentation.height * scale);
  overlay.style.cssText = `position:fixed;left:0;top:0;width:960px;height:${height}px;background:white;z-index:2147483647`;
  document.body.append(overlay);
  let svg;
  if (mode === 'screen') {
    overlay.innerHTML = core.renderSlideToSvg(presentation, slide, { textMode: 'html' });
  } else {
    svg = await core.slideToSvgFile(presentation, slide);
    if (svg.includes('blob:') || svg.includes('<foreignObject')) throw new Error('独立 SVG 未完成可移植导出');
    const native = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    native.style.cssText = 'width:100%;height:100%;display:block';
    overlay.append(native);
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const x = element.x * scale;
  const y = element.y * scale;
  const w = element.w * scale;
  const h = element.h * scale;
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceImage, x, y, w, h);
  const samples = [];
  for (let row = 1; row < 20; row++) for (let col = 1; col < 20; col++) {
    const px = Math.floor(x + w * col / 20);
    const py = Math.floor(y + h * row / 20);
    const rgb = [...context.getImageData(px, py, 1, 1).data].slice(0, 3);
    if (Math.min(...rgb) < 220) samples.push({ x: px, y: py, rgb });
  }
  if (samples.length < 10) throw new Error('来源图片没有足够可观察的非白区域');
  globalThis.__chartexVisual = { samples, overlay, presentation };
  return { sourceSha256, imageHash, samples: samples.length, width: 960, height, mode, svg };
}

async function compareScreenshot(base64) {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const state = globalThis.__chartexVisual;
  let delta = 0;
  for (const sample of state.samples) {
    const pixel = context.getImageData(sample.x, sample.y, 1, 1).data;
    delta += sample.rgb.reduce((sum, value, index) => sum + Math.abs(pixel[index] - value), 0);
  }
  const mae = delta / state.samples.length / 3;
  state.overlay.remove();
  state.presentation.dispose?.();
  delete globalThis.__chartexVisual;
  if (mae > 12) throw new Error(`图片虽解码但屏幕像素未对应源图：MAE ${mae}`);
  return mae;
}

/** 实际截图与源 PNG 的独立解码比较；不能用 DOM 存在或图片 onload 替代可见性证据。 */
export async function runChartExBrowserContract({ evaluate, request, out, sources }) {
  const results = [];
  for (const source of sources) for (const mode of ['screen', 'standalone-svg']) {
    const { svg, ...result } = await evaluate(`(${mountFallback.toString()})(${JSON.stringify({ path: source.path, mode })})`, true);
    if (source.sha256 && result.sourceSha256 !== source.sha256) throw new Error('真实 ChartEx 来源文件哈希变化');
    if (source.imageHash && result.imageHash !== source.imageHash) throw new Error('真实回退图哈希变化');
    const screenshot = await request('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width: result.width, height: result.height, scale: 1 },
      captureBeyondViewport: true,
    });
    const mae = await evaluate(`(${compareScreenshot.toString()})(${JSON.stringify(screenshot.result.data)})`, true);
    const filename = `chartex-${source.name}-${mode}.png`;
    writeFileSync(join(out, filename), Buffer.from(screenshot.result.data, 'base64'));
    if (svg) writeFileSync(join(out, `chartex-${source.name}.svg`), svg);
    results.push({ source: source.name, ...result, mae, screenshot: filename });
  }
  writeFileSync(join(out, 'chartex-visual-report.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`  ChartEx 真浏览器回退 · ${results.length} 条屏幕/独立 SVG 路径像素验证通过`);
}
