const bytes = (text: string) => new TextEncoder().encode(text);
function uint(n: number, size = Math.max(1, Math.ceil(Math.log2(n + 1) / 8))): Uint8Array {
  const result = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) { result[i] = n % 256; n = Math.floor(n / 256); }
  return result;
}
function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } return result;
}
function element(id: number, ...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  let size = 1; while (length >= 2 ** (7 * size) - 1) size++;
  const vint = uint(length, size); vint[0] |= 1 << (8 - size);
  return join([uint(id), vint, ...parts]);
}
const integer = (id: number, n: number) => element(id, uint(n));
const string = (id: number, value: string) => element(id, bytes(value));
function float(id: number, value: number) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, value); return element(id, b); }

/** WebM 的时间戳使用毫秒；帧的微秒时间来自编码器，与导出耗时无关。 */
export class WebmWriter {
  private clusters: { time: number; blocks: Uint8Array[]; key: boolean }[] = [];
  private last = -1;
  private duration = 0;
  private length = 0;
  private closed = false;
  constructor(private width: number, private height: number, private fps: number, private codec: 'VP8' | 'VP9') {
    if (![width, height, fps].every(n => Number.isInteger(n) && n > 0) || width * height > 8388608 || fps > 60) throw new Error('WebM 视频尺寸或帧率无效');
  }
  addFrame(data: Uint8Array, timestamp: number, duration: number, key: boolean): void {
    if (this.closed) throw new Error('WebM 已结束');
    if (!Number.isSafeInteger(timestamp) || timestamp <= this.last || timestamp < 0 || !Number.isSafeInteger(duration) || duration <= 0) throw new Error('WebM 帧时间必须严格递增');
    if (!data.length || data.length > 32 * 1024 * 1024 || this.length + data.length > 256 * 1024 * 1024) throw new Error('WebM 视频超过导出大小限制');
    if (!this.clusters.length && !key) throw new Error('WebM 第一帧必须是关键帧');
    const time = Math.round(timestamp / 1000);
    let cluster = this.clusters[this.clusters.length-1];
    if (!cluster || (key && time - cluster.time >= 1000) || time - cluster.time >= 30000) {
      cluster = { time, blocks: [], key }; this.clusters.push(cluster);
    }
    const header = new Uint8Array(4); header[0] = 0x81; new DataView(header.buffer).setInt16(1, time - cluster.time); header[3] = key ? 0x80 : 0;
    cluster.blocks.push(element(0xa3, header, data)); this.length += data.length;
    this.last = timestamp; this.duration = (timestamp + duration) / 1000;
  }
  finish(): Blob {
    if (this.closed) throw new Error('WebM 已结束');
    if (!this.clusters.length) throw new Error('没有可导出的视频帧');
    this.closed = true;
    const header = element(0x1a45dfa3, integer(0x4286,1),integer(0x42f7,1),integer(0x42f2,4),integer(0x42f3,8),string(0x4282,'webm'),integer(0x4287,4),integer(0x4285,2));
    const info = element(0x1549a966,integer(0x2ad7b1,1000000),float(0x4489,this.duration),string(0x4d80,'Web-PPT'),string(0x5741,'Web-PPT'));
    const tracks = element(0x1654ae6b,element(0xae,integer(0xd7,1),integer(0x73c5,1),integer(0x83,1),integer(0x9c,0),string(0x86,`V_${this.codec}`),integer(0x23e383,Math.round(1000000000/this.fps)),element(0xe0,integer(0xb0,this.width),integer(0xba,this.height))));
    const encoded: Uint8Array[] = [], cues: Uint8Array[] = []; let position = info.length + tracks.length;
    for (const cluster of this.clusters) {
      const output = element(0x1f43b675,integer(0xe7,cluster.time),...cluster.blocks);
      if (cluster.key) cues.push(element(0xbb,integer(0xb3,cluster.time),element(0xb7,integer(0xf7,1),integer(0xf1,position))));
      encoded.push(output); position += output.length;
    }
    const segment = element(0x18538067,info,tracks,...encoded,element(0x1c53bb6b,...cues));
    this.clusters.length = 0;
    return new Blob([header.buffer as ArrayBuffer, segment.buffer as ArrayBuffer], { type: 'video/webm' });
  }
}
