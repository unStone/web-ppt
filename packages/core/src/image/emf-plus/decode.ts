import { emfToSvg, isEmf, record } from '../emf';
import type { MetafileOptions } from '../emf';
import { Gfx, n } from '../gdi';
import { Bytes } from './binary';
import { EmfPlus } from './renderer';

export interface EmfPlusResult {
  mode: 'absent' | 'emf-plus' | 'emf-fallback' | 'unsupported';
  svg: string | null;
  reason?: string;
}
/** 双格式只有完整 EMF 回退才可靠；禁止把已绘制的 EMF+ 前缀与整份 EMF 叠加。 */
export function decodeEmfPlus(bytes: Uint8Array, options: MetafileOptions = {}): EmfPlusResult {
  if (!isEmf(bytes)) return { mode: 'absent', svg: null };
  let plus: EmfPlus | undefined;
  try {
    const header = new Bytes(bytes); header.take(8);
    const l = header.i32(), t = header.i32(), right = header.i32(), bottom = header.i32();
    const frameL = header.i32(), frameT = header.i32(), frameR = header.i32(), frameB = header.i32(); header.take(32);
    const devW = header.i32(), devH = header.i32(), mmW = header.i32(), mmH = header.i32();
    const bounds = { x: l, y: t, w: Math.max(1, right - l + 1), h: Math.max(1, bottom - t + 1) };
    const vb = { l, t, r: l + bounds.w, b: t + bounds.h };
    const width = options.width ?? ((frameR - frameL) * 96 / 2540 || bounds.w), height = options.height ?? ((frameB - frameT) * 96 / 2540 || bounds.h);
    const classic = new Gfx({ pxPerMmX: mmW > 0 ? devW / mmW : 96 / 25.4, pxPerMmY: mmH > 0 ? devH / mmH : 96 / 25.4 });
    const output: string[] = []; let length = 0, drawn = '', classicDefs = '', count = 0;
    plus = new EmfPlus(bounds, svg => { length += svg.length; if (length > 32 * 1024 * 1024) throw new Error('EMF+ 输出超限'); output.push(svg); }, () => { output.length = 0; length = 0; });
    const stream = new Bytes(bytes);
    while (stream.left) {
      if (++count > 100000) throw new Error('EMF+ 记录超限');
      const base = stream.p, type = stream.u32(), size = stream.u32();
      if (size < 8 || size % 4) throw new Error('EMF 记录长度错误');
      const payload = stream.take(size - 8);
      if (type === 14) break;
      if (type === 70 && payload.length >= 8) {
        const comment = new Bytes(payload), data = new Bytes(comment.take(comment.u32()));
        if (data.u32() !== 0x2b464d45) continue;
        while (data.left) {
          const kind = data.u16(), flags = data.u16(), size = data.u32(), dataSize = data.u32();
          if (size < 12 || size % 4 || dataSize > size - 12) throw new Error('EMF+ 记录长度错误');
          const content = data.take(size - 12); plus.record(kind, flags, content.subarray(0, dataSize));
        }
      } else if (type !== 1 && plus.active && plus.getDC) {
        record(classic, bytes, type, base, size);
        const svg = classic.render(vb, width, height), inner = svg.slice(svg.indexOf('>') + 1, -6);
        classicDefs = inner.match(/^<defs>([\s\S]*?)<\/defs>/)?.[1] ?? '';
        const body = inner.replace(/^<defs>[\s\S]*?<\/defs>/, '');
        if (body.length > drawn.length) output.push(`<g${plus.state.clip ? ` clip-path="url(#${plus.state.clip})"` : ''}>${body.slice(drawn.length)}</g>`);
        drawn = body;
      }
    }
    if (!plus.active) return { mode: 'absent', svg: null };
    if (!plus.ended) throw new Error('EMF+ 缺少结束记录');
    return { mode: 'emf-plus', svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(width)}" height="${n(height)}" viewBox="${[l, t, bounds.w, bounds.h].map(n).join(' ')}"><defs>${classicDefs}${plus.defs.join('')}</defs>${output.join('')}</svg>` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (plus?.dual) return { mode: 'emf-fallback', svg: emfToSvg(bytes, options), reason };
    return { mode: 'unsupported', svg: null, reason };
  }
}
