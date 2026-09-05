/** 从真实漏斗 PPTX 提炼 MC/关系结构；数据与 PNG 自行生成，不复制 Office 原图或工作簿。 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, makePng, makeZip, NS, px, slideXml, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'fixtures/chartex-corpus.json'), 'utf8'));
const source = manifest.files.find((file) => file.name === 'funnel-pp1.pptx');
const sourcePath = join(root, source.downloadPath);
if (existsSync(sourcePath)) {
  const digest = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  if (digest !== source.sha256) throw new Error('ChartEx 结构来源与固定哈希不符');
}
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const CX2 = 'http://schemas.microsoft.com/office/drawing/2015/10/21/chartex';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const xfrm = `<a:off x="${px(40)}" y="${px(50)}"/><a:ext cx="${px(400)}" cy="${px(240)}"/>`;
const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="fallback-chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm>${xfrm}</p:xfrm><a:graphic><a:graphicData uri="${CX}"><cx:chart xmlns:cx="${CX}" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>`;
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="6" name="fallback-chart"/><p:cNvPicPr><a:picLocks noGrp="1" noRot="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm>${xfrm}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const alternate = `<mc:AlternateContent xmlns:mc="${MC}" xmlns:modern="${CX2}"><mc:Choice Requires="modern">${frame}</mc:Choice><mc:Fallback>${picture}</mc:Fallback></mc:AlternateContent>`;
const values = [10, 6, 2];
const workbook = makeZip([
  ['[Content_Types].xml', `${XML}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
  ['_rels/.rels', `${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${NS.r}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ['xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS.r}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${NS.r}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
  ['xl/worksheets/sheet1.xml', `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${values.map((value, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${value}</v></c></row>`).join('')}</sheetData></worksheet>`],
]);
const chart = `${XML}<cx:chartSpace xmlns:cx="${CX}" xmlns:r="${NS.r}"><cx:chartData><cx:externalData r:id="rId1"/>
<cx:data id="0"><cx:numDim type="val"><cx:f>Sheet1!$A$1:$A$3</cx:f><cx:lvl ptCount="3">${values.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('')}</cx:lvl></cx:numDim></cx:data></cx:chartData>
<cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="funnel"><cx:dataId val="0"/></cx:series></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>`;
const image = makePng(120, 72, (x, y) => {
  const band = Math.floor(y / 24);
  return Math.abs(x - 60) <= [54, 36, 18][band] ? [[32, 112, 192], [40, 160, 120], [232, 160, 40]][band] : [255, 255, 255];
});
const bytes = deck({
  name: 'ChartEx Fallback', width: 640, height: 360, slides: [slideXml(alternate)],
  slideRelationships: [`<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"/><Relationship Id="rId3" Type="${NS.r}/image" Target="../media/chart-preview.png"/>`],
  extraTypes: '<Override PartName="/ppt/charts/chartEx1.xml" ContentType="application/vnd.ms-office.chartex+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>',
  extraEntries: [
    ['ppt/charts/chartEx1.xml', chart],
    ['ppt/charts/_rels/chartEx1.xml.rels', `${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${NS.r}/package" Target="../embeddings/chart-data.xlsx"/></Relationships>`],
    ['ppt/embeddings/chart-data.xlsx', workbook],
    ['ppt/media/chart-preview.png', image],
  ],
});
writeFileSync(join(root, 'fixtures/sample-chartex-fallback.pptx'), bytes);
console.log(`ChartEx 回退固件已生成：${bytes.length}B（结构来源 ${source.sha256.slice(0, 12)}，非 Office 生成文件）`);
