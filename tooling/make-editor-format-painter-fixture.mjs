/** 格式刷固件：跨页继承、显式空格式、对象类型、富文本与未知 XML。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  deck, makePng, makeZip, px, slideXml, solid, sp,
} from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const richText = `<a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPct val="140000"/></a:lnSpc></a:pPr>
<a:r><a:rPr lang="zh-CN" sz="2600" b="1" i="1" u="sng" strike="sngStrike"><a:latin typeface="Aptos"/></a:rPr><a:t>来源</a:t></a:r>
<a:r><a:rPr lang="zh-CN" sz="2600" b="1" i="1" u="sng" strike="sngStrike"><a:latin typeface="Aptos"/></a:rPr><a:t>多 run</a:t></a:r></a:p>
<a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPct val="140000"/></a:lnSpc></a:pPr>
<a:r><a:rPr lang="zh-CN" sz="2600" b="1" i="1" u="sng" strike="sngStrike"><a:latin typeface="Aptos"/></a:rPr><a:t>第二段</a:t></a:r></a:p>`;
const source = sp({
  x: 45, y: 45, w: 280, h: 150, name: 'format-source', text: richText,
  bodyPr: '<a:bodyPr anchor="b" lIns="28575" tIns="38100" rIns="47625" bIns="57150" wrap="none" numCol="2" spcCol="76200"/>',
  fill: '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="2563EB"/></a:gs><a:gs pos="100000"><a:srgbClr val="F97316"><a:alpha val="65000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>',
  ln: '<a:ln w="28575" cap="rnd" cmpd="sng"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:prstDash val="dash"/><a:round/></a:ln>',
  effect: '<a:effectLst><a:glow rad="28575"><a:srgbClr val="7C3AED"/></a:glow><a:softEdge rad="9525"/></a:effectLst><a:extLst><a:ext uri="{WEB-PPT-FORMAT-SOURCE}"><fixture:keep xmlns:fixture="urn:web-ppt:format-painter" value="source-adjacent"/></a:ext></a:extLst>',
});
const localTarget = sp({
  x: 365, y: 45, w: 280, h: 150, name: 'format-target-local',
  fill: solid('accent4'), text: '<a:p><a:r><a:rPr sz="1400"/><a:t>目标内容不变</a:t></a:r></a:p>',
  effect: '<a:extLst><a:ext uri="{WEB-PPT-FORMAT-TARGET}"><fixture:keep xmlns:fixture="urn:web-ppt:format-painter" value="target-adjacent"/></a:ext></a:extLst>',
});
const emptySource = sp({
  x: 685, y: 45, w: 230, h: 150, name: 'format-empty-source',
  fill: '<a:noFill/>', ln: '<a:ln><a:noFill/></a:ln>', effect: '<a:effectLst/>',
  text: '<a:p><a:r><a:t>无填充 / 无描边 / 空效果</a:t></a:r></a:p>',
});
const picture = `<p:pic>
<p:nvPicPr><p:cNvPr id="2901" name="format-picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(45)}" y="${px(245)}"/><a:ext cx="${px(210)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></a:ln></p:spPr>
</p:pic>`;
const imageFillShape = sp({
  x: 45, y: 400, w: 210, h: 95, name: 'format-image-fill-shape',
  fill: '<a:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
  text: '<a:p><a:r><a:t>图片填充不属于格式</a:t></a:r></a:p>',
});
const child = sp({ x: 15, y: 15, w: 180, h: 75, name: 'format-group-child', fill: solid('accent5') });
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="2902" name="format-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(295)}" y="${px(245)}"/><a:ext cx="${px(240)}" cy="${px(120)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(210)}" cy="${px(105)}"/></a:xfrm>
<a:effectLst><a:outerShdw blurRad="38100" dist="19050" dir="2700000"><a:srgbClr val="111827"><a:alpha val="45000"/></a:srgbClr></a:outerShdw></a:effectLst></p:grpSpPr>
${child}</p:grpSp>`;
const cell = (text, color) => `<a:tc><a:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p>
</a:txBody><a:tcPr/></a:tc>`;
const table = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="2903" name="format-table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(575)}" y="${px(245)}"/><a:ext cx="${px(340)}" cy="${px(120)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr/><a:tblGrid><a:gridCol w="${px(170)}"/><a:gridCol w="${px(170)}"/></a:tblGrid>
<a:tr h="${px(120)}">${cell('单元格 A', 'DC2626')}${cell('单元格 B', '059669')}</a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

const style = `<p:style><a:lnRef idx="2"><a:schemeClr val="accent2"/></a:lnRef>
<a:fillRef idx="2"><a:schemeClr val="accent2"/></a:fillRef>
<a:effectRef idx="1"><a:schemeClr val="accent2"/></a:effectRef>
<a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>`;
const crossTarget = sp({
  x: 90, y: 90, w: 330, h: 180, name: 'format-target-cross-page',
  text: '<a:p><a:r><a:rPr sz="1600"/><a:t>跨页目标内容</a:t></a:r></a:p>',
}).replace('</p:spPr>\n<p:txBody>', `</p:spPr>${style}<p:txBody>`);
const secondNeighbor = sp({
  x: 500, y: 90, w: 260, h: 180, name: 'format-second-neighbor', fill: solid('accent6'),
  text: '<a:p><a:r><a:t>未编辑的相邻元素</a:t></a:r></a:p>',
});
const pageTwo = slideXml(crossTarget + secondNeighbor).replace(
  '<a:masterClrMapping/>',
  '<a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent6" accent2="accent5" accent3="accent4" accent4="accent3" accent5="accent2" accent6="accent1" hlink="hlink" folHlink="folHlink"/>',
);
const files = unzipSync(deck({
  name: 'Editor Format Painter', width: 960, height: 540,
  slides: [slideXml(source + localTarget + emptySource + picture + group + table + imageFillShape), pageTwo],
}));
const replace = (part, transform) => {
  files[part] = encoder.encode(transform(decoder.decode(files[part])));
};
replace('ppt/slides/_rels/slide1.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId20" Type="${REL}/image" Target="../media/format-painter.png"/></Relationships>`));
replace('[Content_Types].xml', (xml) => xml.replace('<Default Extension="xml"',
  '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'));
files['ppt/media/format-painter.png'] = makePng(48, 32,
  (x, y) => [(x * 5) % 256, (y * 8) % 256, ((x + y) * 4) % 256]);

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-format-painter.pptx'), bytes);
console.log(`fixtures/sample-editor-format-painter.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
