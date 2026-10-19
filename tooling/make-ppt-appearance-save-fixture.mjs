import { writeFileSync } from 'node:fs';
import { deck, slideXml, sp, px, makePng, nextShapeId, NS } from './lib/ooxml.mjs';

/** 四个角度覆盖 fillAngle 换算的四个象限；45° 的终点色半透明，锁住 fillBackOpacity。 */
const gradient = (name, x, ang, endAlpha = '') => sp({
  name, x, y: 40, w: 120, h: 90,
  fill: `<a:gradFill><a:gsLst>
<a:gs pos="0"><a:srgbClr val="1565C0"/></a:gs>
<a:gs pos="100000"><a:srgbClr val="E53935">${endAlpha}</a:srgbClr></a:gs>
</a:gsLst><a:lin ang="${ang * 60000}" scaled="1"/></a:gradFill>`,
});
const gradients = [
  gradient('grad-0', 20, 0),
  gradient('grad-45', 160, 45, '<a:alpha val="50000"/>'),
  gradient('grad-90', 300, 90),
  gradient('grad-180', 440, 180),
];
/** med/med → Schema w=h=3；五种箭头类型各锁一条，避免只测到 triangle */
const arrowLine = (name, type, x, y) => sp({
  name, x, y, w: 70, h: 40, fill: '<a:noFill/>',
  ln: `<a:ln w="19050"><a:solidFill><a:srgbClr val="2E7D32"/></a:solidFill><a:prstDash val="dash"/>
<a:headEnd type="${type}" w="med" len="med"/><a:tailEnd type="${type}" w="med" len="med"/></a:ln>`,
});
const arrows = [
  arrowLine('arrow-triangle', 'triangle', 20, 160), arrowLine('arrow-stealth', 'stealth', 100, 160),
  arrowLine('arrow-diamond', 'diamond', 180, 160), arrowLine('arrow-oval', 'oval', 20, 230),
  arrowLine('arrow-arrow', 'arrow', 100, 230),
];
const png = makePng(16, 16, (x) => [x < 8 ? 229 : 21, x < 8 ? 57 : 100, x < 8 ? 53 : 192]);
// 四边裁剪量各不相同，cropFromTop/Bottom/Left/Right 任何一对写反都会被测出来。
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="裁剪图"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rIdImage"/><a:srcRect l="10000" t="5000" r="20000" b="15000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(400)}" y="${px(160)}"/><a:ext cx="${px(120)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

writeFileSync(new URL('../fixtures/sample-ppt-appearance-save.pptx', import.meta.url), deck({
  name: 'PptAppearance', width: 640, height: 360,
  // 第二页让持久化目录 ≥4（文档 + 母版 + 两页），与 validateDirectory 一致
  slides: [
    slideXml(gradients.join('') + arrows.join('') + picture),
    slideXml(''),
  ],
  slideRelationships: [
    `<Relationship Id="rIdImage" Type="${NS.r}/image" Target="../media/swatch.png"/>`,
    '',
  ],
  extraTypes: '<Default Extension="png" ContentType="image/png"/>',
  extraEntries: [['ppt/media/swatch.png', png]],
}));
console.log('fixtures/sample-ppt-appearance-save.pptx：四象限线性渐变、五种默认箭头与非对称矩形裁剪');
