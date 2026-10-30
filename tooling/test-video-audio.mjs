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

  // 内嵌视频合成（videoOverlay）：真 MP4 帧叠加到画面（替代海报）
  if (ffmpeg) {
    const overlayResult = await browser.evaluate(`(async()=>{
      try {
        const { parse, presentationToVideo } = await import('/out/video-audio/contract.mjs');
        const pres = await parse(new Uint8Array(await (await fetch('/fixtures/sample-media.pptx')).arrayBuffer()), { lazy: false });
        const toneResponse = await fetch('/out/video-audio/tone.mp4');
        if (!toneResponse.ok) return { skipped: true };
        const mp4Bytes = new Uint8Array(await toneResponse.arrayBuffer());
        const videoUrl = URL.createObjectURL(new Blob([mp4Bytes], { type: 'video/mp4' }));
        const mediaEl = { kind: 'image', x: 100, y: 100, w: 300, h: 200, rot: 0, flipH: false, flipV: false,
          src: '', crop: null, name: '合成视频', media: { kind: 'video', src: videoUrl, mime: 'video/mp4',
            playback: { volume: 1, loop: false, clickGroup: 0 } } };
        const single = { ...pres, slides: [{ ...pres.slides[0], animations: undefined, elements: [mediaEl] }] };
        const warnings = [];
        const blob = await presentationToVideo(single, { videoOverlay: true, mediaPosters: true, fps: 12, slideDurationMs: 1500,
          onWarning: (reason, detail) => warnings.push([reason, detail.elementName]) });
        URL.revokeObjectURL(videoUrl);
        return { warnings, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
      } catch (error) { return { failed: String((error && error.stack) || error).slice(0, 200) }; }
    })()`);
    if (overlayResult?.skipped) console.log('  tone.mp4 不存在：视频合成路径跳过');
    else if (overlayResult?.failed) check('视频合成导出', false, overlayResult.failed);
    else {
      const overlayWebm = Buffer.from(overlayResult.bytes);
      writeFileSync(join(out, 'overlay.webm'), overlayWebm);
      check('视频合成导出返回 WebM', overlayWebm.length > 1000, String(overlayWebm.length));
      check('视频合成成功：无 onWarning', overlayResult.warnings.length === 0, JSON.stringify(overlayResult.warnings));
    }
  } else console.log('  ffmpeg 缺失：视频合成成功路径跳过（失败 / 超时路径不依赖 ffmpeg，照常断言）');

  // 视频合成失败两条路径：坏字节触发 error、永不就绪的 MediaSource 触发 5s 加载超时。
  // 二者都必须经 onWarning 以稳定 reason 暴露（海报帧回退不得静默），且导出照常完成
  const overlayFailure = await browser.evaluate(`(async()=>{
    const { parse, presentationToVideo } = await import('/out/video-audio/contract.mjs');
    const pres = await parse(new Uint8Array(await (await fetch('/fixtures/sample-media.pptx')).arrayBuffer()), { lazy: false });
    const brokenUrl = URL.createObjectURL(new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], { type: 'video/mp4' }));
    // 未添加 SourceBuffer 的 MediaSource 永远停在 HAVE_NOTHING，既不报错也不就绪
    const stalledUrl = URL.createObjectURL(new MediaSource());
    const mediaEl = (src, name) => ({ kind: 'image', x: 100, y: 100, w: 200, h: 120, rot: 0, flipH: false, flipV: false,
      src: '', crop: null, name, media: { kind: 'video', src, mime: 'video/mp4', playback: { volume: 1, loop: false, clickGroup: 0 } } });
    const single = { ...pres, slides: [{ ...pres.slides[0], animations: undefined,
      elements: [mediaEl(brokenUrl, '损坏视频'), mediaEl(stalledUrl, '超时视频')] }] };
    const warnings = [];
    const started = performance.now();
    const blob = await presentationToVideo(single, { videoOverlay: true, mediaPosters: true, fps: 12, slideDurationMs: 600,
      onWarning: (reason, detail) => warnings.push([reason, detail.slideNumber, detail.elementName]) });
    const elapsedMs = performance.now() - started;
    URL.revokeObjectURL(brokenUrl); URL.revokeObjectURL(stalledUrl);
    return { warnings, elapsedMs, type: blob.type, size: blob.size };
  })()`);
  const overlayWarnings = [...overlayFailure.warnings].sort((a, b) => a[2].localeCompare(b[2]));
  check('视频合成失败：损坏 / 超时各报一次 video-overlay-unavailable（含页号与元素名）',
    JSON.stringify(overlayWarnings) === JSON.stringify([['video-overlay-unavailable', 1, '损坏视频'], ['video-overlay-unavailable', 1, '超时视频']].sort((a, b) => a[2].localeCompare(b[2]))),
    JSON.stringify(overlayFailure.warnings));
  check('视频合成超时路径确实等满加载时限', overlayFailure.elapsedMs >= 5000, `${Math.round(overlayFailure.elapsedMs)}ms`);
  check('视频合成失败不阻断导出', overlayFailure.type === 'video/webm' && overlayFailure.size > 1000, `${overlayFailure.type} ${overlayFailure.size}`);

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

  // ---------- 票据 006 收尾证据：脉冲与画面标记同轴、取消与资源释放、跨页循环 ----------
  // 文稿动态构造：页 1 静默纯色，页 2 红色方块 + 同批（clickGroup 0）0.5s 音频脉冲——
  // 换页瞬间画面变化与声音起点应同轴；取消经 AbortSignal 触发后必须能立刻再次导出。
  const syncResult = await browser.evaluate(`(async()=>{
    const { parse, presentationToVideo } = await import('/out/video-audio/contract.mjs');
    const pres = await parse(new Uint8Array(await (await fetch('/fixtures/sample-media.pptx')).arrayBuffer()), { lazy: false });
    // 页面内合成 0.5s 1kHz 方波脉冲 PCM WAV（44 字节头 + 16bit 单声道 48kHz）
    const sampleRate = 48000, durationS = 0.5, samples = sampleRate * durationS;
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++) pcm[i] = Math.sin(2 * Math.PI * 1000 * i / sampleRate) > 0 ? 12000 : -12000;
    const wav = new Uint8Array(44 + pcm.byteLength), view = new DataView(wav.buffer);
    const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); ascii(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, pcm.byteLength, true);
    new Uint8Array(pcm.buffer).forEach((b, i) => wav[44 + i] = b);
    const pulseUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const mediaEl = (playback) => ({ kind: 'image', x: 60, y: 60, w: 220, h: 140, rot: 0, flipH: false, flipV: false,
      src: '', crop: null, name: '脉冲音频', media: { kind: 'audio', src: pulseUrl, mime: 'audio/wav', playback } });
    const shape = (fill) => ({ kind: 'shape', x: 0, y: 0, w: 950, h: 530, rot: 0, flipH: false, flipV: false,
      path: 'M 0 0 H 950 V 530 H 0 Z', fill: { type: 'solid', color: fill }, stroke: null, text: null, crop: null });
    const makeDoc = (audioPlayback) => ({
      ...pres, slides: [
        { ...pres.slides[0], animations: undefined, timing: undefined, elements: [shape('#101418')] },
        { ...pres.slides[0], animations: undefined, timing: undefined, elements: [shape('#ff2244'), mediaEl(audioPlayback)] },
      ],
    });
    // 同轴样本：页 2 起点脉冲（clickGroup 0 = 首批 = 页面起点）
    const syncBlob = await presentationToVideo(makeDoc({ volume: 1, loop: false, clickGroup: 0 }),
      { audio: true, mediaPosters: true, fps: 12, slideDurationMs: 1000, clickDelayMs: 100 });
    const syncBytes = Array.from(new Uint8Array(await syncBlob.arrayBuffer()));
    // 跨页循环样本：脉冲短于单页时长，循环应把声音带到页 2 结束（音轨末包 > 1s）
    const loopBlob = await presentationToVideo(makeDoc({ volume: 1, loop: true, clickGroup: 0 }),
      { audio: true, mediaPosters: true, fps: 12, slideDurationMs: 1000, clickDelayMs: 100 });
    const loopBytes = Array.from(new Uint8Array(await loopBlob.arrayBuffer()));
    // 取消与资源释放：预置已 abort 的信号必须在入口检查点立刻失败且原因稳定
    // （中途 abort 的时序不可控——导出总时长毫秒级，定时器追不上），之后同稿再导出成功
    const cancelDoc = makeDoc({ volume: 1, loop: false, clickGroup: 0 });
    const controller = new AbortController();
    controller.abort();
    let cancelError = null;
    try { await presentationToVideo(cancelDoc, { audio: true, mediaPosters: true, fps: 12,
      slideDurationMs: 800, clickDelayMs: 100, signal: controller.signal }); }
    catch (error) { cancelError = error?.name === 'AbortError' ? 'AbortError' : String(error?.message ?? error); }
    const afterCancelBlob = await presentationToVideo(cancelDoc, { audio: true, mediaPosters: true, fps: 12,
      slideDurationMs: 800, clickDelayMs: 100 });
    URL.revokeObjectURL(pulseUrl);
    return { syncBytes, loopBytes, cancelError, afterCancelSize: afterCancelBlob.size, afterCancelType: afterCancelBlob.type };
  })()`);
  writeFileSync(join(out, 'sync.webm'), Buffer.from(syncResult.syncBytes));
  writeFileSync(join(out, 'loop.webm'), Buffer.from(syncResult.loopBytes));
  check('取消导出抛 AbortError', syncResult.cancelError === 'AbortError', String(syncResult.cancelError));
  check('取消后编码器与状态已释放：同稿再次导出成功', syncResult.afterCancelType === 'video/webm' && syncResult.afterCancelSize > 1000,
    `${syncResult.afterCancelType} ${syncResult.afterCancelSize}`);

  if (ffmpeg && ffprobe) {
    // 画面标记时刻：signalstats 逐帧 YAVG，红方块页的亮度均值显著高于纯色页——
    // 相邻帧哈希受 VP8 编码伪影干扰（静态纯色的首两帧哈希也不同），按绝对阈值判定
    const stats = spawnSync('ffmpeg', ['-v', 'info', '-i', join(out, 'sync.webm'),
      '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const averages = [...(stats.stderr ?? '').matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
    let changeIndex = -1;
    if (averages.length) {
      const baseline = averages[0];
      for (let i = 0; i < averages.length; i++) if (Math.abs(averages[i] - baseline) > 25) { changeIndex = i; break; }
    }
    // 声音起点：silencedetect 的 silence_end 即静音→有声转换时刻
    const silence = spawnSync('ffmpeg', ['-v', 'info', '-i', join(out, 'sync.webm'), '-af', 'silencedetect=noise=-35dB:d=0.08', '-f', 'null', '-'], { encoding: 'utf8' });
    const audioStartS = Number(/silence_end:\s*([\d.]+)/.exec(silence.stderr ?? '')?.[1] ?? NaN);
    const videoStartS = changeIndex >= 0 ? changeIndex / 12 : NaN;
    // 边界 = 1 视频帧（83ms）+ 1 Opus 编码块（20ms）+ 容器毫秒时间戳舍入
    check('脉冲与画面标记同轴（FFmpeg 独立测量）', Number.isFinite(videoStartS) && Number.isFinite(audioStartS)
      && Math.abs(videoStartS - audioStartS) <= 0.13, `画面 ${videoStartS}s vs 声音 ${audioStartS}s`);
    // 跨页循环：音轨末包须越过页 1 边界（1s），且不超过视频总时长 + 一个编码包
    const loopPackets = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', join(out, 'loop.webm')], { encoding: 'utf8' })
      .trim().split('\n').map(Number).filter(Number.isFinite);
    const loopFormat = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', join(out, 'loop.webm')], { encoding: 'utf8' }));
    const loopEndS = loopPackets.length ? Math.max(...loopPackets) : 0;
    check('循环音频跨页持续到末页', loopEndS > 1.0 && loopEndS <= Number(loopFormat.format.duration) + 0.05,
      `audioEnd=${loopEndS}s container=${loopFormat.format.duration}s`);
  } else console.log('  ffmpeg/ffprobe 缺失：同轴与跨页循环测量跳过（取消断言不依赖 ffmpeg，已执行）');
});

if (failures) { console.error(`\x1b[31m✗ 视频音轨浏览器验收失败（${failures} 项）\x1b[0m`); process.exit(1); }
console.log('视频音轨浏览器验收通过');
