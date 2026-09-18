import { writeFileSync } from 'node:fs';
import { deck, slideXml, sp, px, makePng, nextShapeId, NS } from './lib/ooxml.mjs';

const gradient = sp({
  name: 'grad-linear',
  x: 40, y: 40, w: 160, h: 90,
  fill: `<a:gradFill><a:gsLst>
<a:gs pos="0"><a:srgbClr val="1565C0"/></a:gs>
<a:gs pos="100000"><a:srgbClr val="E53935"/></a:gs>
</a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>`,
});
const pattern = sp({
  name: 'pat-smGrid',
  x: 220, y: 40, w: 120, h: 90,
  fill: `<a:pattFill prst="smGrid"><a:fgClr><a:srgbClr val="1565C0"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>`,
});
/** med/med → Schema w=h=3；五种箭头类型各锁一条，避免只测到 triangle */
const arrowLine = (name, type, x) => sp({
  name, x, y: 40, w: 70, h: 40, fill: '<a:noFill/>',
  ln: `<a:ln w="19050"><a:solidFill><a:srgbClr val="2E7D32"/></a:solidFill><a:prstDash val="dash"/>
<a:headEnd type="${type}" w="med" len="med"/><a:tailEnd type="${type}" w="med" len="med"/></a:ln>`,
});
const dashed = [
  arrowLine('arrow-triangle', 'triangle', 360),
  arrowLine('arrow-stealth', 'stealth', 440),
  arrowLine('arrow-diamond', 'diamond', 520),
];
/** 第二行避免与渐变/图案重叠；y 通过局部改 ln 形状坐标 */
const arrowRow2 = (name, type, x) => sp({
  name, x, y: 160, w: 70, h: 40, fill: '<a:noFill/>',
  ln: `<a:ln w="19050"><a:solidFill><a:srgbClr val="2E7D32"/></a:solidFill><a:prstDash val="dash"/>
<a:headEnd type="${type}" w="med" len="med"/><a:tailEnd type="${type}" w="med" len="med"/></a:ln>`,
});
const dashed2 = [arrowRow2('arrow-oval', 'oval', 40), arrowRow2('arrow-arrow', 'arrow', 120)];
const png = makePng(16, 16, (x) => [x < 8 ? 229 : 21, x < 8 ? 57 : 100, x < 8 ? 53 : 192]);
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="裁剪图"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rIdImage"/><a:srcRect l="12500" r="12500" t="12500" b="12500"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(400)}" y="${px(160)}"/><a:ext cx="${px(120)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

writeFileSync(new URL('../fixtures/sample-ppt-appearance-save.pptx', import.meta.url), deck({
  name: 'PptAppearance', width: 640, height: 360,
  // 第二页让持久化目录 ≥4（文档+母版+两页），与 validateDirectory 一致
  slides: [
    slideXml(gradient + pattern + dashed.join('') + dashed2.join('') + picture),
    slideXml(''),
  ],
  slideRelationships: [
    `<Relationship Id="rIdImage" Type="${NS.r}/image" Target="../media/swatch.png"/>`,
    '',
  ],
  extraTypes: '<Default Extension="png" ContentType="image/png"/>',
  extraEntries: [['ppt/media/swatch.png', png]],
}));
console.log('fixtures/sample-ppt-appearance-save.pptx：渐变、图案、五种默认箭头与矩形裁剪');
