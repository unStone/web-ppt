import type { SlideElement } from '@web-ppt/core';
import { groupDuration, videoPlan } from './timing';

export interface VideoAudioClip {
  startMs: number;
  /** 首版固定页起点；音量/循环/裁切未建模时保持 1。 */
  volume: number;
  /** PCM WAV 地址；与 buffer 二选一。 */
  src?: string;
  /** 已解码缓冲（如 MP4 内 AAC）；与 src 二选一。 */
  buffer?: AudioBuffer;
}

export type VideoPlan = ReturnType<typeof videoPlan>;

function visit(elements: readonly SlideElement[], fn: (el: SlideElement) => void): void {
  for (const el of elements) {
    fn(el);
    if (el.kind === 'group') visit(el.children, fn);
  }
}

/** 与 videoPlan 同一时间基准：切页动画结束后、本页内容开始时挂上本页音频。 */
export function videoAudioPlan(plan: VideoPlan): { clips: VideoAudioClip[]; durationMs: number; hasVideoMedia: boolean } {
  let ms = 0;
  const clips: VideoAudioClip[] = [];
  let hasVideoMedia = false;
  for (const page of plan.pages) {
    if (page.transition) ms += page.transition;
    const startMs = ms;
    visit(page.slide.elements, el => {
      if (el.kind !== 'image' || !el.media?.src) return;
      // 画面合成见 media.ts；此处只标记存在视频媒体，供旧调用方探测。
      if (el.media.kind === 'video') { hasVideoMedia = true; return; }
      if (el.media.kind !== 'audio') return;
      const mime = el.media.mime ?? '';
      if (mime !== 'audio/wav' && mime !== 'audio/x-wav') {
        throw new Error(`视频音轨暂不支持编码：${mime || 'unknown'}；当前仅 PCM WAV`);
      }
      clips.push({ src: el.media.src, startMs, volume: 1 });
    });
    for (const group of page.groups) {
      if (page.click) ms += page.click;
      ms += groupDuration(group);
    }
    ms += page.hold;
  }
  return { clips, durationMs: ms, hasVideoMedia };
}

/** 只接受 PCM WAV；压缩 WAV / 非 1 或 2 声道明确拒绝。 */
export function decodeWavPcm(bytes: Uint8Array): { sampleRate: number; channels: number; samples: Float32Array[] } {
  if (bytes.length < 44) throw new Error('WAV 文件过短');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('不是 RIFF/WAVE');
  let offset = 12, format: number | undefined, channels = 0, sampleRate = 0, bits = 0, data: Uint8Array | undefined;
  while (offset + 8 <= bytes.length) {
    const id = text(offset, 4), size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') data = bytes.subarray(body, body + size);
    offset = body + size + (size & 1);
  }
  if (format !== 1) throw new Error('视频音轨仅支持 PCM WAV');
  if (![1, 2].includes(channels) || ![8, 16].includes(bits) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error('WAV 声道、位深或采样率超出支持范围');
  }
  if (!data) throw new Error('WAV 缺少 data 块');
  const frame = channels * (bits / 8);
  if (data.length % frame) throw new Error('WAV PCM 帧尺寸不一致');
  const frames = data.length / frame;
  const samples = Array.from({ length: channels }, () => new Float32Array(frames));
  const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const at = i * frame + c * (bits / 8);
      samples[c][i] = bits === 8 ? (data[at] - 128) / 128 : pcm.getInt16(at, true) / 32768;
    }
  }
  return { sampleRate, channels, samples };
}

