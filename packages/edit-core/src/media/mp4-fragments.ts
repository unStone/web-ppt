import { invalidMp4, mp4Box, mp4Boxes, mp4Uint, type Mp4Box } from './mp4-boxes';
import { assertMp4Range } from './mp4-samples';

export interface Mp4Track { descriptions: number; samples: number; video: boolean }

/** 分片地址以 tfhd 为基准，trun 再叠加有符号偏移；不能把它当成 stco 绝对地址。 */
export function assertMp4Fragments(
  bytes: Uint8Array, boxes: readonly Mp4Box[], movie: readonly Mp4Box[], tracks: Map<number, Mp4Track>,
): void {
  const fragments = boxes.filter((box) => box.type === 'moof');
  if (!fragments.length) return;
  const mvex = mp4Box(movie, 'mvex');
  const defaults = new Map<number, { description: number; size: number }>();
  for (const trex of mp4Boxes(bytes, mvex.data, mvex.end).filter((box) => box.type === 'trex')) {
    const id = mp4Uint(bytes, trex, 4), description = mp4Uint(bytes, trex, 8);
    if (trex.end - trex.data !== 24 || mp4Uint(bytes, trex, 0) || defaults.has(id)
      || !tracks.has(id) || !description || description > tracks.get(id)!.descriptions) invalidMp4();
    defaults.set(id, { description, size: mp4Uint(bytes, trex, 16) });
  }
  const mdats = boxes.filter((box) => box.type === 'mdat');
  for (const moof of fragments) {
    let previousEnd = moof.start;
    const trafs = mp4Boxes(bytes, moof.data, moof.end).filter((box) => box.type === 'traf');
    if (!trafs.length) invalidMp4();
    for (const traf of trafs) {
      const children = mp4Boxes(bytes, traf.data, traf.end), tfhd = mp4Box(children, 'tfhd');
      const flags = mp4Uint(bytes, tfhd, 0), id = mp4Uint(bytes, tfhd, 4);
      if (flags & ~0x03003b || !tracks.has(id) || !defaults.has(id)) invalidMp4();
      const track = tracks.get(id)!, base = defaults.get(id)!;
      let cursor = 8;
      const read = (size: 4 | 8 = 4) => { const value = mp4Uint(bytes, tfhd, cursor, size); cursor += size; return value; };
      const address = flags & 1 ? read(8) : flags & 0x020000 ? moof.start : previousEnd;
      const description = flags & 2 ? read() : base.description;
      if (flags & 8) read();
      const sampleSize = flags & 16 ? read() : base.size;
      if (flags & 32) read();
      if (tfhd.end - tfhd.data !== cursor || !description || description > track.descriptions) invalidMp4();
      const runs = children.filter((box) => box.type === 'trun');
      let end = address, total = 0;
      for (const run of runs) {
        const full = mp4Uint(bytes, run, 0), version = full >>> 24, mask = full & 0xffffff;
        const count = mp4Uint(bytes, run, 4);
        if (version > 1 || mask & ~0x000f05 || count > bytes.length || (mask & 4 && mask & 0x400)) invalidMp4();
        let at = 8;
        const next = () => { const value = mp4Uint(bytes, run, at); at += 4; return value; };
        if (mask & 1) { const offset = next(); end = address + (offset > 0x7fffffff ? offset - 2 ** 32 : offset); }
        if (mask & 4) next();
        const stride = [0x100, 0x200, 0x400, 0x800].filter((flag) => mask & flag).length * 4;
        if (run.end - run.data !== at + count * stride) invalidMp4();
        // 没有逐样本字段时，工作量只应取决于 box 字节数，不能取决于声明的样本数量。
        let length = stride ? 0 : count * sampleSize;
        if (!stride && count && !sampleSize) invalidMp4();
        for (let sample = 0; stride && sample < count; sample++) {
          if (mask & 0x100) next();
          const size = mask & 0x200 ? next() : sampleSize;
          if (!size) invalidMp4();
          if (mask & 0x400) next();
          if (mask & 0x800) next();
          length += size;
        }
        if (count) assertMp4Range(end, length, mdats);
        end += length;
        total += count;
      }
      if (!runs.length && !(flags & 0x010000) || total && flags & 0x010000) invalidMp4();
      track.samples += total;
      previousEnd = end;
    }
  }
}
