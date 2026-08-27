/** 换版式固件：继承几何、直设位置、图片/文字占位符、备注和未知关系共存。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makePng, makeZip, NS, nvGrp, px, solid, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const files = unzipSync(new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-add-slide.pptx'))));
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`;
const run = (value, size, color = 'tx1', attrs = '', extra = '') => `<a:p><a:r><a:rPr sz="${size}"${attrs}><a:solidFill><a:schemeClr val="${color}"/></a:solidFill>${extra}</a:rPr><a:t>${value}</a:t></a:r></a:p>`;
const placeholder = ({
  id, name, type, idx, x, y, w, h, size = 1800, bullet = '', level2Size = null,
  level1Fill = '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>',
  level1Extra = '', level2ParagraphExtra = '', level2RunExtra = '', effects = '',
}) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}" idx="${idx}"/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${effects}</p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr>${bullet}<a:defRPr sz="${size}"${level2Size ? ' baseline="25000" spc="200"' : ''}>${level1Fill}${level1Extra}${level2Size ? `<a:ln w="${px(1)}"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>` : ''}</a:defRPr></a:lvl1pPr>${level2Size ? `<a:lvl2pPr marL="${px(72)}" indent="${px(-18)}">${level2ParagraphExtra}<a:buChar char="◇"/><a:defRPr sz="${level2Size}"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>${level2RunExtra}</a:defRPr></a:lvl2pPr>` : ''}</a:lstStyle>${run(`提示-${name}`, size)}</p:txBody>
</p:sp>`;

const sourceOnlyLayoutPlaceholder = placeholder({
  id: 94, name: '来源独有占位符', type: 'cust', idx: '6', x: 60, y: 610, w: 360, h: 48,
});
replace('ppt/slideLayouts/slideLayout1.xml', (xml) => xml.replace(
  '</p:spTree></p:cSld>', `${sourceOnlyLayoutPlaceholder}</p:spTree></p:cSld>`,
).replace('</p:sldLayout>', '<p:transition advTm="3000"/></p:sldLayout>'));

const targetShapes = [
  `<p:sp><p:nvSpPr><p:cNvPr id="110" name="目标版式角标"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(20, 20, 180, 42)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid('accent2')}</p:spPr></p:sp>`,
  placeholder({ id: 111, name: '目标居中标题', type: 'ctrTitle', idx: '1', x: 260, y: 46, w: 820, h: 88, size: 3600 }),
  placeholder({
    id: 112, name: '目标内容', type: 'body', idx: '22', x: 460, y: 180, w: 720,
    h: 360, size: 2200, bullet: '<a:buChar char="◆"/>', level2Size: 1800,
    level1Fill: '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent2"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>',
    level1Extra: '<a:uFill><a:solidFill><a:srgbClr val="FF00FF"/></a:solidFill></a:uFill><a:latin typeface="Target Latin"/><a:ea typeface="Target EA"/><a:cs typeface="Target CS"/>',
    level2ParagraphExtra: '<a:buClr><a:srgbClr val="00AA00"/></a:buClr><a:buFont typeface="Target Bullet"/><a:buSzPct val="80000"/>',
    level2RunExtra: '<a:latin typeface="Target Level2 Latin"/><a:ea typeface="Target Level2 EA"/><a:cs typeface="Target Level2 CS"/>',
    effects: `<a:effectLst><a:glow rad="${px(3)}"><a:srgbClr val="00FF00"/></a:glow></a:effectLst>`,
  }),
  placeholder({ id: 113, name: '目标图片', type: 'pic', idx: '4', x: 70, y: 180, w: 320, h: 260 }),
  placeholder({ id: 114, name: '目标新增副标题', type: 'subTitle', idx: '5', x: 260, y: 560, w: 820, h: 58, size: 1600 }),
  placeholder({ id: 115, name: '目标页码', type: 'sldNum', idx: '3', x: 1120, y: 670, w: 100, h: 24, size: 2100 }),
].join('');
files['ppt/slideLayouts/slideLayout2.xml'] = encoder.encode(`${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj" showMasterSp="1">
<p:cSld name="重点内容"><p:bg><p:bgPr>${solid('accent1')}<a:effectLst/></p:bgPr></p:bg><p:spTree>${nvGrp}${targetShapes}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" Requires="p14">
<p:extLst/></mc:Choice><mc:Fallback><p:transition><p:cut/></p:transition></mc:Fallback></mc:AlternateContent>
<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p200="urn:web-ppt:future" Requires="p200">
<p:transition><p200:futureEffect/></p:transition></mc:Choice><mc:Fallback>
<p:transition spd="fast"><p:push dir="r"/></p:transition></mc:Fallback></mc:AlternateContent></p:sldLayout>`);
replace('ppt/slideLayouts/_rels/slideLayout2.xml.rels', (xml) => xml.replace(
  '../slideMasters/slideMaster1.xml', '../slideMasters/slideMaster2.xml',
));

const directBody = `<p:sp><p:nvSpPr><p:cNvPr id="805" name="现有正文"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="2"/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(160, 238, 900, 260)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid('accent2')}</p:spPr>
<p:style><a:lnRef idx="0"><a:schemeClr val="accent2"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="1"><a:schemeClr val="accent2"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${run('用于验证换版式保持直设位置与格式', 2400, 'bg1', ' baseline="0" spc="0"', '<a:ln><a:noFill/></a:ln><a:uFillTx/><a:latin typeface="Source Latin"/>')}<a:p><a:pPr lvl="1"><a:buClrTx/><a:buFontTx/><a:buSzPts val="2000"/></a:pPr><a:r><a:t>二级正文沿用目标级别样式</a:t></a:r></a:p></p:txBody></p:sp>`;
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="808" name="现有图片占位符"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="4"/></p:nvPr></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>`;
const sourceOnly = `<p:sp><p:nvSpPr><p:cNvPr id="809" name="来源独有内容"/><p:cNvSpPr/><p:nvPr><p:ph type="cust" idx="6"/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(60, 610, 360, 48).replace('<a:xfrm>', '<a:xfrm rot="0" flipH="0" flipV="0">')}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${run('找不到目标占位符也不能丢', 1600)}</p:txBody></p:sp>`;
const ordinary = `<p:sp><p:nvSpPr><p:cNvPr id="810" name="普通业务形状"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr>${xfrm(980, 590, 180, 54)}<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom>${solid('accent1')}</p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>保持原位</a:t></a:r></a:p></p:txBody></p:sp>`;
const slideNumber = `<p:sp><p:nvSpPr><p:cNvPr id="811" name="动态页码"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="3"/></p:nvPr></p:nvSpPr>
<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{00000000-0000-0000-0000-000000000811}" type="slidenum"><a:rPr sz="1200"/><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp>`;
replace('ppt/slides/slide7.xml', (xml) => xml
  .replace('<p:sld xmlns:a=', '<p:sld show="0" showMasterSp="0" xmlns:a=')
  .replace('<a:rPr sz="3000"/><a:t>现有页面', '<a:rPr/><a:t>现有页面')
  .replace(/<p:sp>\s*<p:nvSpPr><p:cNvPr id="805"[\s\S]*?<\/p:sp>/, directBody)
  .replace('</p:spTree>', `${picture}${sourceOnly}${ordinary}${slideNumber}</p:spTree>`)
  .replace('</p:sld>', '<p:transition spd="slow"><p:fade/></p:transition></p:sld>'));
replace('ppt/slides/_rels/slide7.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId3" Type="${REL}/image" Target="../media/change-layout.png"/>
<Relationship Id="rId4" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide7.xml"/>
<Relationship Id="rId99" Type="urn:web-ppt:unknown" Target="../../customXml/keep.xml"/></Relationships>`));
replace('ppt/theme/theme1.xml', (xml) => xml.replace(
  '<a:effectStyle><a:effectLst/></a:effectStyle>',
  `<a:effectStyle><a:effectLst><a:outerShdw blurRad="${px(2)}" dist="${px(2)}" dir="2700000"><a:schemeClr val="phClr"/></a:outerShdw></a:effectLst></a:effectStyle>`,
));
replace('ppt/presentation.xml', (xml) => xml.replace(
  '</p:sldMasterIdLst>', '<p:sldMasterId id="2147483658" r:id="rId41"/></p:sldMasterIdLst>',
).replace('<p:extLst>', '<p:defaultTextStyle><a:defPPr><a:defRPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:defPPr></p:defaultTextStyle><p:extLst>'));
replace('ppt/_rels/presentation.xml.rels', (xml) => xml.replace(
  '</Relationships>', `<Relationship Id="rId41" Type="${REL}/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>`,
));
replace('ppt/slideMasters/slideMaster1.xml', (xml) => xml.replace(
  '<p:sldLayoutId id="2147483657" r:id="rId9"/>', '',
));
replace('ppt/slideMasters/_rels/slideMaster1.xml.rels', (xml) => xml.replace(
  `<Relationship Id="rId9" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>`, '',
));
const targetMasterMarker = `<p:sp><p:nvSpPr><p:cNvPr id="160" name="目标母版标记"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(1040, 18, 180, 28)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('accent2')}</p:spPr></p:sp>`;
files['ppt/slideMasters/slideMaster2.xml'] = encoder.encode(`${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:spTree>${nvGrp}${targetMasterMarker}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483659" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles>
</p:sldMaster>`);
files['ppt/slideMasters/_rels/slideMaster2.xml.rels'] = encoder.encode(`${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme2.xml"/></Relationships>`);
files['ppt/theme/theme2.xml'] = encoder.encode(decoder.decode(files['ppt/theme/theme1.xml'])
  .replace('name="Add Slide Theme"', 'name="Target Layout Theme"')
  .replace('val="D94F70"', 'val="0099CC"')
  .replace('val="A6A6A6"', 'val="3366CC"')
  .replace('lastClr="FFFFFF"', 'lastClr="FFF5E6"')
  .replace('typeface="Calibri"', 'typeface="Target Theme Latin"'));
replace('[Content_Types].xml', (xml) => xml.replace('</Types>',
  '<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>'));
replace('[Content_Types].xml', (xml) => xml
  .replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"')
  .replace('</Types>', '<Override PartName="/ppt/notesSlides/notesSlide7.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>'));
files['ppt/media/change-layout.png'] = makePng(64, 48, (x, y) => [30 + x * 2, 60 + y * 3, 180]);
files['ppt/notesSlides/notesSlide7.xml'] = encoder.encode(`${XML}<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>${nvGrp}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="备注正文"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${run('换版式必须保留备注', 1200)}</p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);

const bytes = makeZip(Object.entries(files));
writeFileSync(join(root, 'fixtures/sample-editor-change-layout.pptx'), bytes);
console.log(`fixtures/sample-editor-change-layout.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
