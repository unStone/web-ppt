/** 生成基础文字编辑固件：多段、多 run、空段、硬换行、RTL、字段、公式与空文本框。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

const richText = `<a:p><a:pPr algn="l"/>
<a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill></a:rPr><a:t xml:space="preserve"> 前导 </a:t></a:r>
<a:r><a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:rPr><a:t>中文</a:t></a:r>
<a:r><a:rPr sz="1800" i="1"/><a:t>日本語</a:t></a:r>
<a:br><a:rPr sz="1800"/></a:br>
<a:r><a:rPr sz="1800"/><a:t xml:space="preserve">硬换行后 </a:t></a:r></a:p>
<a:p><a:pPr algn="r" rtl="1"/><a:r><a:rPr sz="1700"/><a:t>مرحبا بالعالم</a:t></a:r></a:p>
<a:p><a:pPr algn="ctr"/><a:endParaRPr sz="1600"/></a:p>
<a:p><a:r><a:rPr sz="1800"/><a:t>公式前</a:t></a:r>
<m:oMath xmlns:m="${MATH_NS}"><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>
<a:r><a:rPr sz="1800"/><a:t>公式后</a:t></a:r></a:p>
<a:p><a:fld id="{6C85A91D-23A3-4B39-9220-9DE59B29C409}" type="slidenum"><a:rPr sz="1500"/>
<a:t>1</a:t></a:fld><a:endParaRPr sz="1500"/></a:p>`;

const rich = sp({
  x: 90, y: 80, w: 620, h: 310, prst: 'roundRect', fill: solid('F8FAFC'), name: '文本综合',
  bodyPr: '<a:bodyPr wrap="square" anchor="t"><a:normAutofit fontScale="92000" lnSpcReduction="8000"/></a:bodyPr>',
  text: richText,
});

const empty = sp({
  x: 770, y: 100, w: 360, h: 130, prst: 'rect', fill: solid('FFF7ED'), name: '空文本框',
  bodyPr: '<a:bodyPr anchor="ctr"/>',
  text: '<a:p><a:pPr algn="ctr"/><a:endParaRPr sz="2200" b="1"/></a:p>',
});

const rotated = `<p:sp>
<p:nvSpPr><p:cNvPr id="801" name="旋转文本"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm rot="900000"><a:off x="${px(790)}" y="${px(300)}"/><a:ext cx="${px(320)}" cy="${px(160)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('ECFDF5')}</p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>
<a:r><a:rPr sz="2000"/><a:t>旋转后仍可编辑</a:t></a:r></a:p></p:txBody></p:sp>`;

const repeated = sp({
  x: 770, y: 510, w: 360, h: 100, prst: 'rect', fill: solid('F5F3FF'), name: '重复格式',
  bodyPr: '<a:bodyPr anchor="ctr"/>',
  text: `<a:p><a:pPr algn="ctr"/>
<a:r><a:rPr sz="2000"><?format keep?><a:solidFill><a:srgbClr val="DC2626"/></a:solidFill></a:rPr><a:t>同</a:t></a:r>
<!--paragraph-format-sentinel-->
<a:r><a:rPr sz="2000" b="1"><a:solidFill><a:srgbClr val="16A34A"/></a:solidFill><a:latin typeface="Courier New"/><a:ea typeface="Courier New"/><a:cs typeface="Courier New"/></a:rPr><a:t>同</a:t></a:r>
<a:r><a:rPr sz="2000" i="1"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:rPr><a:t>同</a:t></a:r></a:p>`,
});

const splitFormat = sp({
  x: 90, y: 510, w: 620, h: 100, prst: 'rect', fill: solid('EFF6FF'), name: '中段格式',
  bodyPr: '<a:bodyPr anchor="ctr"/>',
  text: `<a:p><a:pPr algn="ctr"/>
<!--split-before:  keep--><?split-format  keep = "yes"?>
<a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="0F766E"/></a:solidFill></a:rPr><a:t>ABCDE</a:t></a:r>
<?split-after   keep="two"?><!--split-after:  keep--></a:p>`,
});

const bytes = deck({
  name: 'Editor Text', width: 1280, height: 720,
  slides: [slideXml(rich + empty + rotated + repeated + splitFormat)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-text.pptx'), bytes);
console.log(`fixtures/sample-editor-text.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
