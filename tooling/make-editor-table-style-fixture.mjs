/** 生成六个 tblPr 开关与单元格直接格式优先级的确定性表样式固件。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, nextShapeId, NS, px, slideXml, solid, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_ID = '{71A84F42-BA92-4C1E-9EE0-71590D54A071}';

function cell(row, column) {
  const directText = row === 0 && column === 1;
  const directAppearance = row === 1 && column === 1;
  const runProperties = directText
    ? `<a:rPr b="0">${solid('10B981')}</a:rPr>`
    : '<a:rPr/>';
  const properties = directAppearance
    ? `<a:tcPr>${solid('111827')}<a:lnL w="28575">${solid('DC2626')}</a:lnL></a:tcPr>`
    : '<a:tcPr/>';
  return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>${runProperties}`
    + `<a:t>${row}:${column}</a:t></a:r></a:p></a:txBody>${properties}</a:tc>`;
}

const rows = Array.from({ length: 4 }, (_, row) => `<a:tr h="${px(95)}">`
  + Array.from({ length: 4 }, (_, column) => cell(row, column)).join('')
  + '</a:tr>').join('\n');
const table = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="${nextShapeId()}" name="六开关表样式"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(150)}" y="${px(120)}"/><a:ext cx="${px(800)}" cy="${px(380)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr><a:tableStyleId>${STYLE_ID}</a:tableStyleId></a:tblPr>
<a:tblGrid>${Array.from({ length: 4 }, () => `<a:gridCol w="${px(200)}"/>`).join('')}</a:tblGrid>
${rows}<a:extLst><a:ext uri="{TABLE-STYLE-KEEP}"><fixture:keep xmlns:fixture="urn:web-ppt:table-style"/></a:ext></a:extLst>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

const part = (name, color, text = '') => `<a:${name}>${text}<a:tcStyle><a:fill>${solid(color)}</a:fill></a:tcStyle></a:${name}>`;
const tableStyles = `${XML}<a:tblStyleLst xmlns:a="${NS.a}"
xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" def="${STYLE_ID}">
<a:tblStyle styleId="${STYLE_ID}" styleName="Six Switch Oracle" mc:Ignorable="a14">
${part('wholeTbl', 'E5E7EB')}
${part('band1H', '3B82F6')}${part('band2H', 'FACC15')}
${part('band1V', '06B6D4')}${part('band2V', 'EC4899')}
${part('firstRow', 'EF4444', '<a:tcTxStyle b="on"><a:srgbClr val="FFFFFF"/></a:tcTxStyle>')}
${part('lastRow', '22C55E')}${part('firstCol', 'A855F7')}${part('lastCol', 'F97316')}
<a:extLst><a:ext uri="{71A84F42-BA92-4C1E-9EE0-71590D54A072}"><a14:keep val="TABLE-STYLE-NS-KEEP"/></a:ext></a:extLst>
</a:tblStyle></a:tblStyleLst>`;

const bytes = deck({
  name: 'Editor Table Style', width: 1280, height: 720,
  slides: [slideXml(table)],
  presRels: '<Relationship Id="rId80" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>',
  extraTypes: '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
  extraEntries: [['ppt/tableStyles.xml', tableStyles]],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-table-style.pptx'), bytes);
console.log(`fixtures/sample-editor-table-style.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
