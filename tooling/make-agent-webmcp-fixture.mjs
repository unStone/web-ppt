import { writeFileSync } from 'node:fs';
import { deck, label, makePng, nextShapeId, NS, px, slideXml, sp } from './lib/ooxml.mjs';

const title = sp({ name: '页面标题', x: 40, y: 30, w: 300, h: 60, text: label('可编辑标题') });
const overflow = sp({
  name: '溢出文本', x: 40, y: 120, w: 80, h: 10,
  text: '<a:p><a:r><a:rPr sz="1200"><a:latin typeface="Arial"/></a:rPr><a:t>AV AV AV AV AV AV AV AV</a:t></a:r></a:p>',
  bodyPr: '<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/>',
});
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="替换图片"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="img"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(360)}" y="${px(110)}"/><a:ext cx="${px(160)}" cy="${px(80)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const second = sp({ name: '第二页标题', x: 40, y: 30, w: 300, h: 60, text: label('可编辑标题') });

writeFileSync(new URL('../fixtures/sample-agent-webmcp.pptx', import.meta.url), deck({
  name: 'Agent WebMCP', width: 640, height: 360,
  slides: [slideXml(title + overflow + picture), slideXml(second)],
  slideRelationships: [`<Relationship Id="img" Type="${NS.r}/image" Target="../media/image.png"/>`, ''],
  extraTypes: '<Default Extension="png" ContentType="image/png"/>',
  extraEntries: [['ppt/media/image.png', makePng(80, 40, () => [32, 64, 128])]],
}));
