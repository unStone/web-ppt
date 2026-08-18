/**
 * 生成测试用 sample.pptx（fixtures/sample.pptx），覆盖渲染器主要能力：
 * 母版/版式继承、主题色、渐变、预设/自定义几何、文本样式、项目符号、表格、图片、组合、旋转/翻转、不支持对象占位。
 */
import { deflateSync, zlibSync } from 'fflate';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 最小 PNG 编码器（无外部依赖） ----------

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function makePng(w, h, pixelFn) {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

const image1 = makePng(96, 72, (x, y) => {
  if ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0) return [68, 114, 196, 255].slice(0, 3);
  return [Math.round((x / 96) * 255), Math.round((y / 72) * 255), 180];
});

// ---------- OOXML 各 part ----------

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const contentTypes = `${XML}<Types xmlns="${NS.ct}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`;

const rootRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const presentation = `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>
<p:sldId id="256" r:id="rId2"/>
<p:sldId id="257" r:id="rId3"/>
<p:sldId id="258" r:id="rId4"/>
</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:defaultTextStyle>
</p:presentation>`;

const presentationRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`;

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="Fixture">
<a:themeElements>
<a:clrScheme name="Fixture">
<a:dk1><a:sysClr val="windowText" lastClr="1A1A1A"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2>
<a:lt2><a:srgbClr val="EEF3FB"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Fixture">
<a:majorFont><a:latin typeface="Trebuchet MS"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Fixture">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

const nvGrpBoilerplate = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const slideMaster = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:bg><p:bgPr><a:gradFill><a:gsLst>
<a:gs pos="0"><a:srgbClr val="F7FAFF"/></a:gs>
<a:gs pos="100000"><a:srgbClr val="DDE7F7"/></a:gs>
</a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
${nvGrpBoilerplate}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="AccentBar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="6667500"/><a:ext cx="12192000" cy="190500"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
<a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="4" name="Body Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle>
<a:lvl1pPr algn="l"><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr>
</p:titleStyle>
<p:bodyStyle>
<a:lvl1pPr marL="342900" indent="-342900"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buChar char="•"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr>
<a:lvl2pPr marL="742950" indent="-285750"><a:spcBef><a:spcPts val="400"/></a:spcBef><a:buChar char="–"/><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl2pPr>
</p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
</p:txStyles>
</p:sldMaster>`;

const slideMasterRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const slideLayout = `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Layout1">
<p:spTree>
${nvGrpBoilerplate}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const slideLayoutRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const slideRelsBase = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

// 页 1：占位符继承（标题/正文都不写 xfrm，从母版继承位置和字号）
const slide1 = `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:spTree>
${nvGrpBoilerplate}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:t>Web PPT 渲染引擎</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:t>纯浏览器解析 OOXML（fflate + DOMParser），零服务端依赖</a:t></a:r></a:p>
<a:p><a:pPr lvl="1"/><a:r><a:t>形状 / 渐变 / 图片 / 表格 / 组合 / 母版继承</a:t></a:r></a:p>
<a:p><a:pPr lvl="1"/><a:r><a:t>统一 Schema，渲染层与解析层解耦</a:t></a:r></a:p>
<a:p><a:r><a:t>混排：</a:t></a:r><a:r><a:rPr b="1"/><a:t>加粗</a:t></a:r><a:r><a:rPr i="1"/><a:t> 斜体 </a:t></a:r><a:r><a:rPr u="sng"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:rPr><a:t>主题色下划线</a:t></a:r><a:r><a:rPr sz="1400"/><a:t> 小字号</a:t></a:r></a:p>
</p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