async function readClip(src: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`音频资源读取失败：${response.status}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > 32 * 1024 * 1024) throw new Error('单个音频超过 32 MiB 上限');
  return buffer;
}

/** OfflineAudioContext 混出与视频等长的单声道 48 kHz PCM。 */
export async function mixVideoAudio(
  plan: VideoPlan,
  clips: readonly VideoAudioClip[],
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('当前环境不支持离线音频混音');
  const sampleRate = 48000;
  const length = Math.max(1, Math.ceil(plan.total / plan.fps * sampleRate));
  if (length > sampleRate * 3600) throw new Error('混音时长超过一小时');
  const context = new OfflineAudioContext(1, length, sampleRate);
  for (const clip of clips) {
    if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
    let buffer: AudioBuffer;
    if (clip.buffer) {
      buffer = clip.buffer;
    } else if (clip.src) {
      const decoded = decodeWavPcm(await readClip(clip.src, signal));
      buffer = context.createBuffer(decoded.channels, decoded.samples[0].length, decoded.sampleRate);
      for (let c = 0; c < decoded.channels; c++) buffer.copyToChannel(new Float32Array(decoded.samples[c]), c);
    } else {
      throw new Error('音轨片段缺少 src 或 buffer');
    }
    const mono = context.createBuffer(1, buffer.length, buffer.sampleRate);
    const dst = mono.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) {
      let sample = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++) sample += buffer.getChannelData(c)[i];
      dst[i] = (sample / buffer.numberOfChannels) * clip.volume;
    }
    const source = context.createBufferSource();
    source.buffer = mono;
    source.connect(context.destination);
    source.start(clip.startMs / 1000);
  }
  const mixed = await context.startRendering();
  if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
  return mixed;
}

export interface EncodedAudioPacket {
  data: Uint8Array;
  timestamp: number;
  duration: number;
}

function opusHead(sampleRate: number, channels: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set([...'OpusHead'].map(c => c.charCodeAt(0)));
  head[8] = 1; head[9] = channels;
  new DataView(head.buffer).setUint16(10, 0, true);
  new DataView(head.buffer).setUint32(12, sampleRate, true);
  return head;
}

/** 检测 Opus AudioEncoder；失败时给出可定位原因，不假装有音轨。 */
export async function encodeOpusAudio(buffer: AudioBuffer, signal?: AbortSignal): Promise<{ packets: EncodedAudioPacket[]; codecPrivate: Uint8Array; sampleRate: number }> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    throw new Error('当前浏览器不支持 WebCodecs 音频编码');
  }
  const sampleRate = buffer.sampleRate, channels = 1;
  const config: AudioEncoderConfig = { codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 64000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) throw new Error('当前浏览器没有可用的 Opus 音频编码器');
  const packets: EncodedAudioPacket[] = [];
  let failure: unknown;
  const encoder = new AudioEncoder({
    output: chunk => {
      try {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        packets.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0 });
      } catch (error) { failure = error; }
    },
    error: error => { failure = error; },
  });
  const stop = () => { if (encoder.state !== 'closed') encoder.close(); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    encoder.configure(config);
    const frame = 960; // 20ms @ 48k
    const pcm = buffer.getChannelData(0);
    for (let at = 0; at < pcm.length; at += frame) {
      if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
      if (failure) throw failure;
      const samples = Math.min(frame, pcm.length - at);
      const data = new Float32Array(samples);
      data.set(pcm.subarray(at, at + samples));
      const audio = new AudioData({
        format: 'f32', sampleRate, numberOfFrames: samples, numberOfChannels: 1,
        timestamp: Math.round(at * 1000000 / sampleRate), data,
      });
      try { encoder.encode(audio); } finally { audio.close(); }
      if (encoder.encodeQueueSize > 16) {
        await new Promise<void>((resolve, reject) => {
          const ready = () => { if (encoder.encodeQueueSize <= 8 || failure) { encoder.removeEventListener('dequeue', ready); resolve(); } };
          encoder.addEventListener('dequeue', ready); ready();
          signal?.addEventListener('abort', () => reject(new DOMException('视频导出已取消', 'AbortError')), { once: true });
        });
      }
    }
    await encoder.flush();
    if (failure) throw failure;
    if (!packets.length) throw new Error('Opus 编码器未产出音频包');
    return { packets, codecPrivate: opusHead(sampleRate, channels), sampleRate };
  } finally {
    signal?.removeEventListener('abort', stop);
    stop();
  }
}
