/**
 * 生成 fixtures/sample-media-fallback.pptx：经典媒体引用不可用时回退到 p14:media 内嵌部件（issue #7）。
 *
 * PowerPoint 2010+ 内嵌 2007 不认识的容器（如 mp3 / mp4）时，会把 ISO 29500 的
 * a:audioFile / a:videoFile r:link 写成 Target="NULL" TargetMode="External"，
 * 真实字节只挂在 p:extLst 里 p14:media 的 r:embed 上（MS-PPTX 2.3.3.14）。
 * 每个媒体形状覆盖一种「经典引用」状态，期望结果写在形状名里，断言按 spid 取。
 *   node tooling/make-media-fallback-fixture.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, makePng, makeWav, NS, px, slideXml, sp } from './lib/ooxml.mjs';
import { makeMp4 } from './lib/media-mp4-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const MEDIA_REL = 'http://schemas.microsoft.com/office/2007/relationships/media';
const REL = (id, type, target, external = false) =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;

/** p14:media 按 PowerPoint 实际写法放在 p:extLst/p:ext 下，trim 照搬 repro-deck 的形态 */
function mediaPic({ id, name, kind, x, y, w, h, legacy, p14 }) {
  const legacyRef = legacy ? ` r:link="${legacy}"` : '';
  const p14Refs = Object.entries(p14).map(([attr, rid]) => ` r:${attr}="${rid}"`).join('');
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>`
    + `<p:nvPr><a:${kind}File${legacyRef}/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}">`
    + `<p14:media xmlns:p14="${NS_P14}"${p14Refs}><p14:trim st="100"/></p14:media></p:ext></p:extLst></p:nvPr></p:nvPicPr>`
    + '<p:blipFill><a:blip r:embed="rIdPoster"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    + `<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
}

const cell = (index) => ({ x: 40 + (index % 4) * 225, y: 60 + Math.floor(index / 4) * 240, w: 200, h: 150 });
const cases = [
  { name: '经典 NULL 外链 → p14 内嵌音频', kind: 'audio', legacy: 'rIdNullAudio', p14: { embed: 'rIdWav' } },
  { name: '经典 NULL 外链 → p14 内嵌视频', kind: 'video', legacy: 'rIdNullVideo', p14: { embed: 'rIdMp4' } },
  { name: '经典指向缺失部件 → p14 内嵌视频', kind: 'video', legacy: 'rIdMissingPart', p14: { embed: 'rIdMp4' } },
  { name: '经典关系不存在 → p14 内嵌音频', kind: 'audio', legacy: 'rIdDangling', p14: { embed: 'rIdWav' } },
  { name: '经典合法外链优先', kind: 'video', legacy: 'rIdHttpsVideo', p14: { embed: 'rIdMp4' } },
  { name: 'p14 外链优先于 p14 内嵌', kind: 'audio', legacy: 'rIdNullAudio', p14: { link: 'rIdHttpsAudio', embed: 'rIdWav' } },
  { name: '经典相对外链 → p14 内嵌视频', kind: 'video', legacy: 'rIdRelativeVideo', p14: { embed: 'rIdMp4' } },
  { name: '两路都不可用', kind: 'audio', legacy: 'rIdNullAudio', p14: { embed: 'rIdMissingWav' } },
];
const body = cases.map((item, index) => {
  const box = cell(index);
  return mediaPic({ id: 10 + index, ...item, ...box })
    + sp({ x: box.x, y: box.y + box.h + 8, w: box.w, h: 40, name: `说明 ${10 + index}`, text: label(item.name) });
}).join('');
const relationships = [
  REL('rIdPoster', `${NS.r}/image`, '../media/poster.png'),
  REL('rIdNullAudio', `${NS.r}/audio`, 'NULL', true),
  REL('rIdNullVideo', `${NS.r}/video`, 'NULL', true),
  REL('rIdMissingPart', `${NS.r}/video`, '../media/missing.mp4'),
  REL('rIdHttpsVideo', `${NS.r}/video`, 'https://example.com/media/promo.mp4', true),
  REL('rIdHttpsAudio', `${NS.r}/audio`, 'https://example.com/media/voice.mp3', true),
  REL('rIdRelativeVideo', `${NS.r}/video`, 'clip.mp4', true),
  REL('rIdWav', MEDIA_REL, '../media/media1.wav'),
  REL('rIdMp4', MEDIA_REL, '../media/media2.mp4'),
  REL('rIdMissingWav', MEDIA_REL, '../media/missing.wav'),
].join('');

const poster = makePng(16, 9, (x, y) => [40 + x * 8, 90 + y * 10, 160]);
const bytes = deck({
  name: 'Media Fallback', width: 960, height: 540,
  slides: [slideXml(body)],
  slideRelationships: [relationships],
  extraTypes: '<Default Extension="png" ContentType="image/png"/><Default Extension="wav" ContentType="audio/wav"/>'
    + '<Default Extension="mp4" ContentType="video/mp4"/>',
  extraEntries: [['ppt/media/poster.png', poster], ['ppt/media/media1.wav', makeWav(0.4)], ['ppt/media/media2.mp4', makeMp4()]],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-media-fallback.pptx'), bytes);
console.log(`fixtures/sample-media-fallback.pptx 已生成（${bytes.length} 字节，${cases.length} 个媒体形状）`);
