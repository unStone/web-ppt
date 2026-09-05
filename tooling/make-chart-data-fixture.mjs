/** 从固定 Apache POI 提交中的 Microsoft Office 图表工作簿提炼结构，再做确定性最小化。 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const source = unzipSync(new Uint8Array(readFileSync(join(root, 'fixtures/sample-chart.pptx'))));
const replace = (part, update) => { source[part] = encoder.encode(update(decoder.decode(source[part]))); };
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const POI_SOURCE = {
  path: join(root, 'corpus/poi/bar-chart.pptx'),
  blob: 'e4d2613046ab69e2d0a5c529b41cbcaa49ac4e30',
  pin: '29c9cacc354613eedf6c7ee24007a597f64c1951',
};
const gitBlob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

// corpus 不入库；本地存在时强校验提炼来源，缺失时仍由下方已规范化的结构常量确定性生成。
if (existsSync(POI_SOURCE.path)) {
  const officeBytes = new Uint8Array(readFileSync(POI_SOURCE.path));
  if (gitBlob(officeBytes) !== POI_SOURCE.blob) throw new Error('图表数据 Office 语料校验失败');
  const office = unzipSync(officeBytes);
  const embedded = unzipSync(office['ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx']);
  const sheet = decoder.decode(embedded['xl/worksheets/sheet1.xml']);
  const styles = decoder.decode(embedded['xl/styles.xml']);
  if (!sheet.includes('r="B8"') || !styles.includes('x14ac:knownFonts="1"')) {
    throw new Error('图表数据 Office 语料结构与提炼基线不一致');
  }
  console.log(`图表数据结构来源已校验：Apache POI ${POI_SOURCE.pin.slice(0, 12)} / bar-chart.pptx`);
}

const workbook = makeZip([
  ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
  ['_rels/.rels', `${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ['xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OFFICE_REL}"><fileVersion appName="xl" lastEdited="5" lowestEdited="5" rupBuild="9303"/><workbookPr defaultThemeVersion="124226"/><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="原始数据" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="KeepMe">'原始数据'!$A$1</definedName></definedNames><calcPr calcId="145621"/></workbook>`],
  ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${OFFICE_REL}/styles" Target="styles.xml"/><Relationship Id="rId4" Type="${OFFICE_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
  ['xl/sharedStrings.xml', `${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="7" uniqueCount="7"><si><t>第一季度</t></si><si><t>第二季度</t></si><si><t>第四季度</t></si><si><t>2024 年</t></si><si><t>2025 年</t></si><si><r><t>保留</t></r><r><t>富文本</t></r></si><si><t>未引用</t></si></sst>`],
  ['xl/styles.xml', `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"><numFmts count="1"><numFmt numFmtId="164" formatCode="#\,##0"/></numFmts><fonts count="1" x14ac:knownFonts="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`],
  ['xl/worksheets/sheet1.xml', `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:Z8"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>
<row r="1"><c r="B1" t="s"><v>3</v></c><c r="C1" t="s"><v>4</v></c></row>
<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" s="1"><v>1280</v></c><c r="C2" s="1"><v>1510</v></c></row>
<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="1"><v>1640</v></c><c r="C3" s="1"><v>1390</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>第三季度</t></is></c><c r="B4" s="1"/><c r="C4" s="1"><v>1880</v></c></row>
<row r="5"><c r="A5" t="s"><v>2</v></c><c r="B5" s="1"><v>2050</v></c><c r="C5" s="1"><v>2360</v></c></row>
<row r="8" customHeight="1" ht="20"><c r="Z8" t="inlineStr"><is><t>稀疏保留</t></is></c></row>
</sheetData><extLst><ext uri="keep-sheet-extension"><keep xmlns="urn:web-ppt:test" value="yes"/></ext></extLst></worksheet>`],
  ['xl/worksheets/sheet2.xml', `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>不可修改的旁路工作表</t></is></c></row></sheetData></worksheet>`],
]);

replace('ppt/charts/chart1.xml', (xml) => {
  let seriesIndex = 0;
  const updated = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (series) => {
    const first = seriesIndex++ === 0;
    const column = first ? 'B' : 'C';
    const linked = series.replace('Sheet1!$A$1', `Sheet1!$${column}$1`)
      .replaceAll('Sheet1!$A$2:$A$9', 'Sheet1!$A$2:$A$5')
      .replace('Sheet1!$B$2:$B$9', `Sheet1!$${column}$2:$${column}$5`);
    // 工作簿 B4 是真实空单元格；缓存也必须省略同一索引，避免两份初始真值互相矛盾。
    return first ? linked.replace(/<c:pt idx="2"><c:v>1420<\/c:v><\/c:pt>/, '') : linked;
  });
  return updated.replace('</c:chartSpace>', '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>');
});

const numCache = (values) => '<c:numCache><c:formatCode>General</c:formatCode>' +
  `<c:ptCount val="${values.length}"/>` + values.map((value, index) =>
    `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('') + '</c:numCache>';
const numRef = (formula, values) => `<c:numRef><c:f>${formula}</c:f>${numCache(values)}</c:numRef>`;
const bubbleSeries = (index, name, xs, ys, sizes) =>
  `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${name}</c:v></c:tx>` +
  `<c:xVal>${numRef('Sheet1!$A$2:$A$5', xs)}</c:xVal>` +
  `<c:yVal>${numRef('Sheet1!$B$2:$B$5', ys)}</c:yVal>` +
  `<c:bubbleSize>${numRef('Sheet1!$C$2:$C$5', sizes)}</c:bubbleSize></c:ser>`;
source['ppt/charts/chart11.xml'] = encoder.encode(`${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_REL}"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>规模与转化（气泡图）</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:bubbleChart><c:varyColors val="0"/>${bubbleSeries(0, '直营', [10, 25, 40, 55], [20, 35, 28, 60], [400, 900, 1600, 2500])}${bubbleSeries(1, '渠道', [15, 30, 45, 65], [18, 42, 38, 70], [600, 1200, 2100, 3200])}<c:bubbleScale val="100"/><c:showNegBubbles val="0"/><c:sizeRepresents val="area"/><c:axId val="1101"/><c:axId val="1102"/></c:bubbleChart><c:valAx><c:axId val="1101"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="1102"/><c:crosses val="autoZero"/></c:valAx><c:valAx><c:axId val="1102"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1101"/><c:crosses val="autoZero"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`);
source['ppt/charts/_rels/chart1.xml.rels'] = new TextEncoder().encode(`${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE_REL}/package" Target="../embeddings/chart-data.xlsx"/></Relationships>`);
source['ppt/embeddings/chart-data.xlsx'] = workbook;
replace('[Content_Types].xml', (xml) => xml.replace('<Default Extension="xml"', '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Default Extension="xml"'));

const output = makeZip(Object.entries(source).sort(([left], [right]) => left.localeCompare(right)));
writeFileSync(join(root, 'fixtures/sample-chart-data.pptx'), output);
console.log(`fixtures/sample-chart-data.pptx 已生成（${(output.length / 1024).toFixed(1)} KB）`);
