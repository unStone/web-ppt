import type {FontShaper,ShaperGlyph} from './types';
import {FontFault} from './fault';

interface BufferApi {
  addText(text: string): void;
  guessSegmentProperties(): void;
  setDirection(direction: number): void;
  setScript(script: string): void;
  setLanguage(language: string): void;
  getGlyphInfos(): Array<{codepoint: number; cluster: number}>;
  getGlyphPositions(): Array<{xAdvance: number; yAdvance: number; xOffset: number; yOffset: number}>;
}

/** hb 由宿主动态导入。本模块不下载 WASM，也不创建跨文稿单例。 */
export function createHarfBuzzShaper<B,F,T extends {glyphToPath(id: number): string},U extends BufferApi>(hb: {
  Blob: new(bytes: Uint8Array) => B;
  Face: new(blob: NoInfer<B>) => F;
  Font: new(face: NoInfer<F>) => T;
  Buffer: new() => U;
  Direction: {LTR: number};
  shape(font: T, buffer: U): void;
}): FontShaper {
  let closed = false;
  const cleanups = new Set<() => void>();
  return {
    async open(source,signal) {
      if (closed || signal.aborted) throw new FontFault('aborted');
      let font: T | undefined = new hb.Font(new hb.Face(new hb.Blob(source.bytes)));
      const dispose = () => { font = undefined; cleanups.delete(dispose); };
      cleanups.add(dispose);
      return {
        async shape(text,options) {
          if (!font || closed || options.signal?.aborted) throw new FontFault('aborted');
          const buffer = new hb.Buffer();
          buffer.addText(text); buffer.guessSegmentProperties();
          // Direction 是数值枚举；字符串 'ltr' 会被 WASM 当作无效方向。
          buffer.setDirection(hb.Direction.LTR); buffer.setScript(options.script); buffer.setLanguage(options.language);
          hb.shape(font,buffer);
          const infos = buffer.getGlyphInfos(), positions = buffer.getGlyphPositions();
          if (infos.length !== positions.length) throw new FontFault('shaper-failed');
          return infos.map((info,i): ShaperGlyph => ({id:info.codepoint,cluster:info.cluster,...positions[i]}));
        },
        async outline(id,options) {
          if (!font || closed || options.signal?.aborted) throw new FontFault('aborted');
          return font.glyphToPath(id);
        },
        dispose,
      };
    },
    dispose() {
      closed = true;
      for (const dispose of [...cleanups]) dispose();
      // 1.6.1 只有 FinalizationRegistry；确定释放 WASM 必须由宿主终止独占 Worker。
    },
  };
}
