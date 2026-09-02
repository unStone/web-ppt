/** 高级字符格式固件：完整枚举、版式继承、字段/公式身份与长文本。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const underlines = [
  'none', 'words', 'sng', 'dbl', 'heavy', 'dotted', 'dottedHeavy', 'dash', 'dashHeavy',
  'dashLong', 'dashLongHeavy', 'dotDash', 'dotDashHeavy', 'dotDotDash',
  'dotDotDashHeavy', 'wavy', 'wavyHeavy', 'wavyDbl',
];
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`;

const layoutPlaceholder = `<p:sp>
<p:nvSpPr><p:cNvPr id="71" name="高级格式版式来源"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="7"/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(70, 55, 1140, 86)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle><a:lvl1pPr><a:defRPr sz="1800" u="dashHeavy" strike="dblStrike" spc="150" cap="small" baseline="-12000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:highlight><a:schemeClr val="accent3"/></a:highlight></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:t>版式来源</a:t></a:r></a:p></p:txBody>
</p:sp>`;

const inherited = `<p:sp>
<p:nvSpPr><p:cNvPr id="801" name="高级格式版式继承"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="7"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Inherited small caps</a:t></a:r></a:p></p:txBody>
</p:sp>`;

const underlineRuns = underlines.map((underline) => `<a:r><a:rPr sz="1150" u="${underline}"/><a:t>${underline} </a:t></a:r>`).join('');
const allUnderlines = sp({
  x: 70, y: 165, w: 1140, h: 150, name: '全部下划线类型', fill: solid('F8FAFC'),
  bodyPr: '<a:bodyPr wrap="square" anchor="t"/>',
  text: `<a:p><a:pPr algn="l"/>${underlineRuns}</a:p>`,
});

const direct = sp({
  x: 70, y: 340, w: 1140, h: 90, name: '高级字符格式直接值', fill: solid('FFF7ED'),
  text: `<a:p><a:r><a:rPr sz="2200" u="wavyDbl" strike="dblStrike" spc="-225" cap="all" baseline="30000"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill><a:highlight><a:schemeClr val="accent4"/></a:highlight></a:rPr><a:t>Advanced Format</a:t></a:r></a:p>`,
});

const identity = sp({
  x: 70, y: 455, w: 1140, h: 90, name: '字段链接公式格式身份', fill: solid('EFF6FF'),
  text: `<a:p><a:fld id="{00000000-0000-0000-0000-000000000804}" type="datetime1"><a:rPr sz="1700" u="dotDashHeavy"><a:hlinkClick r:id="rId2"/></a:rPr><a:t>2026-09-03</a:t></a:fld><a:r><a:rPr sz="1700" strike="sngStrike"/><a:t> 公式 </a:t></a:r><m:oMath xmlns:m="${MATH_NS}"><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></a:p>`,
});

const longText = sp({
  x: 70, y: 570, w: 1140, h: 90, name: '高级格式两千字符', fill: solid('F0FDF4'),
  bodyPr: '<a:bodyPr wrap="none" anchor="ctr"><a:normAutofit/></a:bodyPr>',
  text: `<a:p><a:r><a:rPr sz="900" u="dottedHeavy" spc="75"><a:highlight><a:srgbClr val="E0F2FE"/></a:highlight></a:rPr><a:t>${'字'.repeat(2000)}</a:t></a:r></a:p>`,
});

const bytes = deck({
  name: 'Advanced Run Format', width: 1280, height: 720,
  slides: [slideXml(inherited + allUnderlines + direct + identity + longText)],
  layoutShapes: layoutPlaceholder,
  slideRelationships: ['<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/advanced-format" TargetMode="External"/>'],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-advanced-run-format.pptx'), bytes);
console.log(`fixtures/sample-editor-advanced-run-format.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
