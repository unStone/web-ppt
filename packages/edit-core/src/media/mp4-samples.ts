import { invalidMp4, mp4Box, mp4Uint, type Mp4Box } from './mp4-boxes';

export function assertMp4Range(start: number, size: number, mdats: readonly Mp4Box[]): void {
  // mdat 沿文件顺序排列；大量小 chunk 不能各自全表扫描。
  let low = 0, high = mdats.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (mdats[middle].data <= start) low = middle + 1;
    else high = middle;
  }
  const box = mdats[low - 1];
  if (size <= 0 || !box || start + size > box.end) invalidMp4();
}

function sampleSizes(bytes: Uint8Array, tables: readonly Mp4Box[]) {
  const choices = tables.filter((box) => box.type === 'stsz' || box.type === 'stz2');
  if (choices.length !== 1) invalidMp4();
  const box = choices[0], count = mp4Uint(bytes, box, 8);
  if (mp4Uint(bytes, box, 0) || count > bytes.length) invalidMp4();
  const fixed = box.type === 'stsz' ? mp4Uint(bytes, box, 4) : 0;
  const bits = box.type === 'stsz' ? 32 : mp4Uint(bytes, box, 7, 1);
  if (!(box.type === 'stsz' ? [32] : [4, 8, 16]).includes(bits)
    || box.end - box.data !== 12 + (fixed ? 0 : Math.ceil(count * bits / 8))) invalidMp4();
  return { count, fixed, size: (index: number): number => {
    if (index >= count) invalidMp4();
    if (fixed) return fixed;
    if (bits === 4) return (mp4Uint(bytes, box, 12 + Math.floor(index / 2), 1) >> (index % 2 ? 0 : 4)) & 15;
    return mp4Uint(bytes, box, 12 + index * bits / 8, bits / 8 as 1 | 2 | 4);
  } };
}

/** 样本地址必须由 stsc/stsz/stco 联合求出；只验证首个 chunk 会漏掉尾部截断和外部引用。 */
export function assertMp4Samples(
  bytes: Uint8Array, tables: readonly Mp4Box[], mdats: readonly Mp4Box[], descriptions: number,
): number {
  const sizes = sampleSizes(bytes, tables);
  const stts = mp4Box(tables, 'stts'), timingEntries = mp4Uint(bytes, stts, 4);
  if (mp4Uint(bytes, stts, 0) || stts.end - stts.data !== 8 + timingEntries * 8) invalidMp4();
  let timedSamples = 0;
  for (let row = 0; row < timingEntries; row++) {
    const count = mp4Uint(bytes, stts, 8 + row * 8);
    // 时间增量允许为零；不能把非负时长误收紧成正数。
    if (!count) invalidMp4();
    timedSamples += count;
  }
  if (timedSamples !== sizes.count) invalidMp4();
  const offsetBoxes = tables.filter((box) => box.type === 'stco' || box.type === 'co64');
  if (offsetBoxes.length !== 1) invalidMp4();
  const offsets = offsetBoxes[0], width = offsets.type === 'co64' ? 8 : 4;
  const chunks = mp4Uint(bytes, offsets, 4);
  if (mp4Uint(bytes, offsets, 0) || offsets.end - offsets.data !== 8 + chunks * width) invalidMp4();
  const stsc = mp4Box(tables, 'stsc'), entries = mp4Uint(bytes, stsc, 4);
  if (mp4Uint(bytes, stsc, 0) || stsc.end - stsc.data !== 8 + entries * 12) invalidMp4();
  if (!sizes.count) {
    if (chunks || entries) invalidMp4();
    return 0;
  }
  if (!chunks || !entries) invalidMp4();
  let entry = 0, sample = 0;
  const first = (row: number) => mp4Uint(bytes, stsc, 8 + row * 12);
  for (let row = 0; row < entries; row++) {
    const chunk = first(row), description = mp4Uint(bytes, stsc, 16 + row * 12);
    if ((row === 0 ? chunk !== 1 : chunk <= first(row - 1)) || chunk > chunks
      || !description || description > descriptions || !mp4Uint(bytes, stsc, 12 + row * 12)) invalidMp4();
  }
  for (let chunk = 1; chunk <= chunks; chunk++) {
    if (entry + 1 < entries && chunk === first(entry + 1)) entry++;
    const count = mp4Uint(bytes, stsc, 12 + entry * 12);
    if (count > sizes.count - sample) invalidMp4();
    let length = count * sizes.fixed;
    if (sizes.fixed) sample += count;
    for (let i = 0; !sizes.fixed && i < count; i++) {
      const size = sizes.size(sample++);
      if (!size) invalidMp4();
      length += size;
    }
    assertMp4Range(mp4Uint(bytes, offsets, 8 + (chunk - 1) * width, width), length, mdats);
  }
  if (sample !== sizes.count) invalidMp4();
  return sample;
}
