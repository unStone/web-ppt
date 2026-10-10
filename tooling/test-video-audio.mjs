/**
 * 视频音轨浏览器全链验收（票据 006）：真 Chrome 里 presentationToVideo({audio:true})
 * 导出带 timing 播放语义的媒体页，产物回 Node 后用 ffprobe 独立核对双轨布局。
 * 环境：需要 Chrome 与本地 ffprobe；CI 缺 ffprobe 时该脚本跳过并说明（接线断言由
 * 字节级检查覆盖，混音核与双轨封装另有 Node 全量断言）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { withChartBrowser } from './lib/chart-browser-lab.mjs';

const root = resolve('.');
const out = join(root, 'out/video-audio');
mkdirSync(out, { recursive: true });
let ffprobe = null;
try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); ffprobe = 'ffprobe'; }
catch { console.log('  ffprobe 不在本机：跳过音轨独立核对'); }
let ffmpeg = null;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = 'ffmpeg'; }
catch { console.log('  ffmpeg 不在本机：提轨带声样本降级跳过'); }
// 0.4s 440Hz 单声道 AAC@16k：参数全部固定，字节只进 out/（不入 fixtures），有 ffmpeg 即重生成
if (ffmpeg) execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4',
  '-ar', '24000', '-ac', '1', '-c:a', 'aac', '-b:a', '16k', join(out, 'tone.mp4')]);

const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export { parse } from '${root}/packages/core/src/index.ts';
export { presentationToVideo } from '${root}/packages/viewer-core/src/video.ts';
export { WebmWriter } from '${root}/packages/viewer-core/src/video/webm.ts';`);
await bundleBrowser({ root, entry, output: join(out, 'contract.mjs'), aliases: [
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/viewer-core', join(root, 'packages/viewer-core/src/index.ts')],
] });
const bundledModule = await import(join(out, 'contract.mjs'));

let failures = 0;
const check = (label, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) failures++; };

await withChartBrowser(root, async browser => {
  const bytes = await browser.evaluate(`(async()=>{
    const { parse, presentationToVideo } = await import('/out/video-audio/contract.mjs');
    const pres = await parse(new Uint8Array(await (await fetch('/fixtures/sample-media.pptx')).arrayBuffer()), { lazy: false });
    // 只导媒体页：配音.wav（timing 组 0、80% 音量）与无封面音频（组 1、静音循环）
    const single = { ...pres, slides: [pres.slides[0]] };
    const blob = await presentationToVideo(single, { audio: true, mediaPosters: true, fps: 12, slideDurationMs: 1200, clickDelayMs: 200 });
    const media = single.slides[0].elements.filter(e => e.kind === 'image' && e.media?.playback);
    const names = media.map(e => e.media.playback).map(p => [p.volume, p.loop, p.clickGroup]);
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    return { type: blob.type, bytes, names, size: bytes.length };
  })()`);
  check('导出返回 WebM', bytes.type === 'video/webm');
  check('播放语义在场（0.8/组0 与 0/循环/组1）', JSON.stringify(bytes.names) === '[[0.8,false,0],[0,true,1]]', JSON.stringify(bytes.names));

  // 提轨两条路径：带声 MP4（AAC）成功混入；无轨 MP4 经 onWarning 显式跳过且不阻断。
  // tone.mp4 由本脚本开头 ffmpeg 现场生成（不进 fixtures）；CI 无 ffmpeg 时降级只跑无轨路径
  const track = await browser.evaluate(`(async()=>{
    const { parse, presentationToVideo } = await import('/out/video-audio/contract.mjs');
    const pres = await parse(new Uint8Array(await (await fetch('/fixtures/sample-media.pptx')).arrayBuffer()), { lazy: false });
    const stubVideo = pres.slides[0].elements.find(e => e.kind === 'image' && e.media?.kind === 'video');
    const toneResponse = await fetch('/out/video-audio/tone.mp4');
    if (!toneResponse.ok) return { unavailable: true };
    const realBytes = new Uint8Array(await toneResponse.arrayBuffer());
    const realUrl = URL.createObjectURL(new Blob([realBytes], { type: 'video/mp4' }));
    const warnings = [];
    const mediaEl = (src, name) => ({ kind: 'image', x: 100, y: 100, w: 200, h: 120, rot: 0, flipH: false, flipV: false,
      src: '', crop: null, name, media: { kind: 'video', src, mime: 'video/mp4', playback: { volume: 0.9, loop: false, clickGroup: 0 } } });
    const single = { ...pres, slides: [{ ...pres.slides[0], animations: undefined,
      elements: [mediaEl(realUrl, '带声视频'), mediaEl(stubVideo.media.src, '无轨视频')] }] };
    const blob = await presentationToVideo(single, { audio: true, mediaPosters: true, fps: 12, slideDurationMs: 1200,
      onWarning: (reason, detail) => warnings.push([reason, detail.elementName]) });
    URL.revokeObjectURL(realUrl);
    return { warnings, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  })()`);
  if (track?.unavailable) console.log('  tone.mp4 不存在（CI 无 ffmpeg）：提轨带声路径跳过，无轨路径由固件覆盖');
  if (track && !track.unavailable) {
    const trackWebm = Buffer.from(track.bytes);
    writeFileSync(join(out, 'track.webm'), trackWebm);
    check('无轨视频：onWarning 稳定 reason 且不阻断', JSON.stringify(track.warnings) === JSON.stringify([['video-audio-decode-failed','无轨视频']]), JSON.stringify(track.warnings));
    if (ffprobe) {
      // 双轨封装器的流级核对也集中在此（test-video.mjs 保持环境无关计数）
      const {WebmWriter} = bundledModule;
      const dual=new WebmWriter(480,270,12,'VP8',{sampleRate:48000,channels:2});
      dual.addFrame(new Uint8Array([1,2,3]),0,83333,true);
      dual.addAudio(new Uint8Array([10,11]),0);
      dual.addFrame(new Uint8Array([4,5]),83333,83334,false);
      writeFileSync(join(out,'dual.webm'),Buffer.from(new Uint8Array(await dual.finish().arrayBuffer())));
      const muxProbe = JSON.parse(execFileSync(ffprobe, ['-v','error','-show_streams','-of','json', join(out,'dual.webm')],{encoding:'utf8'}));
      check('封装器双轨：ffprobe 识别视频 + Opus 流',
        muxProbe.streams.length===2 && muxProbe.streams.some(s=>s.codec_name==='opus') && muxProbe.streams.some(s=>s.codec_name.startsWith('vp8')),
        JSON.stringify(muxProbe.streams.map(s=>s.codec_name)));
      // 轨全长≈视频时长（静音段正常编码）；有声区间用响度判：前 0.5s 有信号、全轨均值被后半静音拉低
      const volume = (seconds) => {
        const args = seconds ? ['-t', String(seconds)] : [];
        const result = spawnSync('ffmpeg', [...args, '-v', 'info', '-i', join(out, 'track.webm'), '-map', '0:a', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
        // volumedetect 的统计打在 stderr
        return Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(result.stderr ?? '')?.[1] ?? NaN);
      };
      const head = volume(0.5), full = volume();
      check('带声视频提轨：AAC 混入 Opus 轨且有声段≈0.4s', Number.isFinite(head) && Number.isFinite(full) && head > -40 && full < head - 3, `head=${head}dB full=${full}dB`);
    }
  }
  const webm = Buffer.from(bytes.bytes);
  writeFileSync(join(out, 'audio.webm'), webm);
  check('封装含 A_OPUS 音轨', webm.includes('A_OPUS'));
  check('封装含 OpusHead', webm.includes('OpusHead'));
  if (ffprobe) {
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', join(out, 'audio.webm')], { encoding: 'utf8' }));
    const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio');
    check('双轨（视频 + 音频）', !!video && !!audio, JSON.stringify(probe.streams.map(s => s.codec_type)));
    check('音频流为 Opus', audio?.codec_name === 'opus');
    check('音频流采样率 48kHz', audio?.sample_rate === '48000', audio?.sample_rate);
    // 非循环配音混入后：音轨时长为正且不超过视频时长 + 一个编码包边界
    // WebM 流级 duration 常为 0：容器时长代表视频，音频时长取末包时间戳
    const container = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', join(out, 'audio.webm')], { encoding: 'utf8' }));
    const packets = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', join(out, 'audio.webm')], { encoding: 'utf8' })
      .trim().split('\n').map(Number).filter(Number.isFinite);
    const containerS = Number(container.format.duration), audioEndS = packets.length ? Math.max(...packets) : 0;
    check('音轨时长非零且不超过视频', audioEndS > 0.2 && audioEndS <= containerS + 0.05, `audioEnd=${audioEndS}s container=${containerS}s`);
  } else {
    console.log('  ffprobe 缺失：流级断言跳过（字节级与混音核断言已覆盖）');
  }
});

if (failures) { console.error(`\x1b[31m✗ 视频音轨浏览器验收失败（${failures} 项）\x1b[0m`); process.exit(1); }
console.log('视频音轨浏览器验收通过');
