import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = '<a:p><a:r><a:rPr sz="2400"/><a:t>Work in pairs. Compare your answers to Exercise 9.</a:t></a:r></a:p>';

function group(normalized) {
  const childW = normalized ? 1 : 600;
  const childH = normalized ? 2540 / 9525 : 160;
  const child = sp({
    x: 0, y: 0, w: childW, h: childH, name: '组合内文字',
    fill: solid('DBEAFE'),
    bodyPr: '<a:bodyPr wrap="square" anchor="t"/>',
    text,
  });
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="900" name="文字组合"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(100)}" y="${px(130)}"/>
<a:ext cx="${px(600)}" cy="${px(160)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(childW)}" cy="${px(childH)}"/></a:xfrm></p:grpSpPr>${child}</p:grpSp>`;
}

const bytes = deck({
  name: 'Group Text Scale', width: 1280, height: 720,
  slides: [slideXml(group(false)), slideXml(group(true))],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-group-scale.pptx'), bytes);
console.log(`fixtures/sample-group-scale.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
