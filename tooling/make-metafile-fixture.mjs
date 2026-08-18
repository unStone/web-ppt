/** 在 showcase 之外单独生成一个内嵌 EMF/WMF 的 pptx，用于端到端验证图元文件解码 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dirname, join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip, NS, XML, px, nvGrp, sp, solid, label, slideXml } from './lib/ooxml.mjs';

const root = pjoin(dirname(fileURLToPath(import.meta.url)), '..');
const emfPath = pjoin(root, 'out/metafile/showcase.emf');
const wmfPath = pjoin(root, 'out/metafile/showcase.wmf');
if (!existsSync(emfPath)) {
  console.log('跳过：先运行 node tooling/test-metafile.mjs 生成 EMF/WMF 样本');
  process.exit(0);
}
const emf = readFileSync(emfPath);
const wmf = existsSync(wmfPath) ? readFileSync(wmfPath) : emf;

const W = 1280, H = 720;
const pic = (id, rid, x, y, w, h, name) => `<p:pic>
<p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

const slide1 = slideXml(
  sp({ x: 24, y: 14, w: 800, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"/><a:t>EMF / WMF 矢量图元文件</a:t></a:r></a:p>` }) +
  pic(10, 'rId2', 30, 60, 600, 340, 'emf') +
  sp({ x: 30, y: 405, w: 600, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label('EMF（增强型图元文件）', 1000) }) +
  pic(11, 'rId3', 650, 60, 600, 340, 'wmf') +
  sp({ x: 650, y: 405, w: 600, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label('WMF（Windows 图元文件）', 1000) }) +
  sp({ x: 30, y: 450, w: 1220, h: 60, prst: 'roundRect', fill: solid('accent1'),
       text: `<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1300"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>两张图都由浏览器端解码为 SVG，无服务端参与</a:t></a:r></a:p>` }),
);

const ct = `${XML}<Types xmlns="${NS.ct}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="emf" ContentType="image/x-emf"/>
<Default Extension="wmf" ContentType="image/x-wmf"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`;

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="T"><a:themeElements>
<a:clrScheme name="T"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="EEF3FB"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="T"><a:majorFont><a:latin typeface="Helvetica"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="T"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const master = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${nvGrp}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const layout = `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Blank"><p:spTree>${nvGrp}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const rel = (items) => `${XML}<Relationships xmlns="${NS.rel}">${items}</Relationships>`;

writeFileSync(join(root, 'fixtures/sample-metafile.pptx'), makeZip([
  ['[Content_Types].xml', ct],
  ['_rels/.rels', rel(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>`)],
  ['ppt/presentation.xml', `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="${px(W)}" cy="${px(H)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
  ['ppt/_rels/presentation.xml.rels', rel(
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>`)],
  ['ppt/theme/theme1.xml', theme],
  ['ppt/slideMasters/slideMaster1.xml', master],
  ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rel(
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>`)],
  ['ppt/slideLayouts/slideLayout1.xml', layout],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rel(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`)],
  ['ppt/slides/slide1.xml', slide1],
  ['ppt/slides/_rels/slide1.xml.rels', rel(
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.wmf"/>`)],
  ['ppt/media/image1.emf', emf],
  ['ppt/media/image2.wmf', wmf],
]));
console.log('fixtures/sample-metafile.pptx 已生成');
