/**
 * 导出字体管线（@web-ppt/fonts/subset + core 导出选项）的浏览器验收。
 *
 * 在真实 Chrome 里跑通完整闭环：wasm 引擎 → 嵌入字体子集化 → 导出产物。
 * 硬验收是「子集开 / 关两次导出的 PNG 光栅字节一致」——同字体同字形的光栅
 * 不应因子集化改变；再用「去掉字体后的 PNG 与两者不同」排除空转通过。
 */
let assertions = 0;
const ensure = (condition, message) => {
  assertions++;
  if (!condition) throw new Error(message);
};

export async function exportFontBrowserContract() {
  const [{ createHarfBuzzSubsetter }, core, { exportFontFaces }] = await Promise.all([
    import('@web-ppt/fonts/subset'),
    import('@web-ppt/core'),
    import('@web-ppt/fonts'),
  ]);

  // 真实引擎闭环：wasm 由测试服务器直接从 node_modules 分发
  const wasm = new Uint8Array(await fetch('/node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm').then((r) => r.arrayBuffer()));
  const subsetter = await createHarfBuzzSubsetter(wasm);
  const chinese = new Uint8Array(await fetch('/tooling/font-glyph-samples/chinese.ttf').then((r) => r.arrayBuffer()));
  const subset = await subsetter.subset({
    bytes: chinese,
    mime: 'font/ttf',
    chars: '你好世界',
    family: '浏览器验收',
    bold: false,
    italic: false,
  });
  ensure(
    subset.ok && subset.bytes.length < chinese.length,
    `浏览器内子集化可用且产物更小（${subset.ok ? subset.bytes.length : -1} < ${chinese.length}）`,
  );

  // 端到端：一份带嵌入 CJK 字体的单页文稿
  const fontUrl = URL.createObjectURL(new Blob([chinese], { type: 'font/ttf' }));
  const mkText = (text) => ({
    kind: 'shape',
    x: 0,
    y: 0,
    w: 420,
    h: 140,
    rot: 0,
    flipH: false,
    flipV: false,
    path: null,
    fill: null,
    stroke: null,
    text: {
      anchor: 'top',
      insets: [0, 0, 0, 0],
      wrap: true,
      fontScale: 1,
      paragraphs: [
        {
          align: 'left',
          lvl: 0,
          marL: 0,
          indent: 0,
          bullet: null,
          lineHeight: null,
          spaceBefore: 0,
          spaceAfter: 0,
          runs: [{ text, b: false, i: false, u: false, strike: false, size: 40, color: '#000000', fonts: ['WebPPT Export CJK'] }],
        },
      ],
    },
  });
  const pres = {
    width: 960,
    height: 540,
    source: 'pptx',
    slides: [{ background: null, elements: [mkText('你好世界')] }],
    embeddedFonts: [{ family: 'WebPPT Export CJK', src: fontUrl, bold: false, italic: false }],
  };
  const svgFull = await core.slideToSvgFile(pres, pres.slides[0]);
  const svgSubset = await core.slideToSvgFile(pres, pres.slides[0], undefined, { fonts: { subsetter } });
  ensure(svgSubset.length < svgFull.length / 2, `子集化导出 SVG 显著小于整字体（${svgSubset.length} < ${svgFull.length}/2）`);
  const pngFull = new Uint8Array(await (await core.slideToPng(pres, pres.slides[0], 1)).arrayBuffer());
  const pngSubset = new Uint8Array(await (await core.slideToPng(pres, pres.slides[0], 1, { fonts: { subsetter } })).arrayBuffer());
  ensure(
    pngFull.length === pngSubset.length && pngFull.every((b, i) => b === pngSubset[i]),
    `子集开 / 关的 PNG 光栅字节一致（${pngFull.length} vs ${pngSubset.length}）`,
  );
  // 非空转证明：去掉字体后光栅确实不同（字体真实影响了渲染）
  const pngFallback = new Uint8Array(await (await core.slideToPng({ ...pres, embeddedFonts: [] }, pres.slides[0], 1)).arrayBuffer());
  ensure(pngFull.length !== pngFallback.length || pngFull.some((b, i) => b !== pngFallback[i]), '字体真实参与光栅（与无字体导出不同）');
  URL.revokeObjectURL(fontUrl);

  // skipInstalled：探针为真时不取任何切片（真探针结论随机器漂移，不能直接断言）
  const probe = {
    font: '',
    measureText() {
      return { width: this.font.includes('黑体') ? 120 : 100 };
    },
  };
  const fakeDoc = { createElement: (tag) => (tag === 'canvas' ? { getContext: () => probe } : {}) };
  const skipped = await exportFontFaces([{ family: '黑体', styles: [{ bold: false, italic: false }], chars: '你', count: 1 }], {
    skipInstalled: true,
    document: fakeDoc,
    base: 'https://export-skip.invalid',
  });
  ensure(skipped.length === 0, 'skipInstalled 且探针为真时不内联替代切片');

  subsetter.dispose();
  return {
    assertions,
    pngBytes: pngFull.length,
    svgFull: svgFull.length,
    svgSubset: svgSubset.length,
    fontBytes: chinese.length,
    subsetBytes: subset.ok ? subset.bytes.length : 0,
  };
}
