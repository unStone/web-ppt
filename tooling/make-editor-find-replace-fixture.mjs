/** 查找替换固件：跨页、跨 run、组、表格、字段/公式边界与未知 XML。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

const rich = sp({
  x: 35, y: 35, w: 410, h: 190, name: 'find-rich', fill: solid('F8FAFC'),
  effect: '<a:extLst><a:ext uri="{WEB-PPT-FIND}"><fixture:keep xmlns:fixture="urn:web-ppt:find-replace" value="adjacent"/></a:ext></a:extLst>',
  text: `<a:p><a:r><a:rPr sz="1700"/><a:t>Alpha alpha ALPHA alphaBeta 阿尔法 🙂 ΟΣ ος</a:t></a:r></a:p>
<a:p><a:r><a:rPr sz="1800" b="1"/><a:t>Need</a:t></a:r><a:r><a:rPr sz="1800" i="1"/><a:t>le</a:t></a:r></a:p>
<a:p><a:r><a:rPr sz="1600"/><a:t>Need</a:t></a:r><a:fld id="{00000000-0000-0000-0000-000000000060}" type="slidenum"><a:rPr sz="1600"/><a:t>1</a:t></a:fld><a:fld id="{00000000-0000-0000-0000-000000000062}" type="web-ppt-protected"><a:rPr sz="1600"/><a:t>Needle</a:t></a:fld><a:r><a:rPr sz="1600"/><a:t>le</a:t></a:r></a:p>
<a:p><a:r><a:rPr sz="1600"/><a:t>Need</a:t></a:r><a:fld id="{00000000-0000-0000-0000-000000000061}" type="web-ppt-empty"><a:rPr sz="1600"/><a:t></a:t></a:fld><a:r><a:rPr sz="1600"/><a:t>le</a:t></a:r></a:p>
<a:p><a:r><a:rPr sz="1600"/><a:t>Need</a:t></a:r><m:oMath xmlns:m="${MATH_NS}"><m:r><m:t>x</m:t></m:r></m:oMath><a:r><a:rPr sz="1600"/><a:t>le</a:t></a:r></a:p>`,
});

const groupChild = sp({
  x: 10, y: 10, w: 205, h: 80, name: 'find-group-child', fill: solid('DCFCE7'),
  text: '<a:p><a:r><a:rPr sz="1700"/><a:t>Needle group</a:t></a:r></a:p>',
});
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="3060" name="find-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(480)}" y="${px(35)}"/><a:ext cx="${px(235)}" cy="${px(100)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(225)}" cy="${px(90)}"/></a:xfrm></p:grpSpPr>
${groupChild}</p:grpSp>`;

const cell = (text, color) => `<a:tc><a:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>
<a:p><a:r><a:rPr sz="1700"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p>
</a:txBody><a:tcPr/></a:tc>`;
const table = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="3061" name="find-table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(35)}" y="${px(270)}"/><a:ext cx="${px(680)}" cy="${px(105)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr/><a:tblGrid><a:gridCol w="${px(340)}"/><a:gridCol w="${px(340)}"/></a:tblGrid>
<a:tr h="${px(105)}">${cell('Needle cell A', 'DC2626')}${cell('needle cell B', '059669')}</a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

const pageTwo = sp({
  x: 60, y: 70, w: 520, h: 150, name: 'find-page-two', fill: solid('EFF6FF'),
  text: '<a:p><a:r><a:rPr sz="2200"/><a:t>Needle middle Needle NeedleCase</a:t></a:r></a:p>',
});
const pageThree = sp({
  x: 60, y: 70, w: 520, h: 150, name: 'find-no-match', fill: solid('FFF7ED'),
  text: '<a:p><a:r><a:rPr sz="2200"/><a:t>这里没有目标文字</a:t></a:r></a:p>',
});

const bytes = deck({
  name: 'Editor Find Replace', width: 960, height: 540,
  slides: [slideXml(rich + group + table), slideXml(pageTwo), slideXml(pageThree)],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-find-replace.pptx'), bytes);
console.log(`fixtures/sample-editor-find-replace.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
