/** 仅 progressive H.264：为 VideoDecoder 抽出样本，不一次解码到内存。 */

export interface Mp4Sample {
  offset: number;
  size: number;
  /** 展示时间（微秒） */
  timestamp: number;
  duration: number;
  key: boolean;
}

export interface Mp4VideoTrack {
  codec: string;
  description: Uint8Array;
  width: number;
  height: number;
  samples: Mp4Sample[];
  durationUs: number;
}

interface Box { type: string; start: number; data: number; end: number }

function fail(message = '内嵌视频不是可合成的 progressive H.264 MP4'): never {
  throw new Error(message);
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at < end) {
    if (end - at < 8 || out.length >= 100000) fail();
    let size = u32(bytes, at), header = 8;
    if (size === 1) {
      if (end - at < 16) fail();
      size = u32(bytes, at + 8) * 2 ** 32 + u32(bytes, at + 12);
      header = 16;
    } else if (!size) size = end - at;
    if (!Number.isSafeInteger(size) || size < header || size > end - at) fail();
    out.push({ type: tag(bytes, at + 4), start: at, data: at + header, end: at + size });
    at += size;
  }
  return out;
}

function one(list: readonly Box[], type: string): Box {
  const found = list.filter(b => b.type === type);
  if (found.length !== 1) fail();
  return found[0];
}

