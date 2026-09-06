import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
async function mountNative() {
  const core = await import('/chartex-core.mjs'), cx = await import('/chartex-native.mjs');
  core.setChartExParser(cx.parseChartEx);
  const bytes = await fetch('/fixtures/sample-chartex-native.pptx').then((r) => r.arrayBuffer());
  const presentation = await core.parse(bytes, { lazy: false });
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;left:0;top:0;background:white;z-index:2147483647;width:1280px;display:grid;grid-template-columns:repeat(2,640px)';
  document.body.append(overlay);
  const reports = [];
  for (const [index, slide] of presentation.slides.entries()) {
    if (slide.elements[0].kind !== (index === 7 ? 'image' : 'group'))
      throw new Error('浏览器原生分支不正确');
    const screen = document.createElement('div');
    screen.style.cssText = 'width:640px;height:420px';
    screen.innerHTML = core.renderSlideToSvg(presentation, slide, { textMode: 'html' });
    overlay.append(screen);
    const svg = await core.slideToSvgFile(presentation, slide);
    if (/foreignObject|blob:|NaN|Infinity/.test(svg))
      throw new Error('独立 SVG 非自包含或坐标无效');
    const native = new Image();
    native.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await native.decode();
    native.style.cssText = 'width:640px;height:420px';
    overlay.append(native);
    const png = await core.slideToPng(presentation, slide);
    const pngImage = new Image(), url = URL.createObjectURL(png);
    pngImage.src = url;
    await pngImage.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(pngImage, 0, 0, 640, 420);
    URL.revokeObjectURL(url);
    const pixels = ctx.getImageData(0, 0, 640, 420).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 190)
        colored++;
    if (colored < 1000)
      throw new Error('PNG 仅有空白或文字，没有图形面积');
    reports.push({ page: index + 1, colored, pngBytes: png.size, svgBytes: svg.length });
  }
  const printable = await core.presentationToPrintableHtml(presentation);
  if (printable.includes('foreignObject') || !printable.includes('<svg'))
    throw new Error('打印没有使用原生 SVG');
  globalThis.__nativeChartEx = { overlay, presentation };
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return reports;
}
export async function runNativeChartExBrowserContract({ evaluate, request, out }) {
  const reports = await evaluate(`(${mountNative.toString()})()`, true);
  const screenshot = await request('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 3360, scale: 1 }, captureBeyondViewport: true });
  writeFileSync(join(out, 'chartex-native-gallery.png'), Buffer.from(screenshot.result.data, 'base64'));
  writeFileSync(join(out, 'chartex-native-browser.json'), JSON.stringify(reports, null, 2) + '\n');
  await evaluate(`(()=>{const s=globalThis.__nativeChartEx;s.overlay.remove();s.presentation.dispose();delete globalThis.__nativeChartEx;})()`);
  // 后续原回退合约仍明确使用默认入口。
  await evaluate(`import('/chartex-core.mjs').then(core=>core.setChartExParser(null))`, true);
  console.log('  ChartEx 原生 · 8 页屏幕、独立 SVG、PNG 与打印通过');
}
