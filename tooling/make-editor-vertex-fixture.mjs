/** 顶点编辑必须覆盖公式、控制柄、闭合路径和高负载页面，所有坐标固定以保证字节确定性。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const custom = `<p:sp>
<p:nvSpPr><p:cNvPr id="900" name="vertex-freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm rot="900000"><a:off x="${px(280)}" y="${px(170)}"/><a:ext cx="${px(420)}" cy="${px(300)}"/></a:xfrm>
<a:custGeom><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst>
<a:gdLst><a:gd name="mid" fmla="*/ w 1 2"/></a:gdLst>
<a:ahLst><a:ahXY gdRefX="adj" minX="0" maxX="100000"><a:pos x="adj" y="0"/></a:ahXY></a:ahLst>
<a:cxnLst><a:cxn ang="0"><a:pos x="0" y="0"/></a:cxn></a:cxnLst>
<a:rect l="0" t="0" r="r" b="b"/>
<a:pathLst><a:path w="4000000" h="3000000" fill="norm" stroke="1">
<a:moveTo><a:pt x="200000" y="150000"/></a:moveTo>
<a:cubicBezTo><a:pt x="900000" y="100000"/><a:pt x="1300000" y="1200000"/><a:pt x="mid" y="900000"/></a:cubicBezTo>
<a:lnTo><a:pt x="3700000" y="400000"/></a:lnTo>
<a:quadBezTo><a:pt x="3300000" y="2600000"/><a:pt x="1600000" y="2700000"/></a:quadBezTo>
<a:close/>
<a:moveTo><a:pt x="1400000" y="1300000"/></a:moveTo>
<a:lnTo><a:pt x="2100000" y="1900000"/></a:lnTo>
<a:lnTo><a:pt x="2700000" y="1250000"/></a:lnTo>
<a:close/></a:path></a:pathLst></a:custGeom>
${solid('accent2')}<a:ln w="19050"><a:solidFill><a:srgbClr val="1D4ED8"/></a:solidFill></a:ln>
</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;

const load = Array.from({ length: 59 }, (_, index) => sp({
  x: 20 + index % 12 * 100,
  y: 20 + Math.floor(index / 12) * 130,
  w: 72,
  h: 50,
  prst: index % 2 ? 'roundRect' : 'rect',
  fill: solid(index % 2 ? 'accent4' : 'accent5'),
  name: `vertex-load-${index + 1}`,
})).join('');

const bytes = deck({
  name: 'Editor Vertex', width: 1280, height: 720,
  slides: [slideXml(load + custom)],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-vertex.pptx'), bytes);
console.log(`fixtures/sample-editor-vertex.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
