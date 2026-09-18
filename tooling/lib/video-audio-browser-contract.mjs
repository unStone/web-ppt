import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './bundle-browser.mjs';
import { withChartBrowser } from './chart-browser-lab.mjs';

function ffmpegStderr(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  return `${result.stderr || ''}${result.stdout || ''}`;
}

function meanAt(wavOut, start) {
  const text = ffmpegStderr(['-ss', String(start), '-t', '0.1', '-i', wavOut, '-af', 'volumedetect', '-f', 'null', '-']);
  return Number(/mean_volume: ([-\d.]+)/.exec(text)[1]);
}

/** 真实 Chrome：PCM WAV → Opus 音轨 WebM；FFmpeg 核对双页延迟脉冲与取消。 */
export async function videoAudioBrowserContract(root = resolve('.')) {
  const out = resolve(root, 'out/video-audio');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'entry.mjs'), `export { parse } from '@web-ppt/core';
export { presentationToVideo } from '@web-ppt/viewer-core/video';`);
  await bundleBrowser({
    root,
    entry: resolve(out, 'entry.mjs'),
    output: resolve(out, 'contract.mjs'),
    aliases: [
      ['@web-ppt/core', resolve(root, 'packages/core/src/index.ts')],
      ['@web-ppt/viewer-core/video', resolve(root, 'packages/viewer-core/src/video.ts')],
    ],
  });
  const bytes = readFileSync(resolve(root, 'fixtures/sample-video-audio.pptx'));
  await withChartBrowser(root, async browser => {
    const result = await browser.evaluate(`(async()=>{
      const {parse,presentationToVideo}=await import('/out/video-audio/contract.mjs');
      const bytes=Uint8Array.from(${JSON.stringify([...bytes])});
      const pres=await parse(bytes);
      try{
        const blob=await presentationToVideo(pres,{fps:12,slideDurationMs:500,animations:false,transitions:false});
        const controller=new AbortController();
        const pending=presentationToVideo(pres,{fps:12,slideDurationMs:2000,animations:false,transitions:false,signal:controller.signal});
        controller.abort();
        let aborted=false;
        try{await pending;}catch(error){aborted=error?.name==='AbortError';}
        return {type:blob.type,bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),aborted};
      }finally{pres.dispose();}
    })()`);
    assert.equal(result.type, 'video/webm');
    assert.equal(result.aborted, true, '音轨导出取消应抛 AbortError');
    const webm = Buffer.from(result.bytes);
    writeFileSync(resolve(out, 'pulse.webm'), webm);
    assert(webm.includes(Buffer.from('A_OPUS')), 'missing A_OPUS');
    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
      '-of', 'json', resolve(out, 'pulse.webm'),
    ], { encoding: 'utf8' });
    writeFileSync(resolve(out, 'ffprobe.json'), probe);
    const info = JSON.parse(probe);
    assert.equal(info.streams?.[0]?.codec_name, 'opus');
    assert.equal(Number(info.streams[0].channels), 1);
    const wavOut = resolve(out, 'pulse.wav');
    execFileSync('ffmpeg', ['-y', '-i', resolve(out, 'pulse.webm'), '-vn', '-ac', '1', wavOut], { stdio: 'pipe' });
    const volume = ffmpegStderr(['-i', wavOut, '-af', 'volumedetect', '-f', 'null', '-']);
    writeFileSync(resolve(out, 'volume.txt'), volume);
    assert(/max_volume: ([-\d.]+)/.test(volume), volume);
    const max = Number(/max_volume: ([-\d.]+)/.exec(volume)[1]);
    assert(max > -20, `脉冲峰值过低：${max} dB`);
    // 页停留 500ms：第 1 路脉冲约 0.2s，第 2 路约 0.7s；中间安静段约 0.4s。
    const first = meanAt(wavOut, 0.18);
    const quiet = meanAt(wavOut, 0.4);
    const second = meanAt(wavOut, 0.68);
    writeFileSync(resolve(out, 'pulse-window.json'), JSON.stringify({
      first, quiet, second, duration: info.format?.duration,
    }, null, 2));
    assert(first - quiet > 6, `第一页脉冲不够突出：${first} vs ${quiet}`);
    assert(second - quiet > 6, `延迟第二页脉冲不够突出：${second} vs ${quiet}`);
    assert(Number(info.format.duration) > 0.9 && Number(info.format.duration) < 1.4, info.format.duration);
  });
  console.log('视频音轨：Chrome Opus、双页延迟脉冲同轴、取消 AbortError 通过');
}
