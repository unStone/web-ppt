import { unzipSync } from 'fflate';

function pngName(index, total) {
  return `slide-${String(index + 1).padStart(Math.max(3, String(total).length), '0')}.png`;
}

/** 批量图片导出的公共入口契约；浏览器能力只在调用时需要。 */
export async function runCoreImageZipContract({ imageZip, parsed, check, eq }) {
  const source = parsed.get('sample-image-zip.pptx');
  if (!check('批量导出固件存在', !!source)) return;

  const realImage = globalThis.Image;
  const realFetch = globalThis.fetch;
  const realFileReader = globalThis.FileReader;
  const realDocument = globalThis.document;
  const realCreate = realDocument.createElement.bind(realDocument);
  const sources = [];
  let securityFailures = 0;

  globalThis.Image = class {
    set src(value) {
      sources.push(value);
      queueMicrotask(() => this.onload?.());
    }
  };
  realDocument.createElement = (tag) => {
    if (tag !== 'canvas') return realCreate(tag);
    return {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
      toBlob(callback) {
        if (securityFailures-- > 0) {
          const error = new Error('tainted');
          error.name = 'SecurityError';
          throw error;
        }
        queueMicrotask(() => callback(new Blob(['png'], { type: 'image/png' })));
      },
    };
  };

  try {
    const all = await imageZip.presentationToImageZip(source, { scale: 1, concurrency: 2 });
    const allFiles = unzipSync(new Uint8Array(await all.arrayBuffer()));
    const expected = source.slides.map((_, index) => pngName(index, source.slides.length));
    eq('批量导出稳定命名且保持源页序', Object.keys(allFiles).join(','), expected.join(','));
    eq('默认包含隐藏页', Object.keys(allFiles).length, source.slides.length);
    check('批量导出使用动画终态', sources.some((value) =>
      decodeURIComponent(value).includes('visibility%3Ahidden')
      || decodeURIComponent(value).includes('visibility:hidden')));

    const visible = await imageZip.presentationToImageZip(source, { scale: 1, skipHidden: true });
    const visibleNames = Object.keys(unzipSync(new Uint8Array(await visible.arrayBuffer())));
    const expectedVisible = source.slides
      .map((slide, index) => ({ slide, name: pngName(index, source.slides.length) }))
      .filter(({ slide }) => !slide.hidden)
      .map(({ name }) => name);
    eq('跳过隐藏页仍保留原始页码', visibleNames.join(','), expectedVisible.join(','));

    securityFailures = 1;
    sources.length = 0;
    const fallback = await imageZip.presentationToImageZip(
      { ...source, slides: [source.slides[0]] },
      { scale: 1, concurrency: 1 },
    );
    check('批量导出沿用 SecurityError 回退', fallback.size > 0 && sources.length === 2);
    check('回退到原生 SVG 文本', !decodeURIComponent(sources[1] ?? '').includes('<foreignObject'));

    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      let message = '';
      try { await imageZip.presentationToImageZip(source, { scale: bad }); }
      catch (error) { message = String(error?.message ?? error); }
      check(`拒绝非法比例 ${String(bad)}`, /scale/.test(message), message);
    }
    let emptySizeMessage = '';
    try { await imageZip.presentationToImageZip({ ...source, slides: [] }, { scale: 200 }); }
    catch (error) { emptySizeMessage = String(error?.message ?? error); }
    check('零页输出仍校验 canvas 尺寸', /canvas|尺寸/.test(emptySizeMessage), emptySizeMessage);
    for (const bad of [0, 1.5, 9]) {
      let message = '';
      try { await imageZip.presentationToImageZip(source, { concurrency: bad }); }
      catch (error) { message = String(error?.message ?? error); }
      check(`拒绝非法并发 ${bad}`, /concurrency/.test(message), message);
    }

    const firstBytes = new Uint8Array(await all.arrayBuffer());
    const second = await imageZip.presentationToImageZip(source, { scale: 1, concurrency: 2 });
    const secondBytes = new Uint8Array(await second.arrayBuffer());
    check('连续导出 ZIP 字节确定', firstBytes.length === secondBytes.length
      && firstBytes.every((value, index) => value === secondBytes[index]));

    const noDom = { document: globalThis.document, Image: globalThis.Image };
    delete globalThis.document;
    delete globalThis.Image;
    let noDomMessage = '';
    try {
      await imageZip.presentationToImageZip({ ...source, slides: [source.slides[0]] });
    } catch (error) {
      noDomMessage = String(error?.message ?? error);
    } finally {
      globalThis.document = noDom.document;
      globalThis.Image = noDom.Image;
    }
    check('无 DOM 只在调用时给出清晰错误', /浏览器|DOM|canvas/.test(noDomMessage), noDomMessage);

    const resourcePage = {
      ...source.slides[2],
      elements: [
        {
          kind: 'image', id: 999, x: 0, y: 0, w: 20, h: 20, rot: 0, flipH: false, flipV: false,
          src: 'https://invalid.example/first.png', crop: null,
        },
        {
          kind: 'image', id: 1000, x: 20, y: 0, w: 20, h: 20, rot: 0, flipH: false, flipV: false,
          src: 'https://invalid.example/delayed.png', crop: null,
        },
      ],
    };
    let delayedSettled = false;
    globalThis.fetch = async (url) => {
      if (String(url).includes('delayed')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        delayedSettled = true;
        throw new Error('delayed CORS denied');
      }
      throw new Error('first CORS denied');
    };
    let resourceFailure;
    try {
      await imageZip.presentationToImageZip({ ...source, slides: [resourcePage] }, { scale: 1 });
    } catch (error) {
      resourceFailure = error;
    }
    check('批量资源内联失败按页原子拒绝', resourceFailure?.slideNumber === 1
      && resourceFailure?.fileName === 'slide-001.png' && /first CORS denied/.test(resourceFailure.message)
      && delayedSettled);
  } finally {
    globalThis.Image = realImage;
    globalThis.fetch = realFetch;
    globalThis.FileReader = realFileReader;
    realDocument.createElement = realCreate;
  }
}
