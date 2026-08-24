/** 新增页固件：两种真实版式、高位 OPC 身份、section 与未知扩展共同守住写回边界。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeZip, NS, nvGrp, px, slideXml, solid, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`;
const text = (value, size = 1800) => `<a:p><a:r><a:rPr sz="${size}"/><a:t>${value}</a:t></a:r></a:p>`;
const actionShape = ({ id, name, x, y, rid = '', action = 'ppaction://hlinkshowjump?jump=nextslide' }) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${id}" name="${name}"><a:hlinkClick${rid ? ` r:id="${rid}"` : ''} action="${action}"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr>${xfrm(x, y, 24, 24)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
</p:sp>`;
const placeholder = ({ id, name, type, idx, x, y, w, h, prompt = '', content = '', ownXfrm = true }) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}" idx="${idx}"/></p:nvPr></p:nvSpPr>
<p:spPr>${ownXfrm ? xfrm(x, y, w, h) : ''}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>${text(content || prompt, type === 'title' ? 3000 : 1800)}</p:txBody>
</p:sp>`;

const pageNumberPlaceholder = `<p:sp>
<p:nvSpPr><p:cNvPr id="92" name="页码占位符"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="3"/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(40, 675, 60, 24)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>第 </a:t></a:r><a:fld xmlns:fixture="urn:web-ppt:add-slide" fixture:type="KEEP-TYPE" id="{00000000-0000-0000-0000-000000000092}" type="slidenum"><a:rPr sz="1200"/><a:t>99</a:t></a:fld><a:r><a:rPr sz="1200"/><a:t> 页</a:t></a:r></a:p></p:txBody>
<p:extLst><p:ext uri="{ADD-SLIDE-FIELD}"><fixture:fld xmlns:fixture="urn:web-ppt:add-slide" type="slidenum"><fixture:t>KEEP-FIELD</fixture:t></fixture:fld></p:ext></p:extLst>
</p:sp>`;

const titleLayout = [
  `<p:sp><p:nvSpPr><p:cNvPr id="70" name="版式色带"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 1280, 18)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('accent1')}</p:spPr></p:sp>`,
  actionShape({ id: 71, name: '版式下一页链接', x: 1220, y: 20 }),
  placeholder({ id: 90, name: '标题占位符', type: 'title', idx: '1', x: 80, y: 80, w: 1120, h: 100, prompt: '单击此处添加标题' }),
  placeholder({ id: 91, name: '正文占位符', type: 'body', idx: '2', x: 120, y: 220, w: 1040, h: 390, prompt: '单击此处添加正文' }),
  pageNumberPlaceholder,
  placeholder({ id: 93, name: '图片占位符', type: 'pic', idx: '4', x: 1040, y: 620, w: 120, h: 40, prompt: '单击此处添加图片' }),
].join('');

const sourceSlide = slideXml([
  placeholder({ id: 801, name: '现有标题', type: 'title', idx: '1', x: 0, y: 0, w: 0, h: 0, content: '现有页面', ownXfrm: false }),
  placeholder({ id: 805, name: '现有正文', type: 'body', idx: '2', x: 0, y: 0, w: 0, h: 0, content: '用于验证新增页插入位置', ownXfrm: false }),
  actionShape({ id: 806, name: '现有页下一页链接', x: 1240, y: 680 }),
  actionShape({ id: 807, name: '现有页自身链接', x: 1200, y: 680, rid: 'rId2', action: 'ppaction://hlinksldjump' }),
].join(''));

const sectionExtension = `<p:extLst><p:ext uri="{ADD-SLIDE-SECTION}">
<fixture:sectionLst xmlns:fixture="urn:web-ppt:add-slide"><fixture:section><fixture:sldIdLst><fixture:sldId id="KEEP-SECTION"/></fixture:sldIdLst></fixture:section></fixture:sectionLst>
<p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
<p14:section name="第一节" id="{11111111-1111-1111-1111-111111111111}"><p14:sldIdLst><p14:sldId xmlns:fixture="urn:web-ppt:add-slide" fixture:id="999" id="900"/></p14:sldIdLst></p14:section>
</p14:sectionLst><fixture:keep xmlns:fixture="urn:web-ppt:add-slide" value="presentation-tail"/>
</p:ext></p:extLst>`;

const source = deck({
  name: 'Add Slide Theme', width: 1280, height: 720, slides: [sourceSlide],
  layoutShapes: titleLayout,
  masterShapes: `<p:sp><p:nvSpPr><p:cNvPr id="60" name="母版标记"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(1180, 660, 60, 24)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid('accent2')}</p:spPr></p:sp>`,
  presExtra: sectionExtension,
  presRels: `<Relationship Id="rId77" Type="urn:web-ppt:unknown" Target="../customXml/keep.xml"/>`,
  extraTypes: '<Override PartName="/customXml/keep.xml" ContentType="application/x-web-ppt-keep+xml"/>',
  extraEntries: [['customXml/keep.xml', `${XML}<keep xmlns="urn:web-ppt:add-slide">原位保留</keep>`]],
});

const files = unzipSync(source);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
replace('ppt/presentation.xml', (xml) => xml
  .replace('<p:sldId id="256" r:id="rId2"/>', '<p:sldId id="900" r:id="rId40"/>'));
replace('ppt/_rels/presentation.xml.rels', (xml) => xml
  .replace('Id="rId2" Type="' + REL + '/slide" Target="slides/slide1.xml"',
    'Target="slides/slide7.xml" Type="' + REL + '/slide" Id="rId40"'));
replace('ppt/slideMasters/slideMaster1.xml', (xml) => xml
  .replace('<p:sldLayoutId id="2147483649" r:id="rId1"/>',
    '<p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483657" r:id="rId9"/>'));
replace('ppt/slideMasters/_rels/slideMaster1.xml.rels', (xml) => xml
  .replace('</Relationships>', `<Relationship Id="rId9" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>`));
replace('ppt/slideLayouts/slideLayout1.xml', (xml) => xml
  .replace('type="obj"', 'type="tx"').replace('name="Blank"', 'name="标题和正文"'));
replace('[Content_Types].xml', (xml) => xml
  .replace('</Types>', '<Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>'));
replace('ppt/theme/theme1.xml', (xml) => xml
  .replace('<a:accent1><a:srgbClr val="2E75B6"/></a:accent1>', '<a:accent1><a:srgbClr val="D94F70"/></a:accent1>'));

files['ppt/slideLayouts/slideLayout2.xml'] = encoder.encode(`${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" showMasterSp="0">
<p:cSld name="空白"><p:spTree>${nvGrp}<p:sp><p:nvSpPr><p:cNvPr id="95" name="空白版式角标"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(32, 648, 180, 32)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid('accent1')}</p:spPr></p:sp></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
files['ppt/slideLayouts/_rels/slideLayout2.xml.rels'] = encoder.encode(`${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
files['ppt/slides/slide7.xml'] = files['ppt/slides/slide1.xml'];
files['ppt/slides/_rels/slide7.xml.rels'] = files['ppt/slides/_rels/slide1.xml.rels'];
replace('ppt/slides/_rels/slide7.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId2" Type="${REL}/slide" Target="slide7.xml"/></Relationships>`));
delete files['ppt/slides/slide1.xml'];
delete files['ppt/slides/_rels/slide1.xml.rels'];

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-add-slide.pptx'), bytes);
console.log(`fixtures/sample-editor-add-slide.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