function readAvcC(bytes: Uint8Array, stsd: Box): { codec: string; description: Uint8Array; width: number; height: number } {
  const entries = boxes(bytes, stsd.data + 8, stsd.end);
  if (u32(bytes, stsd.data) || !entries.length || entries.length !== u32(bytes, stsd.data + 4)) fail();
  const visual = entries.find(e => e.type === 'avc1' || e.type === 'avc3');
  if (!visual || visual.end - visual.data < 78) fail('内嵌视频编码不是 H.264（avc1）');
  const width = (bytes[visual.data + 24] << 8) | bytes[visual.data + 25];
  const height = (bytes[visual.data + 26] << 8) | bytes[visual.data + 27];
  if (!width || !height) fail();
  // VisualSampleEntry 固定 78 字节头，其后才是 avcC 等扩展。
  const avcC = boxes(bytes, visual.data + 78, visual.end).find(b => b.type === 'avcC');
  if (!avcC || avcC.end - avcC.data < 7) fail('缺少 avcC 解码描述');
  const description = bytes.slice(avcC.data, avcC.end);
  const codec = `avc1.${[description[1], description[2], description[3]].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return { codec, description, width, height };
}

function sampleTable(bytes: Uint8Array, tables: readonly Box[], timescale: number): Mp4Sample[] {
  const stsz = one(tables, 'stsz');
  const count = u32(bytes, stsz.data + 8);
  const fixed = u32(bytes, stsz.data + 4);
  if (u32(bytes, stsz.data) || count > bytes.length) fail();
  const sizeAt = (i: number) => fixed || u32(bytes, stsz.data + 12 + i * 4);
  if (stsz.end - stsz.data !== 12 + (fixed ? 0 : count * 4)) fail();

  const stts = one(tables, 'stts');
  const timingRows = u32(bytes, stts.data + 4);
  if (u32(bytes, stts.data) || stts.end - stts.data !== 8 + timingRows * 8) fail();
  const durations: number[] = [];
  for (let row = 0; row < timingRows; row++) {
    const n = u32(bytes, stts.data + 8 + row * 8);
    const delta = u32(bytes, stts.data + 12 + row * 8);
    if (!n) fail();
    for (let i = 0; i < n; i++) durations.push(delta);
  }
  if (durations.length !== count) fail();

  const offsetsBox = tables.find(b => b.type === 'stco') ?? tables.find(b => b.type === 'co64');
  if (!offsetsBox) fail();
  const width = offsetsBox.type === 'co64' ? 8 : 4;
  const chunks = u32(bytes, offsetsBox.data + 4);
  if (u32(bytes, offsetsBox.data) || offsetsBox.end - offsetsBox.data !== 8 + chunks * width) fail();
  const chunkOffset = (i: number) => width === 4
    ? u32(bytes, offsetsBox.data + 8 + i * 4)
    : u32(bytes, offsetsBox.data + 8 + i * 8) * 2 ** 32 + u32(bytes, offsetsBox.data + 12 + i * 8);

  const stsc = one(tables, 'stsc');
  const entries = u32(bytes, stsc.data + 4);
  if (u32(bytes, stsc.data) || stsc.end - stsc.data !== 8 + entries * 12 || !entries) fail();
  const firstChunk = (row: number) => u32(bytes, stsc.data + 8 + row * 12);
  const samplesPerChunk = (row: number) => u32(bytes, stsc.data + 12 + row * 12);

  const keys = new Set<number>();
  const stss = tables.find(b => b.type === 'stss');
  if (stss) {
    const n = u32(bytes, stss.data + 4);
    if (u32(bytes, stss.data) || stss.end - stss.data !== 8 + n * 4) fail();
    for (let i = 0; i < n; i++) keys.add(u32(bytes, stss.data + 8 + i * 4) - 1);
  } else {
    for (let i = 0; i < count; i++) keys.add(i);
  }

  // ctts 可选；缺省时 DTS=CTS。
  const ctts = tables.find(b => b.type === 'ctts');
  const ctsOffset: number[] = Array(count).fill(0);
  if (ctts) {
    const rows = u32(bytes, ctts.data + 4);
    const version = bytes[ctts.data];
    if ((ctts.data + 8 + rows * 8) > ctts.end) fail();
    let at = 0;
    for (let row = 0; row < rows; row++) {
      const n = u32(bytes, ctts.data + 8 + row * 8);
      let off = u32(bytes, ctts.data + 12 + row * 8);
      if (version === 1 && off >= 0x80000000) off -= 0x100000000;
      for (let i = 0; i < n; i++) {
        if (at >= count) fail();
        ctsOffset[at++] = off;
      }
    }
    if (at !== count) fail();
  }

  const samples: Mp4Sample[] = [];
  let sample = 0, dts = 0, entry = 0;
  for (let chunk = 1; chunk <= chunks; chunk++) {
    if (entry + 1 < entries && chunk === firstChunk(entry + 1)) entry++;
    const n = samplesPerChunk(entry);
    let offset = chunkOffset(chunk - 1);
    for (let i = 0; i < n; i++) {
      if (sample >= count) fail();
      const size = sizeAt(sample);
      if (!size || offset + size > bytes.length) fail();
      const duration = Math.round(durations[sample] * 1e6 / timescale);
      samples.push({
        offset, size, duration,
        timestamp: Math.round((dts + ctsOffset[sample]) * 1e6 / timescale),
        key: keys.has(sample),
      });
      offset += size;
      dts += durations[sample];
      sample++;
    }
  }
  if (sample !== count || !samples.length) fail();
  return samples;
}

/** 解析 progressive MP4 的第一条 H.264 视频轨；分片/非 avc1 明确拒绝。 */
export function demuxMp4Video(bytes: Uint8Array): Mp4VideoTrack {
  if (bytes.byteLength > 64 * 1024 * 1024) fail('内嵌视频超过 64 MiB 上限');
  const top = boxes(bytes);
  if (top.some(b => b.type === 'moof' || b.type === 'mvex')) {
    fail('内嵌视频是分片 MP4，导出合成暂不支持');
  }
  const moov = one(top, 'moov');
  const movie = boxes(bytes, moov.data, moov.end);
  for (const trak of movie.filter(b => b.type === 'trak')) {
    const children = boxes(bytes, trak.data, trak.end);
    const mdia = one(children, 'mdia');
    const contents = boxes(bytes, mdia.data, mdia.end);
    const hdlr = one(contents, 'hdlr');
    if (tag(bytes, hdlr.data + 8) !== 'vide') continue;
    const mdhd = one(contents, 'mdhd');
    const version = bytes[mdhd.data];
    const timescale = u32(bytes, mdhd.data + (version === 1 ? 20 : 12));
    if (!timescale) fail();
    const minf = one(contents, 'minf');
    const stbl = one(boxes(bytes, minf.data, minf.end), 'stbl');
    const tables = boxes(bytes, stbl.data, stbl.end);
    const { codec, description, width, height } = readAvcC(bytes, one(tables, 'stsd'));
    const samples = sampleTable(bytes, tables, timescale);
    const last = samples[samples.length - 1];
    return {
      codec, description, width, height, samples,
      durationUs: last.timestamp + last.duration,
    };
  }
  fail('MP4 中没有可合成的视频轨');
}

/** 选中 timestamp 不超过目标的最后一帧；目标越界时夹到片尾。 */
export function sampleIndexAt(samples: readonly Mp4Sample[], timeUs: number): number {
  if (timeUs <= samples[0].timestamp) return 0;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (samples[mid].timestamp <= timeUs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function previousKeyIndex(samples: readonly Mp4Sample[], index: number): number {
  for (let i = Math.min(index, samples.length - 1); i >= 0; i--) if (samples[i].key) return i;
  return 0;
}
