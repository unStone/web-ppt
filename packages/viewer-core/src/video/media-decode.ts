import { demuxMp4Video, previousKeyIndex, sampleIndexAt, type Mp4VideoTrack } from './mp4-demux';

/** 有界解码：每次从关键帧解到目标样本并 flush；同一样本命中画布缓存，不把整片解进内存。 */
export class Mp4FrameSource {
  private cache = new Map<number, HTMLCanvasElement>();
  private failure: unknown;

  constructor(
    private bytes: Uint8Array,
    private track: Mp4VideoTrack,
  ) {}

  static async open(bytes: Uint8Array, signal?: AbortSignal): Promise<Mp4FrameSource> {
    if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') {
      throw new Error('当前浏览器不支持 WebCodecs 视频解码');
    }
    const track = demuxMp4Video(bytes);
    const config: VideoDecoderConfig = {
      codec: track.codec,
      description: track.description,
      codedWidth: track.width,
      codedHeight: track.height,
    };
    if (!(await VideoDecoder.isConfigSupported(config)).supported) {
      throw new Error(`当前浏览器无法解码内嵌视频：${track.codec}`);
    }
    if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
    return new Mp4FrameSource(bytes, track);
  }

  get durationUs(): number { return this.track.durationUs; }

  private async decodeIndex(index: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    const hit = this.cache.get(index);
    if (hit) return hit;
    // 缓存有界：固件很短；长视频只保留最近若干帧，防止按页长一次性囤满。
    if (this.cache.size >= 8) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    const holder: { frame: VideoFrame | null; pending: number } = { frame: null, pending: 0 };
    this.failure = undefined;
    const decoder = new VideoDecoder({
      output: frame => {
        holder.pending--;
        holder.frame?.close();
        holder.frame = frame;
      },
      error: error => { this.failure = error; },
    });
    try {
      decoder.configure({
        codec: this.track.codec,
        description: this.track.description,
        codedWidth: this.track.width,
        codedHeight: this.track.height,
      });
      const key = previousKeyIndex(this.track.samples, index);
      for (let i = key; i <= index; i++) {
        if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
        if (this.failure) throw this.failure;
        const sample = this.track.samples[i];
        // 拷贝出独立缓冲：subarray 视图在部分实现里会在 decode 异步期失效。
        const data = this.bytes.slice(sample.offset, sample.offset + sample.size);
        holder.pending++;
        decoder.decode(new EncodedVideoChunk({
          type: sample.key ? 'key' : 'delta',
          timestamp: sample.timestamp,
          duration: sample.duration,
          data,
        }));
        if (decoder.decodeQueueSize > 4) {
          await new Promise<void>((resolve, reject) => {
            const ready = () => {
              if (decoder.decodeQueueSize <= 2 || this.failure) {
                decoder.removeEventListener('dequeue', ready);
                resolve();
              }
            };
            decoder.addEventListener('dequeue', ready);
            ready();
            signal?.addEventListener('abort', () => reject(new DOMException('视频导出已取消', 'AbortError')), { once: true });
          });
        }
      }
      await decoder.flush();
      const start = Date.now();
      while (holder.pending > 0) {
        if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
        if (this.failure) throw this.failure;
        if (Date.now() - start > 10000) throw new Error('视频解码等待超时');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (this.failure) throw this.failure;
      const decoded = holder.frame;
      if (!decoded) throw new Error('视频解码未产出帧');
      const canvas = document.createElement('canvas');
      canvas.width = decoded.displayWidth || this.track.width;
      canvas.height = decoded.displayHeight || this.track.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建视频帧画布');
      ctx.drawImage(decoded, 0, 0);
      this.cache.set(index, canvas);
      return canvas;
    } finally {
      holder.frame?.close();
      if (decoder.state !== 'closed') decoder.close();
    }
  }

  async frameAt(timeUs: number, signal?: AbortSignal): Promise<CanvasImageSource | null> {
    const clamped = Math.max(0, Math.min(timeUs, Math.max(0, this.track.durationUs - 1)));
    return this.decodeIndex(sampleIndexAt(this.track.samples, clamped), signal);
  }

  close(): void {
    this.cache.clear();
  }
}
