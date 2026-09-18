import { writeFileSync } from 'node:fs';
import { deck, slideXml, sp, solid, px, nextShapeId, NS } from './lib/ooxml.mjs';

/**
 * 1 秒 8-bit PCM；`pulseAt`–`pulseAt+0.05` 处高振幅脉冲。
 * 第二页用另一频率，便于 FFmpeg 区分「延迟起点」两路混音。
 */
function pulseWav(pulseAt = 0.2, hz = 880) {
  const rate = 8000, seconds = 1, samples = rate * seconds;
  const out = new Uint8Array(44 + samples);
  const view = new DataView(out.buffer);
  const ascii = (offset, value) => out.set([...value].map((char) => char.charCodeAt(0)), offset);
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, 'data'); view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const pulse = t >= pulseAt && t < pulseAt + 0.05 ? 100 : 8;
    out[44 + i] = 128 + Math.round(pulse * Math.sin(2 * Math.PI * hz * t));
  }
  return out;
}

function audioPic(name, rel) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvPicPr/>
<p:nvPr><a:audioFile r:link="${rel}"/></p:nvPr></p:nvPicPr>
<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(200)}" y="${px(40)}"/><a:ext cx="${px(80)}" cy="${px(80)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

const page1 = slideXml(sp({
  x: 40, y: 40, w: 120, h: 80, fill: solid('1565C0'),
  text: `<a:p><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>p1</a:t></a:r></a:p>`,
}) + audioPic('音轨脉冲1', 'rIdAudio'));
const page2 = slideXml(sp({
  x: 40, y: 40, w: 120, h: 80, fill: solid('2E7D32'),
  text: `<a:p><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>p2</a:t></a:r></a:p>`,
}) + audioPic('音轨脉冲2', 'rIdAudio'));

writeFileSync(new URL('../fixtures/sample-video-audio.pptx', import.meta.url), deck({
  name: 'VideoAudio', width: 480, height: 270,
  slides: [page1, page2],
  slideRelationships: [
    `<Relationship Id="rIdAudio" Type="${NS.r}/audio" Target="../media/pulse1.wav"/>`,
    `<Relationship Id="rIdAudio" Type="${NS.r}/audio" Target="../media/pulse2.wav"/>`,
  ],
  extraTypes: '<Default Extension="wav" ContentType="audio/wav"/>',
  extraEntries: [
    ['ppt/media/pulse1.wav', pulseWav(0.2, 880)],
    ['ppt/media/pulse2.wav', pulseWav(0.2, 440)],
  ],
}));
console.log('fixtures/sample-video-audio.pptx：双页页起点 PCM WAV 脉冲（延迟混音）');
