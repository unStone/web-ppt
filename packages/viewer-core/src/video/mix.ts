/**
 * 确定性 PCM 混音核：把按时间轴排布的已解码音频片段混成一条交错浮点轨。
 *
 * 视频导出的时间轴是离线推进的（帧时间戳由 videoPlan 决定，不受实际耗时影响），
 * 音轨必须同一性质——这里不做任何实时 API（OfflineAudioContext 的调度语义与
 * 编解码图都不需要），只用纯函数计算：每输出样本是各片段在对应时刻取值的
 * 加权和，重采样用确定性线性插值。解码（WAV 直读 / decodeAudioData）属于
 * 接线层，本模块只吃浮点样本。
 */

export interface AudioClip {
  /** 已解码的交错样本，取值 [-1,1]；声道数由 channels 声明 */
  samples: Float32Array;
  /** 片段采样率，正整数；与输出不一致时按线性插值重采样 */
  sampleRate: number;
  /** 片段声道数，只接受 1 或 2 */
  channels: number;
  /** 时间轴上的起始毫秒（由页序播放时机换算，>= 0） */
  startMs: number;
  /** 播放截止毫秒（相对时间轴原点）；缺省为片段自然结束，循环时默认播到轴尾 */
  endMs?: number;
  loop?: boolean;
  /** [0,1]；0 即静音（仍参与求和，语义与浏览器媒体元素一致） */
  volume?: number;
}

export interface MixOptions {
  /** 输出采样率，默认 48000（Opus 编码标准速率） */
  sampleRate?: number;
  /** 输出声道数，默认 2 */
  channels?: number;
}

/** 片段在时间轴上的取值：非循环越界返回 null（自然结束 / 截切），循环取模 */
function sampleAt(clip: AudioClip, frame: number, channel: number): number | null {
  const frames = clip.samples.length / clip.channels;
  if (!Number.isInteger(frames)) return null;
  let index = frame;
  if (clip.loop) index %= frames;
  else if (frame < 0 || frame >= frames) return null;
  const base = Math.floor(index), frac = index - base;
  const next = Math.min(base + 1, frames - 1);
  const a = clip.samples[base * clip.channels + channel];
  const b = clip.samples[next * clip.channels + channel];
  return a + (b - a) * frac;
}

export function mixAudioClips(clips: readonly AudioClip[], totalMs: number, options: MixOptions = {}): Float32Array {
  const rate = options.sampleRate ?? 48000, outChannels = options.channels ?? 2;
  if (!Number.isFinite(totalMs) || totalMs < 0) throw new Error('混音总时长必须是非负毫秒');
  if (!Number.isInteger(rate) || rate <= 0) throw new Error('输出采样率必须是正整数');
  if (clips.some(c => !Number.isInteger(c.sampleRate) || c.sampleRate <= 0)) throw new Error('片段采样率必须是正整数');
  if (clips.some(c => c.channels !== 1 && c.channels !== 2)) throw new Error('片段声道数只支持单声道或立体声');
  if (clips.some(c => !Number.isFinite(c.startMs) || c.startMs < 0)) throw new Error('片段起始时间必须是非负毫秒');
  if (clips.some(c => c.samples.length % c.channels !== 0)) throw new Error('片段样本长度必须是声道数的整数倍');
  const volume = clips.map(c => c.volume ?? 1);
  if (volume.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('片段音量必须在 [0,1]');
  const outFrames = Math.ceil((totalMs / 1000) * rate);
  const out = new Float32Array(outFrames * outChannels);
  for (const [index,clip] of clips.entries()) {
    if (clip.endMs !== undefined && clip.endMs < clip.startMs) throw new Error('片段截止时间早于起始时间');
    const end = clip.endMs ?? Number.POSITIVE_INFINITY;
    const firstFrame = Math.floor((clip.startMs / 1000) * rate);
    for (let frame = Math.max(firstFrame, 0); frame < outFrames; frame++) {
      if (frame / rate * 1000 >= end) break;
      // 输出帧对应片段内的源帧位置（时间换算含重采样）
      const source = (frame - (clip.startMs / 1000) * rate) * clip.sampleRate / rate;
      for (let channel = 0; channel < outChannels; channel++) {
        const value = sampleAt(clip, source, clip.channels === 1 ? 0 : channel);
        if (value === null) continue;
        out[frame * outChannels + channel] += value * volume[index];
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}
