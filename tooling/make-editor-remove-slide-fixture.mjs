/** 页面删除固件：稳定页身份、notes、共享媒体、section 与未知内容共同守住最小清理。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, NS, nvGrp, px, slideXml, solid, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const IDS = [801, 905, 1201, 4090];
const RIDS = ['rId31', 'rId77', 'rId103', 'rId205'];

const pageField = (index) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${20 + index}" name="页码 ${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(1120)}" y="${px(650)}"/><a:ext cx="${px(100)}" cy="${px(30)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{10000000-0000-0000-0000-00000000000${index}}" type="slidenum"><a:rPr sz="1200"/><a:t>${index}</a:t></a:fld></a:p></p:txBody>
</p:sp>`;
const nextLink = (index) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${30 + index}" name="下一页 ${index}"><a:hlinkClick action="ppaction://hlinkshowjump?jump=nextslide"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(1180)}" y="${px(40)}"/><a:ext cx="${px(40)}" cy="${px(40)}"/></a:xfrm><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom>${solid('accent2')}</p:spPr>
</p:sp>`;
const sharedPicture = (index) => `<p:pic>
<p:nvPicPr><p:cNvPr id="${40 + index}" name="共享像素 ${index}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId8"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(40)}" y="${px(630)}"/><a:ext cx="${px(24)}" cy="${px(24)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
const slide = (index) => slideXml(`<p:sp>
<p:nvSpPr><p:cNvPr id="${10 + index}" name="页面 ${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(120)}" y="${px(160)}"/><a:ext cx="${px(1040)}" cy="${px(260)}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid(`accent${index}`)}</p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="3600" b="1"/><a:t>可删除页面 ${index}</a:t></a:r></a:p></p:txBody>
</p:sp>${pageField(index)}${nextLink(index)}${sharedPicture(index)}`);

const sectionExtension = `<p:extLst><p:ext uri="{REMOVE-SLIDE-SECTIONS}">
<p14:sectionLst xmlns:p14="${P14}">
<p14:section xmlns:fixture="urn:web-ppt:remove-slide" fixture:keep="SECTION-A" name="前两页" id="{11111111-1111-1111-1111-111111111111}"><p14:sldIdLst><p14:sldId fixture:keep="MEMBER-A" id="801"/><p14:sldId id="905"/></p14:sldIdLst></p14:section>
<p14:section name="后两页" id="{22222222-2222-2222-2222-222222222222}"><p14:sldIdLst><p14:sldId id="1201"/><p14:sldId id="4090"/></p14:sldIdLst></p14:section>
</p14:sectionLst><fixture:keep xmlns:fixture="urn:web-ppt:remove-slide" value="presentation-tail"/>
</p:ext></p:extLst>`;

const bytes = deck({
  name: 'Remove Slide Theme', width: 1280, height: 720,
  slides: [1, 2, 3, 4].map(slide), presExtra: sectionExtension,
  presRels: '<Relationship Id="rId300" Type="urn:web-ppt:unknown" Target="../customXml/keep.xml"/>',
  extraTypes: '<Default Extension="png" ContentType="image/png"/>'
    + [1, 2, 3, 4].map((index) =>
      `<Override PartName="/ppt/notesSlides/notesSlide${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('')
    + '<Override PartName="/ppt/charts/chartKeep.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
    + '<Override PartName="/ppt/comments/commentKeep.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"/>'
    + '<Override PartName="/ppt/notesMasters/notesMasterKeep.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
    + '<Override xmlns:fixture="urn:web-ppt:remove-slide" fixture:keep="TYPE-TAIL" PartName="/customXml/keep.xml" ContentType="application/x-web-ppt-keep+xml"/>',
  extraEntries: [
    ['ppt/media/shared.png', makePng(1, 1, () => [33, 150, 243])],
    ['customXml/keep.xml', `${XML}<keep xmlns="urn:web-ppt:remove-slide">原位保留</keep>`],
    ['ppt/charts/chartKeep.xml', `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>`],
    ['ppt/comments/commentKeep.xml', `${XML}<p:cmLst xmlns:p="${NS.p}"><p:cm authorId="42" idx="7"><p:pos x="100" y="200"/><p:text>只保留不级联</p:text></p:cm></p:cmLst>`],
    ['ppt/notesMasters/notesMasterKeep.xml', `${XML}<p:notesMaster xmlns:a="${NS.a}" xmlns:p="${NS.p}"><p:cSld><p:spTree>${nvGrp}</p:spTree></p:cSld></p:notesMaster>`],
  ],
});

const files = unzipSync(bytes);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
replace('ppt/presentation.xml', (xml) => IDS.reduce((value, id, index) => value
  .replace(`id="${256 + index}" r:id="rId${index + 2}"`,
    `xmlns:fixture="urn:web-ppt:remove-slide" fixture:slot="${index + 1}" id="${id}" r:id="${RIDS[index]}"`), xml));
replace('ppt/_rels/presentation.xml.rels', (xml) => RIDS.reduce((value, rid, index) => value
  .replace(`Id="rId${index + 2}" Type="${REL}/slide"`, `Id="${rid}" Type="${REL}/slide"`), xml));

const notes = (index) => `${XML}<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:spTree>${nvGrp}<p:sp><p:nvSpPr><p:cNvPr id="2" name="备注"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>页面 ${index} 的独立备注</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;
for (let index = 1; index <= 4; index++) {
  replace(`ppt/slides/_rels/slide${index}.xml.rels`, (xml) => xml.replace('</Relationships>',
    `<Relationship Id="rId8" Type="${REL}/image" Target="../media/shared.png"/><Relationship Id="rId9" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${index}.xml"/>${index === 2 ? `<Relationship Id="rId96" Type="${REL}/comments" Target="../comments/commentKeep.xml"/><Relationship Id="rId97" Type="${REL}/chart" Target="../charts/chartKeep.xml"/><Relationship Id="rId99" Type="urn:web-ppt:unknown" Target="../../customXml/keep.xml"/>` : ''}</Relationships>`));
  files[`ppt/notesSlides/notesSlide${index}.xml`] = encoder.encode(notes(index));
  files[`ppt/notesSlides/_rels/notesSlide${index}.xml.rels`] = encoder.encode(`${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${REL}/hyperlink" Target="https://example.com/note/${index}" TargetMode="External"/>${index === 2 ? `<Relationship Id="rId2" Type="${REL}/notesMaster" Target="../notesMasters/notesMasterKeep.xml"/>` : ''}</Relationships>`);
}

const output = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-remove-slide.pptx'), output);
console.log(`fixtures/sample-editor-remove-slide.pptx 已生成（${(output.length / 1024).toFixed(1)} KB）`);

// 畸形文件可能让两个页面共享 notes；保存器只能按活动引用判断所有权，不能盲删关系目标。
const sharedNotesFiles = { ...files };
sharedNotesFiles['ppt/slides/_rels/slide3.xml.rels'] = encoder.encode(
  decoder.decode(sharedNotesFiles['ppt/slides/_rels/slide3.xml.rels'])
    .replace('../notesSlides/notesSlide3.xml', '../notesSlides/notesSlide2.xml'),
);
const sharedNotesOutput = makeZip(Object.entries(sharedNotesFiles));
writeFileSync(join(root, 'fixtures/sample-editor-remove-slide-shared-notes.pptx'), sharedNotesOutput);
console.log(`fixtures/sample-editor-remove-slide-shared-notes.pptx 已生成（${(sharedNotesOutput.length / 1024).toFixed(1)} KB）`);
