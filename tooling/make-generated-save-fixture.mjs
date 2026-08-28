/** 生成式保存来源固件：从有原包的 PPTX 建模后释放原包，验证纯 Schema 重建。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  deck, label, makePng, makeWav, makeZip, NS, nvGrp, px, slideXml, solid, sp, XML,
} from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shape = sp({
  x: 96, y: 88, w: 430, h: 188, prst: 'roundRect',
  avLst: '<a:gd name="adj" fmla="val 24000"/>',
  fill: solid('4472C4'),
  ln: '<a:ln w="19050"><a:solidFill><a:srgbClr val="203864"/></a:solidFill><a:prstDash val="dash"/><a:round/></a:ln>',
  text: label('生成保存 · 中英 Mixed', 1800, 'FFFFFF'),
  name: '生成形状', bodyPr: '<a:bodyPr anchor="ctr" lIns="91440" rIns="91440"/>',
}).replace('name="生成形状"/>',
  'name="生成形状"><a:hlinkClick r:id="rId4"/></p:cNvPr>')
  .replace('<a:rPr sz="1800">', '<a:rPr sz="1800"><a:hlinkClick r:id="rId4"/>');
const image = `<p:pic>
<p:nvPicPr><p:cNvPr id="201" name="生成图片"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:srcRect l="4000" t="8000" r="12000" b="16000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm rot="600000"><a:off x="${px(620)}" y="${px(92)}"/><a:ext cx="${px(310)}" cy="${px(176)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
const imageFillShape = sp({
  x: 980, y: 92, w: 220, h: 176, prst: 'ellipse', name: '生成图片填充',
  fill: '<a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="85000"/></a:blip><a:srcRect l="5000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
});
const freeform = `<p:sp><p:nvSpPr><p:cNvPr id="203" name="生成自由形状"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(980)}" y="${px(330)}"/><a:ext cx="${px(220)}" cy="${px(220)}"/></a:xfrm>
<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${px(220)}" h="${px(220)}"><a:moveTo><a:pt x="0" y="${px(110)}"/></a:moveTo><a:lnTo><a:pt x="${px(110)}" y="0"/></a:lnTo><a:quadBezTo><a:pt x="${px(180)}" y="${px(20)}"/><a:pt x="${px(220)}" y="${px(110)}"/></a:quadBezTo><a:arcTo wR="${px(110)}" hR="${px(110)}" stAng="0" swAng="10800000"/><a:close/></a:path></a:pathLst></a:custGeom>
${solid('F97316')}<a:ln w="12700"><a:solidFill><a:srgbClr val="7C2D12"/></a:solidFill></a:ln></p:spPr></p:sp>`;
const audio = `<p:pic><p:nvPicPr><p:cNvPr id="204" name="生成音频"/><p:cNvPicPr/><p:nvPr><a:audioFile r:link="rId5"/></p:nvPr></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(980)}" y="${px(590)}"/><a:ext cx="${px(220)}" cy="${px(80)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const background = '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="12000"/></a:blip><a:tile sx="180000" sy="180000" flip="none"/></a:blipFill><a:effectLst/></p:bgPr></p:bg>';

const cell = (text, fill) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${label(text, 1400, '1F2937')}</a:txBody><a:tcPr>${solid(fill)}</a:tcPr></a:tc>`;
const table = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="202" name="生成表格"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(96)}" y="${px(350)}"/><a:ext cx="${px(834)}" cy="${px(220)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="${px(417)}"/><a:gridCol w="${px(417)}"/></a:tblGrid>
<a:tr h="${px(110)}">${cell('表头 A', 'DBEAFE')}${cell('表头 B', 'DBEAFE')}</a:tr>
<a:tr h="${px(110)}">${cell('内容 1', 'FFFFFF')}${cell('内容 2', 'F8FAFC')}</a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

const source = deck({
  name: 'Generated Save', width: 1280, height: 720,
  slides: [slideXml(shape + image + imageFillShape + table + freeform + audio, background)],
});
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const files = unzipSync(source);
files['[Content_Types].xml'] = encoder.encode(decoder.decode(files['[Content_Types].xml'])
  .replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="wav" ContentType="audio/wav"/><Default Extension="xml"')
  .replace('</Types>', '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/></Types>'));
files['ppt/slides/_rels/slide1.xml.rels'] = encoder.encode(decoder.decode(files['ppt/slides/_rels/slide1.xml.rels'])
  .replace('</Relationships>', `<Relationship Id="rId2" Type="${REL}/image" Target="../media/generated.png"/><Relationship Id="rId3" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rId4" Type="${REL}/hyperlink" Target="https://example.com/generated" TargetMode="External"/><Relationship Id="rId5" Type="${REL}/audio" Target="../media/generated.wav"/></Relationships>`));
files['ppt/media/generated.png'] = makePng(48, 32,
  (x, y) => [(x * 5 + 30) % 256, (y * 7 + 70) % 256, (x * 3 + y * 5 + 110) % 256]);
files['ppt/media/generated.wav'] = makeWav();
files['ppt/notesMasters/notesMaster1.xml'] = encoder.encode(`${XML}<p:notesMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>${nvGrp}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/></p:notesMaster>`);
files['ppt/notesMasters/_rels/notesMaster1.xml.rels'] = encoder.encode(`${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`);
files['ppt/notesSlides/notesSlide1.xml'] = encoder.encode(`${XML}<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>${nvGrp}<p:sp><p:nvSpPr><p:cNvPr id="2" name="备注正文"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>生成备注第一行</a:t></a:r></a:p><a:p><a:r><a:rPr sz="1400" b="1"/><a:t>生成备注第二行</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
files['ppt/notesSlides/_rels/notesSlide1.xml.rels'] = encoder.encode(`${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${REL}/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="${REL}/slide" Target="../slides/slide1.xml"/></Relationships>`);

const output = makeZip(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-generated-save.pptx'), output);
console.log(`fixtures/sample-generated-save.pptx 已生成（${(output.length / 1024).toFixed(1)} KB）`);
