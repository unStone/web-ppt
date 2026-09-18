import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './bundle-browser.mjs';
import { withChartBrowser } from './chart-browser-lab.mjs';

function meanRegion(pngPath, x, y, w, h) {
  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', pngPath,
  ], { encoding: 'utf8' }));
  const width = Number(probe.streams?.[0]?.width);
  assert(width > 0, 'frame width');
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ]);
  let r = 0, g = 0, b = 0, n = 0;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const i = (row * width + col) * 3;
      r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n, width };
}

function assertNotPoster(region, label) {
  assert(region.g < 150, `${label} 仍像绿色海报：${JSON.stringify(region)}`);
  assert(region.r > 40 || region.b > 40, `${label} 画面过暗不像 testsrc：${JSON.stringify(region)}`);
}

function ffmpegStderr(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  return `${result.stderr || ''}${result.stdout || ''}`;
}

function meanAt(wavOut, start) {
  const text = ffmpegStderr(['-ss', String(start), '-t', '0.1', '-i', wavOut, '-af', 'volumedetect', '-f', 'null', '-']);
  return Number(/mean_volume: ([-\d.]+)/.exec(text)[1]);
}

/** 真实 Chrome：双路贴帧、MP4 AAC→Opus、延迟 WAV、取消。 */
export async function videoMediaBrowserContract(root = resolve('.')) {
  const out = resolve(root, 'out/video-media');
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
  const bytes = readFileSync(resolve(root, 'fixtures/sample-video-media.pptx'));
  await withChartBrowser(root, async browser => {
    const result = await browser.evaluate(`(async()=>{
      const {parse,presentationToVideo}=await import('/out/video-media/contract.mjs');
      const bytes=Uint8Array.from(${JSON.stringify([...bytes])});
      const pres=await parse(bytes);
      try{
        const blob=await presentationToVideo(pres,{fps:10,slideDurationMs:600,animations:false,transitions:false});
        const controller=new AbortController();
        const pending=presentationToVideo(pres,{fps:10,slideDurationMs:3000,animations:false,transitions:false,signal:controller.signal});
        controller.abort();
        let aborted=false;
        try{await pending;}catch(error){aborted=error?.name==='AbortError';}
        return {type:blob.type,bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),aborted};
      }finally{pres.dispose();}
    })()`);
    assert.equal(result.type, 'video/webm');
    assert.equal(result.aborted, true, '画面合成导出取消应抛 AbortError');
    const webm = Buffer.from(result.bytes);
    writeFileSync(resolve(out, 'compose.webm'), webm);
    assert(webm.includes(Buffer.from('A_OPUS')), 'MP4 AAC / 延迟 WAV 应产出 Opus 音轨');

    const frame = resolve(out, 't040.png');
    execFileSync('ffmpeg', [
      '-y', '-ss', '0.4', '-i', resolve(out, 'compose.webm'), '-frames:v', '1', frame,
    ], { stdio: 'pipe' });
    const left = meanRegion(frame, 40, 40, 40, 30);
    const right = meanRegion(frame, 280, 40, 40, 30);
    writeFileSync(resolve(out, 't040-region.json'), JSON.stringify({ left, right }, null, 2));
    assertNotPoster(left, '左路');
    assertNotPoster(right, '右路');

    const wavOut = resolve(out, 'compose.wav');
    execFileSync('ffmpeg', ['-y', '-i', resolve(out, 'compose.webm'), '-vn', '-ac', '1', wavOut], { stdio: 'pipe' });
    // 页停留 600ms：第 1 页含 MP4 AAC（约 0–0.6s 有声），第 2 页 WAV 脉冲约 0.8s。
    const early = meanAt(wavOut, 0.1);
    const midQuiet = meanAt(wavOut, 0.65);
    const delayed = meanAt(wavOut, 0.78);
    writeFileSync(resolve(out, 'av-sync.json'), JSON.stringify({ early, midQuiet, delayed }, null, 2));
    assert(early > midQuiet + 3 || early > -25, `第 1 页 AAC 应可闻：${early} vs ${midQuiet}`);
    assert(delayed - midQuiet > 5, `第 2 页延迟脉冲不够突出：${delayed} vs ${midQuiet}`);

    const info = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'json', resolve(out, 'compose.webm'),
    ], { encoding: 'utf8' }));
    writeFileSync(resolve(out, 'ffprobe.json'), JSON.stringify(info, null, 2));
    assert(Number(info.format?.duration) > 1.0 && Number(info.format?.duration) < 1.5, info.format?.duration);
  });
  console.log('视频画面合成：双路贴帧、AAC→Opus、延迟音画、取消通过');
}
