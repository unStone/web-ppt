import {serveFontWorker} from '@web-ppt/fonts/glyphs/worker';

serveFontWorker({
  postMessage: (message,transfer) => self.postMessage(message,{transfer}),
  addEventListener: (_type,listener) => self.addEventListener('message',listener),
  removeEventListener: (_type,listener) => self.removeEventListener('message',listener),
},{
  loadShaper: async () => {
    const [hb,{createHarfBuzzShaper}] = await Promise.all([import('harfbuzzjs'),import('@web-ppt/fonts/glyphs/harfbuzz')]);
    return createHarfBuzzShaper(hb);
  },
  decodeEot: async bytes => {
    const {eotToTtf} = await import('mtx-decompressor');
    return eotToTtf(bytes);
  },
});
