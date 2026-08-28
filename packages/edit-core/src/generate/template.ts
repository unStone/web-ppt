const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const encoder = new TextEncoder();

const bytes = (value: string): Uint8Array => encoder.encode(value);

function emu(value: number, label: string): string {
  const result = Math.round(value * 9525);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} 超出 OOXML 安全整数范围`);
  return String(result);
}

const relationships = (body: string): string =>
  `${XML}<Relationships xmlns="${REL}">${body}</Relationships>`;

const rootGroup = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

function placeholder(
  id: number,
  name: string,
  type: string,
  rect: { x: number; y: number; w: number; h: number },
  index?: number,
): string {
  const ph = `<p:ph type="${type}"${index === undefined ? '' : ` idx="${index}"`}/>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${emu(rect.x, `${name} x`)}" y="${emu(rect.y, `${name} y`)}"/><a:ext cx="${emu(rect.w, `${name} 宽度`)}" cy="${emu(rect.h, `${name} 高度`)}"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`;
}

function slideNumberPlaceholder(
  id: number,
  fieldSerial: number,
  rect: { x: number; y: number; w: number; h: number },
): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="页码"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${emu(rect.x, '页码 x')}" y="${emu(rect.y, '页码 y')}"/><a:ext cx="${emu(rect.w, '页码宽度')}" cy="${emu(rect.h, '页码高度')}"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="r"/><a:fld id="{00000000-0000-0000-0000-${String(fieldSerial).padStart(12, '0')}}" type="slidenum"><a:rPr lang="zh-CN" sz="1100"/><a:t>1</a:t></a:fld><a:endParaRPr lang="zh-CN" sz="1100"/></a:p></p:txBody></p:sp>`;
}

function generatedLayouts(width: number, height: number) {
  const sx = width / 1280;
  const sy = height / 720;
  const scaled = (x: number, y: number, w: number, h: number) => ({
    x: x * sx, y: y * sy, w: w * sx, h: h * sy,
  });
  const number = (id: number, serial: number) =>
    slideNumberPlaceholder(id, serial, scaled(1120, 662, 96, 34));
  return [
    {
      part: 1, type: 'title', name: '标题页',
      shapes: placeholder(2, '标题', 'ctrTitle', scaled(120, 196, 1040, 154))
        + placeholder(3, '副标题', 'subTitle', scaled(200, 374, 880, 92), 1)
        + number(4, 1),
    },
    {
      part: 2, type: 'obj', name: '标题和内容',
      shapes: placeholder(2, '标题', 'title', scaled(80, 52, 1120, 92))
        + placeholder(3, '内容', 'body', scaled(96, 166, 1088, 446), 1)
        + number(4, 2),
    },
    { part: 3, type: 'blank', name: '空白', shapes: number(2, 3) },
  ] as const;
}

/** 生成保存的固定骨架只承载包级默认值；页面内容始终从 EditDoc 物化。 */
export function generatedTemplateParts(
  width: number,
  height: number,
  slideCount = 0,
  notesSlides: readonly boolean[] = [],
): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = Object.create(null);
  const hasNotes = notesSlides.some(Boolean);
  const slideTypes = Array.from({ length: slideCount }, (_, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n');
  const notesTypes = notesSlides.map((present, index) => present
    ? `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
    : '').filter(Boolean).join('\n');
  parts['[Content_Types].xml'] = bytes(`${XML}<Types xmlns="${CT}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slideTypes}
${notesTypes}
${hasNotes ? '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>' : ''}
</Types>`);
  parts['_rels/.rels'] = bytes(relationships(
    `<Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/>`,
  ));
  parts['ppt/presentation.xml'] = bytes(`${XML}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
${hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="rId${slideCount + 2}"/></p:notesMasterIdLst>` : ''}
<p:sldIdLst>${Array.from({ length: slideCount }, (_, index) =>
    `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${emu(width, '页面宽度')}" cy="${emu(height, '页面高度')}"/>
<p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`);
  parts['ppt/_rels/presentation.xml.rels'] = bytes(relationships(
    `<Relationship Id="rId1" Type="${R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
      + Array.from({ length: slideCount }, (_, index) =>
        `<Relationship Id="rId${index + 2}" Type="${R}/slide" Target="slides/slide${index + 1}.xml"/>`).join('')
      + (hasNotes
        ? `<Relationship Id="rId${slideCount + 2}" Type="${R}/notesMaster" Target="notesMasters/notesMaster1.xml"/>`
        : ''),
  ));
  parts['ppt/theme/theme1.xml'] = bytes(`${XML}<a:theme xmlns:a="${A}" name="Web PPT">
<a:themeElements><a:clrScheme name="Web PPT">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme><a:fontScheme name="Web PPT">
<a:majorFont><a:latin typeface=""/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface=""/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme><a:fmtScheme name="Web PPT">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`);
  parts['ppt/slideMasters/slideMaster1.xml'] = bytes(`${XML}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${rootGroup}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/><p:sldLayoutId id="2147483651" r:id="rId3"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  parts['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = bytes(relationships(
    `<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
      + `<Relationship Id="rId2" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>`
      + `<Relationship Id="rId3" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout3.xml"/>`
      + `<Relationship Id="rId4" Type="${R}/theme" Target="../theme/theme1.xml"/>`,
  ));
  const layouts = generatedLayouts(width, height);
  for (const layout of layouts) {
    parts[`ppt/slideLayouts/slideLayout${layout.part}.xml`] = bytes(`${XML}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="${layout.type}" showMasterSp="0">
<p:cSld name="${layout.name}"><p:spTree>${rootGroup}${layout.shapes}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    parts[`ppt/slideLayouts/_rels/slideLayout${layout.part}.xml.rels`] = bytes(relationships(
      `<Relationship Id="rId1" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`,
    ));
  }
  if (hasNotes) {
    parts['ppt/notesMasters/notesMaster1.xml'] = bytes(`${XML}<p:notesMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
<p:cSld><p:spTree>${rootGroup}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:hf/><p:notesStyle/></p:notesMaster>`);
    parts['ppt/notesMasters/_rels/notesMaster1.xml.rels'] = bytes(relationships(
      `<Relationship Id="rId1" Type="${R}/theme" Target="../theme/theme1.xml"/>`,
    ));
  }
  for (let index = 0; index < slideCount; index++) {
    parts[`ppt/slides/slide${index + 1}.xml`] = bytes(generatedEmptySlideXml());
    parts[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = bytes(relationships(
      `<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout3.xml"/>`,
    ));
  }
  return parts;
}

export function generatedEmptySlideXml(): string {
  return `${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
<p:cSld><p:spTree>${rootGroup}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
