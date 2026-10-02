import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, makeWav, px, slideXml, solid } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const intro = `<p:sp><p:nvSpPr><p:cNvPr id="101" name="先播放的动画"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(100)}" y="${px(140)}"/><a:ext cx="${px(240)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('93C5FD')}</p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/>
<a:t>音频播放前的效果</a:t></a:r></a:p></p:txBody></p:sp>`;
const audio = `<p:pic><p:nvPicPr><p:cNvPr id="200" name="定时音频"/><p:cNvPicPr/>
<p:nvPr><a:audioFile r:link="rId2"/></p:nvPr></p:nvPicPr>
<p:blipFill><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(420)}" y="${px(140)}"/><a:ext cx="${px(160)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
<p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
<p:par><p:cTn id="10" presetID="10" presetClass="entr" nodeType="clickEffect">
<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animEffect filter="fade">
<p:cBhvr><p:cTn id="11" dur="80"/><p:tgtEl><p:spTgt spid="101"/></p:tgtEl></p:cBhvr>
</p:animEffect></p:childTnLst></p:cTn></p:par>
<p:par><p:cTn id="20" presetID="1" presetClass="mediacall" nodeType="afterEffect">
<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)">
<p:cBhvr><p:cTn id="21" dur="12000"/><p:tgtEl><p:spTgt spid="200"/></p:tgtEl></p:cBhvr>
</p:cmd></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

const slide = slideXml(intro + audio).replace('</p:sld>', `${timing}</p:sld>`);
const bytes = deck({
  name: 'Media Timing', width: 1280, height: 720,
  slides: [slide],
  extraTypes: '<Default Extension="wav" ContentType="audio/wav"/>',
  extraEntries: [['ppt/media/tone.wav', makeWav(12)]],
  slideRelationships: [`<Relationship Id="rId2" Type="${REL}/audio" Target="../media/tone.wav"/>`],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-media-timing.pptx'), bytes);
console.log(`fixtures/sample-media-timing.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
