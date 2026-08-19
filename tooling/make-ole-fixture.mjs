/**
 * 生成 fixtures/sample-ole.pptx —— OLE 对象预览图回归文件。
 *
 * PowerPoint 把嵌入对象的渲染快照放在旧式 VML 部件里：
 *   graphicFrame/oleObj@spid → vmlDrawing 的 <v:shape id> → <v:imagedata o:relid>
 *   → 该 VML 部件自己的关系 → 媒体文件
 * 解得出预览就当普通图片渲染，解不出（例如 Mac 存的 PICT）退回占位框。
 *
 * 两页：
 *   1 OLE + 可解码的 PNG 预览 → 渲染成图片
 *   2 OLE + 认不出的扩展名     → 退回「OLE 对象」占位
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { label, makePng, makeZip, NS, nextShapeId, nvGrp, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;

const FRAME = { x: 120, y: 160, w: 460, h: 300 };

const oleFrame = (spid, id) => `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="${id}" name="Object ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(FRAME.x)}" y="${px(FRAME.y)}"/><a:ext cx="${px(FRAME.w)}" cy="${px(FRAME.h)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
<p:oleObj spid="${spid}" name="Worksheet" r:id="rId3" imgW="2971800" imgH="2374900" progId="Excel.Sheet.12">
<p:embed/></p:oleObj>
</a:graphicData></a:graphic>
</p:graphicFrame>`;

const title = (t) => sp({
  x: 40, y: 50, w: W - 80, h: 60, prst: 'rect', fill: '<a:noFill/>',
  text: `<a:p><a:r><a:rPr sz="2200" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r></a:p>`,
});

const SLIDES = [
  slideXml(title('OLE + 可解码预览图 → 渲染成图片') + oleFrame('_x0000_s1026', 21)),
  slideXml(title('OLE + 认不出的格式 → 退回占位框') + oleFrame('_x0000_s1027', 22)),
];

/** VML 部件：两个 shape 各自指向一张预览 */
const vml = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<v:shape id="_x0000_s1026" type="#_x0000_t75" style='position:absolute;left:90pt;top:120pt;width:345pt;height:225pt'>
<v:imagedata o:relid="rId1" o:title=""/></v:shape>
<v:shape id="_x0000_s1027" type="#_x0000_t75" style='position:absolute;left:90pt;top:120pt;width:345pt;height:225pt'>
<v:imagedata o:relid="rId2" o:title=""/></v:shape>
</xml>`;

const vmlRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/preview.pict"/>
</Relationships>`;

const contentTypes = `${XML}<Types xmlns="${NS.ct}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>\n<Default Extension="png" ContentType="image/png"/>\n<Default Extension="pict" ContentType="image/pict"/>\n<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>\n<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
${SLIDES.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n')}
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`;

const rootRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const presentation = `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${SLIDES.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${px(W)}" cy="${px(H)}"/>
<p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:defaultTextStyle>
</p:presentation>`;

const presentationRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${SLIDES.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('\n')}
</Relationships>`;

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="Ole">
<a:themeElements>
<a:clrScheme name="Ole">
<a:dk1><a:sysClr val="windowText" lastClr="1A1A1A"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>
<a:accent1><a:srgbClr val="2E75B6"/></a:accent1><a:accent2><a:srgbClr val="A6A6A6"/></a:accent2>
<a:accent3><a:srgbClr val="70AD47"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="ED7D31"/></a:accent5><a:accent6><a:srgbClr val="7030A0"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Ole">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Ole">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

const slideMaster = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>${nvGrp}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:buNone/><a:defRPr sz="1600"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle>
</p:txStyles>
</p:sldMaster>`;

const slideMasterRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const slideLayout = `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Blank"><p:spTree>${nvGrp}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const slideLayoutRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const slideRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/>
</Relationships>`;

const entries = [
  ['[Content_Types].xml', contentTypes],
  ['ppt/media/image1.png', makePng(120, 90, (x, y) => [(x * 2) & 255, 90, (y * 3) & 255])],
  // 认不出的扩展名：mediaUrl 会返回 null，走占位框分支
  ['ppt/media/preview.pict', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])],
  ['ppt/embeddings/oleObject1.bin', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])],
  ['ppt/drawings/vmlDrawing1.vml', vml],
  ['ppt/drawings/_rels/vmlDrawing1.vml.rels', vmlRels],
  ['_rels/.rels', rootRels],
  ['ppt/presentation.xml', presentation],
  ['ppt/_rels/presentation.xml.rels', presentationRels],
  ['ppt/theme/theme1.xml', theme],
  ['ppt/slideMasters/slideMaster1.xml', slideMaster],
  ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels],
  ['ppt/slideLayouts/slideLayout1.xml', slideLayout],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels],
];
SLIDES.forEach((xml, i) => {
  entries.push([`ppt/slides/slide${i + 1}.xml`, xml]);
  entries.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels]);
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
const zip = makeZip(entries);
writeFileSync(join(root, 'fixtures/sample-ole.pptx'), zip);
console.log(`fixtures/sample-ole.pptx 已生成（${SLIDES.length} 页，${(zip.length / 1024).toFixed(1)} KB）`);
