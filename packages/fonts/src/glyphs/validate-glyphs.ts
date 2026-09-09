import type {SfntFont} from './sfnt';
import {validateGlyphData} from './glyph-data';
import type {FontValidationPause} from './validation-budget';

export async function validateGlyphStorage(bytes: Uint8Array, font: SfntFont, pause: FontValidationPause): Promise<void> {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const {tables,info} = font;
  const head = tables.get('head')!, loca = tables.get('loca')!, glyf = tables.get('glyf')!;
  const hhea = tables.get('hhea')!, hmtx = tables.get('hmtx')!;
  const format = view.getInt16(head.offset + 50), width = format === 0 ? 2 : 4;
  const metrics = view.getUint16(hhea.offset + 34);
  if (![0,1].includes(format) || loca.length < (info.glyphCount + 1) * width ||
      !metrics || metrics > info.glyphCount || hmtx.length < metrics * 4 + (info.glyphCount - metrics) * 2) {
    throw new Error('invalid-font');
  }
  let previous = 0;
  const offsets = new Uint32Array(info.glyphCount + 1);
  for (let i = 0; i <= info.glyphCount; i++) {
    const offset = width === 2 ? view.getUint16(loca.offset + i * 2) * 2 : view.getUint32(loca.offset + i * 4);
    if (offset < previous || offset > glyf.length || (i > 0 && offset !== previous && offset - previous < 10)) {
      throw new Error('invalid-font');
    }
    previous = offsets[i] = offset;
  }
  await validateGlyphData(view,glyf.offset,offsets,pause);
}
