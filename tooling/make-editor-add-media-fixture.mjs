/** 音频插入从无媒体页面开始，避免原包资源偶然遮住新资源闭包缺陷。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, slideXml, solid, sp, NS, makeWav } from './lib/ooxml.mjs';
import { makeMp4 } from './lib/media-mp4-fixture.mjs';
import { makeAudioIcon } from './lib/media-audio-icon-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = deck({
  name: 'Add Media', width: 960, height: 540,
  slides: [slideXml(sp({ x: 40, y: 40, w: 240, h: 40, fill: solid('accent1'), name: '音频插入锚点' }))],
  presRels: '<Relationship Id="rId79" Type="urn:web-ppt:add-media:unknown" Target="../customXml/add-media.xml"/>',
  extraTypes: '<Override PartName="/customXml/add-media.xml" ContentType="application/x-web-ppt-add-media+xml"/>',
  extraEntries: [['customXml/add-media.xml', '<keep xmlns="urn:web-ppt:add-media">媒体插入不改写旁路内容</keep>']],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-add-media.pptx'), bytes);
writeFileSync(join(root, 'fixtures/sample-editor-media.mp4'), makeMp4());
writeFileSync(join(root, 'fixtures/sample-editor-media-fragmented.mp4'), makeMp4(true));
writeFileSync(join(root, 'fixtures/sample-editor-media.wav'), makeWav(0.4));
const icon = makeAudioIcon();
const stored = readFileSync(join(root, 'packages/edit-core/src/media/audio-icon.ts'), 'utf8')
  .match(/AUDIO_ICON_PNG = '([^']+)'/)?.[1];
if (stored !== Buffer.from(icon).toString('base64')) throw new Error('默认音频图标与确定性生成器不一致');
writeFileSync(join(root, 'fixtures/sample-editor-audio-icon.png'), icon);
const picture = (id) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="兼容音频 ${id}"/>`
  + '<p:cNvPicPr/><p:nvPr><a:audioFile r:link="rId2"/></p:nvPr></p:nvPicPr>'
  + '<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
  + '<p:spPr><a:xfrm><a:off x="381000" y="571500"/><a:ext cx="762000" cy="762000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
const compatibility = deck({ name: '兼容媒体边界', width: 960, height: 540,
  slides: [slideXml(picture(2) + '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
    + ' xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">'
    + `<mc:Choice Requires="p14">${picture(3)}</mc:Choice><mc:Fallback>${picture(3)}</mc:Fallback></mc:AlternateContent>`)],
  slideRelationships: [`<Relationship Id="rId2" Type="${NS.r}/audio" Target="../media/tone.wav"/>`
    + `<Relationship Id="rId3" Type="${NS.r}/image" Target="../media/icon.png"/>`],
  extraTypes: '<Default Extension="wav" ContentType="audio/wav"/><Default Extension="png" ContentType="image/png"/>',
  extraEntries: [['ppt/media/tone.wav', makeWav(0.4)], ['ppt/media/icon.png', icon]],
});
writeFileSync(join(root, 'fixtures/sample-editor-media-compatible.pptx'), compatibility);
console.log(`媒体插入固件已生成（${bytes.length} 字节）`);
