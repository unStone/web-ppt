/**
 * Agent 003：Node 无 Office 渲染按需入口测试。
 *
 *   node tooling/test-agent-node-render.mjs [--dist]
 *
 * worker 子进程刻意不安装 dom-env：本套件的存在意义就是证明纯 Node（无 jsdom、
 * 无浏览器）可完成渲染。断言覆盖稳定 reason、注入渲染、跨进程确定性、PNG 光栅化
 * 注入与耗时记录；`--dist` 走发布产物 `@web-ppt/core/node`。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { countedAssert } from './lib/counted-assert.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'out/agent-node-render');
mkdirSync(out, { recursive: true });

if (process.argv.includes('--worker')) {
  await worker();
} else {
  await main();
}

async function main() {
  const { assert, record } = countedAssert('agentNodeRender');
  const dist = process.argv.includes('--dist');
  const runWorker = (mode, fixture) => JSON.parse(execFileSync(process.execPath,
    [import.meta.filename, '--worker', ...(dist ? ['--dist'] : []), mode, fixture],
    { cwd: root, encoding: 'utf8' }));

  // 稳定 reason：缺注入必须 fast-fail，不退回估算
  {
    const reasons = runWorker('reasons', 'fixtures/sample.pptx');
    assert.equal(reasons.svgWithoutMeasure, 'node-measure-required', 'SVG 缺测字注入报稳定 reason');
    assert.equal(reasons.pngWithoutMeasure, 'node-measure-required', 'PNG 缺测字注入报稳定 reason');
    assert.equal(reasons.pngWithoutRasterize, 'node-rasterizer-required', 'PNG 缺光栅化注入报稳定 reason');
    assert.equal(reasons.pngEmptyRasterize, 'node-rasterizer-required', '光栅化返回空字节报稳定 reason');
    assert.equal(reasons.errorName, 'NodeRenderError', '错误类名可程序判定');
  }

  // 注入渲染：原生 <text>、无 foreignObject、跨进程确定性、耗时记录
  {
    const first = runWorker('render', 'fixtures/sample.pptx');
    assert.ok(first.pages >= 3, `固件页数不小于 3，收到 ${first.pages}`);
    assert.ok(first.anyTextElement, '页面 SVG 含原生 <text> 元素');
    assert.ok(!first.anyForeignObject, '页面 SVG 不含 foreignObject');
    assert.ok(first.parseMs >= 0 && first.wholeFileMs > 0, '耗时已记录');

    const second = runWorker('render', 'fixtures/sample.pptx');
    assert.deepEqual(first.shas, second.shas, '独立进程两次渲染 SHA256 一致');

    const showcase = runWorker('render', 'fixtures/showcase.pptx');
    assert.equal(showcase.pages, 7, 'showcase 固件 7 页全部渲染');
    writeFileSync(join(out, 'timing.json'), JSON.stringify({
      mode: dist ? 'dist' : 'source',
      sample: { pages: first.pages, parseMs: first.parseMs, wholeFileMs: first.wholeFileMs, singlePageMs: first.singlePageMs },
      showcase: { pages: showcase.pages, parseMs: showcase.parseMs, wholeFileMs: showcase.wholeFileMs, singlePageMs: showcase.singlePageMs },
    }, null, 2) + '\n');
    console.log(`Node 渲染耗时：sample ${first.pages} 页 parse ${first.parseMs}ms / 渲染 ${first.wholeFileMs}ms；`
      + `showcase ${showcase.pages} 页 parse ${showcase.parseMs}ms / 渲染 ${showcase.wholeFileMs}ms`);
  }

  // PNG：尺寸换算与宿主字节透传
  {
    const png = runWorker('png', 'fixtures/sample.pptx');
    assert.equal(png.rasterizedBytes, 8, '宿主光栅化字节原样返回');
    assert.equal(png.width, Math.round(png.slideWidth * 2), '默认 scale=2 的宽度换算正确');
    assert.equal(png.height, Math.round(png.slideHeight * 2), '默认 scale=2 的高度换算正确');
    assert.ok(png.rasterizerSawTextElement, '光栅化函数收到的 SVG 含 <text>');
  }

  // 真实注入：fonts Provider 的 HarfBuzz 测量经 Node 入口整页渲染
  {
    const hbResult = runWorker('harfbuzz', 'fixtures/sample-font-glyphs.pptx');
    assert.equal(hbResult.ok, true, `withFontMeasurement 成功：${hbResult.reason ?? ''}`);
    assert.equal(hbResult.width, 669, 'HarfBuzz 注入字宽与字体布局套件同源（连字行 669px）');
    assert.ok(hbResult.hasTextElement, 'HarfBuzz 注入下 SVG 含原生 <text>');
    assert.ok(!hbResult.hasForeignObject, 'HarfBuzz 注入下 SVG 不含 foreignObject');
    assert.ok(hbResult.autofitShrunk, '注入字宽驱动 autofit 生效');
    assert.equal(hbResult.nodeEqualsDirect, true, 'Node 入口与 renderSlideToSvg 同参输出逐字节一致');
  }

  record();
  console.log(`Agent Node 渲染：稳定 reason、注入渲染、跨进程确定性与 PNG 注入通过（${dist ? 'dist' : '源码'}模式）`);
}

async function worker() {
  const [mode, fixture] = process.argv.slice(process.argv.indexOf('--worker') + 1)
    .filter((argument) => !argument.startsWith('--'));
  // dist 模式与真实用法一致：主入口拿 parse，Node 渲染走 ./node 按需子路径；
  // harfbuzz 模式再并入 fonts 的字形入口
  const lib = process.argv.includes('--dist')
    ? { ...(await import('@web-ppt/core')), ...(await import('@web-ppt/core/node')),
      ...(mode === 'harfbuzz' ? { ...(await import('@web-ppt/fonts/glyphs')), ...(await import('@web-ppt/fonts/glyphs/harfbuzz')) } : {}) }
    : await importSourceBundle(mode === 'harfbuzz');
  const { renderSlideSvgInNode, renderSlidePngInNode, parse } = lib;
  const bytes = new Uint8Array(readFileSync(join(root, fixture)));

  /** 确定性注入测量：全角 1em、西文 0.55em——测字来源由宿主负责，这里验证注入链路。 */
  const measureText = (text, run, scale) => {
    let width = 0;
    for (const char of text) {
      width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char)
        ? run.size * scale : run.size * scale * 0.55;
    }
    return width + (run.spacing ?? 0) * text.length;
  };

  if (mode === 'reasons') {
    const pres = await parse(bytes, { lazy: false });
    const slide = pres.slides[0];
    const reasonOf = async (fn) => { try { await fn(); return '(未抛错)'; } catch (error) { return error.reason ?? `(无 reason: ${error.message})`; } };
    const result = {
      svgWithoutMeasure: await reasonOf(() => renderSlideSvgInNode(pres, slide, {})),
      pngWithoutMeasure: await reasonOf(() => renderSlidePngInNode(pres, slide, {})),
      pngWithoutRasterize: await reasonOf(() => renderSlidePngInNode(pres, slide, { measureText })),
      pngEmptyRasterize: await reasonOf(() => renderSlidePngInNode(pres, slide, { measureText, rasterize: () => new Uint8Array(0) })),
    };
    try { renderSlideSvgInNode(pres, slide, {}); result.errorName = '(未抛错)'; }
    catch (error) { result.errorName = error.name; }
    pres.dispose?.();    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (mode === 'render') {
    const t0 = Date.now();
    const pres = await parse(bytes, { keepPackage: true, lazy: false });
    const parseMs = Date.now() - t0;
    const t1 = Date.now();
    const shas = [];
    let single = 0, anyTextElement = false, anyForeignObject = false;
    // 资源地址是会话态（浏览器同样如此），确定性按实际字节寻址：把 SVG 里的
    // blob: 地址替换为 data: URI 后再比对，与等价指纹的既有口径一致。
    const assets = pres.package?.assets ?? {};
    const addressBytes = (svg) => {
      for (const [url, asset] of Object.entries(assets)) {
        svg = svg.replaceAll(url, `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`);
      }
      return svg;
    };
    for (const slide of pres.slides) {
      const start = Date.now();
      const svg = addressBytes(renderSlideSvgInNode(pres, slide, { measureText }));
      single = Math.max(single, Date.now() - start);
      anyTextElement = anyTextElement || svg.includes('<text');
      anyForeignObject = anyForeignObject || svg.includes('foreignObject');
      shas.push(createHash('sha256').update(svg).digest('hex'));
    }
    const wholeFileMs = Date.now() - t1;
    const pages = shas.length;
    pres.dispose?.();
    process.stdout.write(JSON.stringify({
      shas, pages, parseMs, wholeFileMs, singlePageMs: single, anyTextElement, anyForeignObject,
    }));
    return;
  }

  if (mode === 'harfbuzz') {
    const { createFontProvider, withFontMeasurement, createHarfBuzzShaper } = lib;
    const { fontSample } = await import('./lib/font-glyph-samples.mjs');
    const hb = await import('harfbuzzjs');
    const provider = createFontProvider({ loadShaper: async () => createHarfBuzzShaper(hb) });
    await provider.register({ id: 'latin', origin: 'explicit', bytes: fontSample('latin.ttf') }, { purpose: 'edit' });
    const pres = await parse(bytes, { lazy: false });
    const shape = pres.slides[0].elements.find((e) => e.kind === 'shape'
      && e.text.paragraphs.some((p) => p.runs.some((r) => r.text === 'AV office ffi ﬃ')));
    const body = { ...shape.text, insets: [0, 0, 0, 0], fontScale: 1, autoFitCompute: true,
      paragraphs: shape.text.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, size: 100 })) })) };
    const run = body.paragraphs[0].runs[0];
    const slide = { ...pres.slides[0], elements: [{ ...shape, w: 350, h: 100, text: body }] };
    const measured = await withFontMeasurement(provider, (measure) => {
      const node = renderSlideSvgInNode({ ...pres, slides: [slide] }, slide, { measureText: measure, idPrefix: 'agent-node' });
      const direct = lib.renderSlideToSvg({ ...pres, slides: [slide] }, slide,
        { measureText: measure, idPrefix: 'agent-node', textMode: 'svg', media: 'badge' });
      return { node, direct, width: measure('AV office ffi ﬃ', run, 1) };
    }, { purpose: 'edit', language: 'en', faceForRun: () => 'latin' });
    provider.dispose();
    pres.dispose?.();
    const result = measured.ok ? {
      ok: true,
      width: measured.value.result.width,
      hasTextElement: measured.value.result.node.includes('<text'),
      hasForeignObject: measured.value.result.node.includes('foreignObject'),
      nodeEqualsDirect: measured.value.result.node === measured.value.result.direct,
      autofitShrunk: Number(/font-size="([\d.]+)"/.exec(measured.value.result.node)?.[1] ?? 0) < 100,
    } : { ok: false, reason: measured.reason };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (mode === 'png') {
    const pres = await parse(bytes, { lazy: false });
    const slideWidth = pres.width, slideHeight = pres.height;
    const slide = pres.slides[0];
    let rasterizerSawTextElement = false, width = 0, height = 0;
    const bytesOut = await renderSlidePngInNode(pres, slide, {
      measureText,
      rasterize: (svg, size) => {
        rasterizerSawTextElement = svg.includes('<text');
        ({ width, height } = size);
        const png = new Uint8Array(8);
        png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return png;
      },
    });
    pres.dispose?.();
    process.stdout.write(JSON.stringify({
      rasterizedBytes: bytesOut.byteLength, width, height, slideWidth, slideHeight, rasterizerSawTextElement,
    }));
  }
}

/**
 * 源码模式入口：node-export 不导出 parse（入口职责单一），合成入口把两者打进
 * 一个 bundle，运行时与 dist 模式同样只有一份模块实例。withFonts 时并入
 * fonts 的字形入口（harfbuzz 模式用）。
 */
async function importSourceBundle(withFonts = false) {
  const entry = join(out, 'source-entry.ts');
  writeFileSync(entry,
    `export * from '${join(root, 'packages/core/src/node-export.ts')}';\n`
    + `export * from '${join(root, 'packages/core/src/index.ts')}';\n`
    + (withFonts
      ? `export * from '${join(root, 'packages/fonts/src/glyphs/index.ts')}';\n`
        + `export * from '${join(root, 'packages/fonts/src/glyphs/harfbuzz.ts')}';\n`
      : ''));
  const bundle = join(out, 'source-bundle.mjs');
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node',
    '--log-level=warning', `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
  return import(pathToFileURL(bundle).href);
}