// 页 2：形状全家桶（渐变、旋转、翻转、透明度、虚线、custGeom、项目符号）
const slide2 = `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
${nvGrpBoilerplate}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="RoundRect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="600000" y="500000"/><a:ext cx="3000000" cy="1600000"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent5"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>渐变圆角矩形</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Ellipse"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="4100000" y="500000"/><a:ext cx="2300000" cy="1600000"/></a:xfrm>
<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
<a:solidFill><a:schemeClr val="accent2"/></a:solidFill>
<a:ln w="38100"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:ln></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1600"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>椭圆+描边</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="4" name="Star"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="6900000" y="400000"/><a:ext cx="1800000" cy="1800000"/></a:xfrm>
<a:prstGeom prst="star5"><a:avLst/></a:prstGeom>
<a:solidFill><a:schemeClr val="accent4"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="5" name="Arrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm rot="1200000"><a:off x="9200000" y="700000"/><a:ext cx="2300000" cy="1000000"/></a:xfrm>
<a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom>
<a:solidFill><a:schemeClr val="accent6"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
<p:cxnSp>
<p:nvCxnSpPr><p:cNvPr id="6" name="Line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
<p:spPr><a:xfrm><a:off x="600000" y="2500000"/><a:ext cx="11000000" cy="0"/></a:xfrm>
<a:prstGeom prst="line"><a:avLst/></a:prstGeom>
<a:ln w="28575"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill><a:prstDash val="sysDash"/></a:ln></p:spPr>
</p:cxnSp>
<p:sp>
<p:nvSpPr><p:cNvPr id="7" name="Bullets"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="600000" y="2800000"/><a:ext cx="5400000" cy="3400000"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>字符项目符号第一条</a:t></a:r></a:p>
<a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>第二条，带换行</a:t></a:r><a:br/><a:r><a:rPr sz="1400"/><a:t>（软换行后的小字）</a:t></a:r></a:p>
<a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>自动编号一</a:t></a:r></a:p>
<a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>自动编号二</a:t></a:r></a:p>
<a:p><a:pPr algn="r"/><a:r><a:rPr sz="1600" strike="sngStrike"/><a:t>右对齐删除线</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="8" name="FlippedTriangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm flipV="1"><a:off x="6600000" y="3000000"/><a:ext cx="1900000" cy="1500000"/></a:xfrm>
<a:prstGeom prst="triangle"><a:avLst/></a:prstGeom>
<a:solidFill><a:schemeClr val="accent5"><a:alpha val="60000"/></a:schemeClr></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="9" name="CustGeom"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="9000000" y="2900000"/><a:ext cx="2400000" cy="3000000"/></a:xfrm>
<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="100" b="100"/>
<a:pathLst><a:path w="100" h="100">
<a:moveTo><a:pt x="55" y="0"/></a:moveTo>
<a:lnTo><a:pt x="100" y="55"/></a:lnTo>
<a:lnTo><a:pt x="68" y="55"/></a:lnTo>
<a:lnTo><a:pt x="80" y="100"/></a:lnTo>
<a:lnTo><a:pt x="0" y="42"/></a:lnTo>
<a:lnTo><a:pt x="42" y="42"/></a:lnTo>
<a:close/>
</a:path></a:pathLst></a:custGeom>
<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

// 页 3：表格、图片（含裁剪）、组合、不支持对象占位
const slide3 = `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:spTree>
${nvGrpBoilerplate}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>表格 · 图片 · 组合</a:t></a:r></a:p></p:txBody>
</p:sp>
<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="700000" y="1900000"/><a:ext cx="5600000" cy="2400000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
<a:tbl>
<a:tblPr/><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="1800000"/><a:gridCol w="1800000"/></a:tblGrid>
<a:tr h="800000">
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>能力</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>.pptx</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>.ppt</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr></a:tc>
</a:tr>
<a:tr h="800000">
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"/><a:t>形状渲染</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"/><a:t>支持</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="E9F0E4"/></a:solidFill></a:tcPr></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"/><a:t>路线图</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
</a:tr>
<a:tr h="800000">
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"/><a:t>文本提取</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"/><a:t>支持</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="E9F0E4"/></a:solidFill></a:tcPr></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"/><a:t>实验性</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="FBF3D9"/></a:solidFill></a:tcPr></a:tc>
</a:tr>
</a:tbl>
</a:graphicData></a:graphic>
</p:graphicFrame>
<p:pic>
<p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="6800000" y="1900000"/><a:ext cx="2300000" cy="1725000"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>
<p:pic>
<p:nvPicPr><p:cNvPr id="5" name="CroppedPicture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:srcRect l="25000" t="25000" r="25000" b="25000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="9500000" y="1900000"/><a:ext cx="1725000" cy="1725000"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>
<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="6" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="6800000" y="4100000"/><a:ext cx="4400000" cy="1700000"/><a:chOff x="0" y="0"/><a:chExt cx="2200000" cy="850000"/></a:xfrm></p:grpSpPr>
<p:sp>
<p:nvSpPr><p:cNvPr id="7" name="GroupRect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="850000"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
<a:solidFill><a:schemeClr val="accent5"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>组合内 A</a:t></a:r></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="8" name="GroupEllipse"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1200000" y="0"/><a:ext cx="1000000" cy="850000"/></a:xfrm>
<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
<a:solidFill><a:schemeClr val="accent6"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>组合内 B</a:t></a:r></a:p></p:txBody>
</p:sp>
</p:grpSp>
<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="9" name="ChartStub"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="700000" y="4600000"/><a:ext cx="5600000" cy="1500000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic>
</p:graphicFrame>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const slide3Rels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

// ---------- 打包（stored + deflate 混合，走 fflate 的 zip 需要浏览器 API，这里手写最小 Zip） ----------

const enc = new TextEncoder();

function crc32Of(data) {
  return crc32(data);
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const compressed = deflateSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32Of(data);

    const local = new Uint8Array(30 + nameBytes.length + payload.length);
    let dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, method, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, payload.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(payload, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    dv = new DataView(central.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, method, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, payload.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }
  const centralSize = centralParts.reduce((a, p) => a + p.length, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const zip = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, end]) {
    zip.set(p, pos);
    pos += p.length;
  }
  return zip;
}

const zip = makeZip([
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rootRels],
  ['ppt/presentation.xml', presentation],
  ['ppt/_rels/presentation.xml.rels', presentationRels],
  ['ppt/theme/theme1.xml', theme],
  ['ppt/slideMasters/slideMaster1.xml', slideMaster],
  ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels],
  ['ppt/slideLayouts/slideLayout1.xml', slideLayout],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels],
  ['ppt/slides/slide1.xml', slide1],
  ['ppt/slides/_rels/slide1.xml.rels', slideRelsBase],
  ['ppt/slides/slide2.xml', slide2],
  ['ppt/slides/_rels/slide2.xml.rels', slideRelsBase],
  ['ppt/slides/slide3.xml', slide3],
  ['ppt/slides/_rels/slide3.xml.rels', slide3Rels],
  ['ppt/media/image1.png', image1],
]);

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample.pptx'), zip);
console.log(`fixtures/sample.pptx 已生成（${zip.length} 字节）`);
