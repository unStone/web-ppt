import {invalidFont,resourceLimit} from './fault';
import type {FontValidationPause} from './validation-budget';

/** 校验压缩标志和组件图；不执行 TrueType 指令，也不在这里计算轮廓。 */
export async function validateGlyphData(view: DataView, glyfStart: number, offsets: Uint32Array, pause: FontValidationPause): Promise<void> {
  const count = offsets.length - 1;
  const children: number[][] = Array.from({length:count},() => []);
  for (let glyph = 0; glyph < count; glyph++) {
    const wait = pause(); if (wait) await wait;
    const start = glyfStart + offsets[glyph], end = glyfStart + offsets[glyph + 1];
    if (start === end) continue;
    let cursor = start + 10;
    const need = (size: number) => { if (cursor + size > end) invalidFont(); };
    const word = () => { need(2); const value = view.getUint16(cursor); cursor += 2; return value; };
    const byte = () => { need(1); return view.getUint8(cursor++); };
    const contours = view.getInt16(start);
    if (view.getInt16(start + 2) > view.getInt16(start + 6) || view.getInt16(start + 4) > view.getInt16(start + 8)) invalidFont();
    if (contours >= 0) {
      let previous = -1;
      for (let contour = 0; contour < contours; contour++) {
        const point = word(); if (point <= previous) invalidFont(); previous = point;
      }
      // 零轮廓可以只有十字节头，也可以带操作 phantom points 的指令。
      if (!contours && cursor === end) continue;
      const instructions = word(); need(instructions); cursor += instructions;
      const points = previous + 1;
      let coordinateBytes = 0;
      for (let point = 0; point < points;) {
        const flags = byte(), repeats = flags & 8 ? byte() + 1 : 1;
        if (flags & 0x80 || point + repeats > points) invalidFont();
        coordinateBytes += repeats * ((flags & 2 ? 1 : flags & 16 ? 0 : 2) + (flags & 4 ? 1 : flags & 32 ? 0 : 2));
        point += repeats;
      }
      need(coordinateBytes);
    } else {
      let more = true, instructions = false;
      while (more) {
        const flags = word(), child = word();
        if (child >= count || flags & 0xe010 || ((flags & 0x1800) === 0x1800) ||
            (!children[glyph].length && !(flags & 2))) invalidFont();
        const transforms = [8,64,128].filter(flag => flags & flag);
        if (transforms.length > 1) invalidFont();
        const size = (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 64 ? 4 : flags & 128 ? 8 : 0);
        need(size); cursor += size;
        children[glyph].push(child);
        if (children[glyph].length > 4096) resourceLimit();
        instructions ||= !!(flags & 256); more = !!(flags & 32);
      }
      if (instructions) { const length = word(); need(length); }
    }
  }
  const state = new Uint8Array(count), depths = new Uint8Array(count), expanded = new Uint32Array(count);
  const visit = (glyph: number, stack: number): void => {
    if (state[glyph] === 1) invalidFont();
    if (stack > 32) resourceLimit();
    if (state[glyph] === 2) return;
    state[glyph] = 1;
    let depth = 0, total = 1;
    for (const child of children[glyph]) {
      visit(child,stack + 1); depth = Math.max(depth,depths[child] + 1); total += expanded[child];
      if (depth > 32 || total > 16384) resourceLimit();
    }
    depths[glyph] = depth; expanded[glyph] = total; state[glyph] = 2;
  };
  for (let glyph = 0; glyph < count; glyph++) {
    const wait = pause(); if (wait) await wait;
    visit(glyph,0);
  }
}
