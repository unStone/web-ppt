/** 页面重排固件：高位页身份、两个 section、页码/跳页、notes 与未知扩展共同守住最小写回。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeZip, NS, nvGrp, px, slideXml, solid, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const IDS = [900, 905, 990];
const RIDS = ['rId40', 'rId72', 'rId101'];

const field = (index) => `<a:fld id="{00000000-0000-0000-0000-00000000000${index}}" type="slidenum"><a:rPr sz="1200"/><a:t>${index}</a:t></a:fld>`;
const textPageField = (index) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${20 + index}" name="页码文本框 ${index}"/><p:cNvSpPr/><p:nvPr>${index === 3 ? '<p:ph type="sldNum" idx="9"/>' : ''}</p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(1120)}" y="${px(650)}"/><a:ext cx="${px(100)}" cy="${px(30)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${field(index)}</a:p></p:txBody>
</p:sp>`;
const tablePageField = (index) => `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="${20 + index}" name="页码表格 ${index}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(1120)}" y="${px(650)}"/><a:ext cx="${px(100)}" cy="${px(30)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr/><a:tblGrid><a:gridCol w="${px(100)}"/></a:tblGrid><a:tr h="${px(30)}"><a:tc>
<a:txBody><a:bodyPr/><a:lstStyle/><a:p>${field(index)}</a:p></a:txBody><a:tcPr/>
</a:tc></a:tr></a:tbl></a:graphicData></a:graphic>
</p:graphicFrame>`;
const pageField = (index) => index === 2 ? tablePageField(index) : textPageField(index);
const nextLink = (index) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${30 + index}" name="下一页 ${index}"><a:hlinkClick action="ppaction://hlinkshowjump?jump=nextslide"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(1180)}" y="${px(40)}"/><a:ext cx="${px(40)}" cy="${px(40)}"/></a:xfrm><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom>${solid('accent2')}</p:spPr>
</p:sp>`;
const slide = (index) => slideXml(`<p:sp>
<p:nvSpPr><p:cNvPr id="${10 + index}" name="页面 ${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(120)}" y="${px(160)}"/><a:ext cx="${px(1040)}" cy="${px(260)}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid(`accent${index}`)}</p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="3600" b="1"/><a:t>稳定页面 ${index}</a:t></a:r></a:p></p:txBody>
</p:sp>${pageField(index)}${nextLink(index)}`);

const sectionExtension = `<p:extLst><p:ext uri="{MOVE-SLIDE-SECTIONS}">
<p14:sectionLst xmlns:p14="${P14}">
<p14:section name="前两页" id="{11111111-1111-1111-1111-111111111111}"><p14:sldIdLst><p14:sldId xmlns:fixture="urn:web-ppt:move-slide" fixture:keep="A" id="900"/><p14:sldId id="905"/></p14:sldIdLst></p14:section>
<p14:section name="末页" id="{22222222-2222-2222-2222-222222222222}"><p14:sldIdLst><p14:sldId id="990"/></p14:sldIdLst></p14:section>
</p14:sectionLst><fixture:keep xmlns:fixture="urn:web-ppt:move-slide" value="presentation-tail"/>
</p:ext></p:extLst>`;

const bytes = deck({
  name: 'Move Slide Theme', width: 1280, height: 720,
  slides: [slide(1), slide(2), slide(3)], presExtra: sectionExtension,
  presRels: '<Relationship Id="rId120" Type="urn:web-ppt:unknown" Target="../customXml/keep.xml"/>',
  extraTypes: [1, 2, 3].map((index) =>
    `<Override PartName="/ppt/notesSlides/notesSlide${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('')
    + '<Override PartName="/customXml/keep.xml" ContentType="application/x-web-ppt-keep+xml"/>',
  extraEntries: [['customXml/keep.xml', `${XML}<keep xmlns="urn:web-ppt:move-slide">原位保留</keep>`]],
});

const files = unzipSync(bytes);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
replace('ppt/presentation.xml', (xml) => IDS.reduce((value, id, index) => value
  .replace(`id="${256 + index}" r:id="rId${index + 2}"`,
    `xmlns:fixture="urn:web-ppt:move-slide" fixture:slot="${index + 1}" id="${id}" r:id="${RIDS[index]}"`), xml));
replace('ppt/_rels/presentation.xml.rels', (xml) => RIDS.reduce((value, rid, index) => value
  .replace(`Id="rId${index + 2}" Type="${REL}/slide"`, `Id="${rid}" Type="${REL}/slide"`), xml));

const notes = (index) => `${XML}<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:spTree>${nvGrp}<p:sp><p:nvSpPr><p:cNvPr id="2" name="备注"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>页面 ${index} 的备注不可变化</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;
for (let index = 1; index <= 3; index++) {
  replace(`ppt/slides/_rels/slide${index}.xml.rels`, (xml) => xml.replace('</Relationships>',
    `<Relationship Id="rId9" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${index}.xml"/></Relationships>`));
  files[`ppt/notesSlides/notesSlide${index}.xml`] = encoder.encode(notes(index));
}

const output = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-move-slide.pptx'), output);
console.log(`fixtures/sample-editor-move-slide.pptx 已生成（${(output.length / 1024).toFixed(1)} KB）`);
