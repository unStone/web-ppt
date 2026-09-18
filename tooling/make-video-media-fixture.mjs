import { readFileSync, writeFileSync } from 'node:fs';
import { deck, slideXml, sp, solid, px, nextShapeId, NS, makePng } from './lib/ooxml.mjs';

/** 纯绿海报：与 testsrc2 色块差足够大，FFmpeg 抽帧可区分「合成」与「只贴封面」。 */
const poster = makePng(160, 120, () => [0, 220, 0]);
const mp4 = readFileSync(new URL('../fixtures/sample-editor-media.mp4', import.meta.url));

/** 1 秒 PCM；0.20–0.25s 脉冲，放在第 2 页制造相对视频的延迟起点。 */
function pulseWav() {
  const rate = 8000, samples = rate;
  const out = new Uint8Array(44 + samples);
  const view = new DataView(out.buffer);
  const ascii = (offset, value) => out.set([...value].map((char) => char.charCodeAt(0)), offset);
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, 'data'); view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const pulse = t >= 0.2 && t < 0.25 ? 100 : 8;
    out[44 + i] = 128 + Math.round(pulse * Math.sin(2 * Math.PI * 880 * t));
  }
  return out;
}

function videoPic(name, videoRel, posterRel, x, y, w, h, { rot = 0, alpha } = {}) {
  const rotAttr = rot ? ` rot="${Math.round(rot * 60000)}"` : '';
  const alphaXml = alpha !== undefined
    ? `<a:alphaModFix amt="${Math.round(alpha * 100000)}"/>`
    : '';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvPicPr/>
<p:nvPr><a:videoFile r:link="${videoRel}"/></p:nvPr></p:nvPicPr>
<p:blipFill><a:blip r:embed="${posterRel}">${alphaXml}</a:blip><a:srcRect l="10000" t="0" r="10000" b="0"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm${rotAttr}><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

const marker = sp({
  x: 220, y: 200, w: 200, h: 40, fill: solid('1565C0'),
  text: `<a:p><a:r><a:rPr sz="1400"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>media</a:t></a:r></a:p>`,
});
// 左：带轻微裁剪；右：半透明。同页双路重叠验收。
const left = videoPic('合成视频左', 'rIdVideo', 'rIdPoster', 40, 40, 160, 120);
const right = videoPic('合成视频右', 'rIdVideo', 'rIdPoster', 280, 40, 160, 120, { alpha: 0.7 });

const page1 = slideXml(marker + left + right);
const page2Audio = `<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="延迟音轨"/><p:cNvPicPr/>
<p:nvPr><a:audioFile r:link="rIdAudio"/></p:nvPr></p:nvPicPr>
<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(40)}" y="${px(40)}"/><a:ext cx="${px(80)}" cy="${px(80)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const page2 = slideXml(sp({
  x: 140, y: 40, w: 200, h: 40, fill: solid('6A1B9A'),
  text: `<a:p><a:r><a:rPr sz="1400"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>delay-a</a:t></a:r></a:p>`,
}) + page2Audio);

writeFileSync(new URL('../fixtures/sample-video-media.pptx', import.meta.url), deck({
  name: 'VideoMedia', width: 480, height: 270,
  slides: [page1, page2],
  slideRelationships: [
    `<Relationship Id="rIdVideo" Type="${NS.r}/video" Target="../media/clip.mp4"/>`
    + `<Relationship Id="rIdPoster" Type="${NS.r}/image" Target="../media/poster.png"/>`,
    `<Relationship Id="rIdAudio" Type="${NS.r}/audio" Target="../media/pulse.wav"/>`,
  ],
  extraTypes: '<Default Extension="mp4" ContentType="video/mp4"/><Default Extension="png" ContentType="image/png"/><Default Extension="wav" ContentType="audio/wav"/>',
  extraEntries: [
    ['ppt/media/clip.mp4', mp4],
    ['ppt/media/poster.png', poster],
    ['ppt/media/pulse.wav', pulseWav()],
  ],
}));
console.log('fixtures/sample-video-media.pptx：双路视频 + 第 2 页延迟 WAV（音画不同起点）');
