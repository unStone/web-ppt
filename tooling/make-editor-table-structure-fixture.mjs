/** 确定性生成表格结构固件：横纵合并、直接格式与未知扩展同表共存。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, nextShapeId, px, slideXml, solid } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const widths = [210, 230, 250, 270];
const heights = [100, 120, 140];
const cell = (text, attrs = '', properties = '<a:tcPr/>') =>
  `<a:tc${attrs ? ` ${attrs}` : ''}><a:txBody><a:bodyPr/><a:lstStyle/><a:p>`
  + `<a:r><a:rPr sz="1800"/><a:t>${text}</a:t></a:r></a:p></a:txBody>${properties}</a:tc>`;
const rows = [
  [
    cell('横向合并', 'gridSpan="2"', `<a:tcPr marL="${px(12)}" marR="${px(8)}" anchor="ctr">${solid('FDE68A')}</a:tcPr>`),
    cell('横向占位', 'hMerge="1"'),
    cell('右上', '', `<a:tcPr>${solid('DBEAFE')}</a:tcPr>`),
    cell('右上末'),
  ],
  [
    cell('纵向合并', 'rowSpan="2"', `<a:tcPr anchor="b">${solid('DCFCE7')}</a:tcPr>`),
    cell('中一'), cell('中二'), cell('中三', '', `<a:tcPr vert="vert">${solid('F3E8FF')}</a:tcPr>`),
  ],
  [cell('纵向占位', 'vMerge="1"'), cell('下一'), cell('下二'), cell('下三')],
];
const width = widths.reduce((sum, value) => sum + value, 0);
const height = heights.reduce((sum, value) => sum + value, 0);
const table = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="${nextShapeId()}" name="结构编辑基线"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(120)}" y="${px(110)}"/><a:ext cx="${px(width)}" cy="${px(height)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${widths.map((value) => `<a:gridCol w="${px(value)}"/>`).join('')}</a:tblGrid>
${rows.map((cells, index) => `<a:tr h="${px(heights[index])}">${cells.join('')}</a:tr>`).join('\n')}
<a:extLst><a:ext uri="{TABLE-STRUCTURE-KEEP}"><fixture:keep xmlns:fixture="urn:web-ppt:fixture" value="grid"/></a:ext></a:extLst>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

const bytes = deck({
  name: 'Editor Table Structure', width: 1280, height: 720, slides: [slideXml(table)],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-table-structure.pptx'), bytes);
console.log(`fixtures/sample-editor-table-structure.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
