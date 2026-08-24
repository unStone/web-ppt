/** 共享的 OOXML 打包工具：最小 Zip 写入器 + PNG 编码器 + pptx 骨架 */
import { deflateSync, zlibSync } from 'fflate';

// ---------- CRC32 / PNG ----------

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export function crc32(buf) {
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

export function makePng(w, h, pixelFn) {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) raw.set(pixelFn(x, y), row + 1 + x * 3);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export function concat(arrs) {
  const total = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ---------- Zip ----------

const enc = new TextEncoder();

export function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const compressed = deflateSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length + payload.length);
    let dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, method, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, payload.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    lh.set(payload, 30 + nameBytes.length);
    local.push(lh);

    const ch = new Uint8Array(46 + nameBytes.length);
    dv = new DataView(ch.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, method, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, payload.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);
    offset += lh.length;
  }
  const centralSize = central.reduce((a, p) => a + p.length, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, offset, true);
  return concat([...local, ...central, end]);
}

// ---------- pptx 骨架 ----------

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

export const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const EMU_PER_PX = 9525;
export const px = (v) => Math.round(v * EMU_PER_PX);

export const nvGrp = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

let shapeId = 100;
export const nextShapeId = () => ++shapeId;

/** 便捷形状构造 */
/** `bodyPr` 覆盖 txBody 的默认 <a:bodyPr anchor="ctr"/>，用于测自动缩放等文本框属性 */
export function sp({ x, y, w, h, prst = 'rect', avLst = '', fill = '', ln = '', effect = '', text = '', rot, flipH, flipV, name = 'sp', bodyPr = '', lstStyle = '' }) {
  const xfrmAttrs = [rot ? ` rot="${rot}"` : '', flipH ? ' flipH="1"' : '', flipV ? ' flipV="1"' : ''].join('');
  return `<p:sp>
<p:nvSpPr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm${xfrmAttrs}><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="${prst}"><a:avLst>${avLst}</a:avLst></a:prstGeom>${fill}${ln}${effect}</p:spPr>
<p:txBody>${bodyPr || '<a:bodyPr anchor="ctr"/>'}${lstStyle || '<a:lstStyle/>'}${text || '<a:p><a:endParaRPr/></a:p>'}</p:txBody>
</p:sp>`;
}

export function label(t, size = 900, color = '404040') {
  return `<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="${size}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r></a:p>`;
}

export const solid = (c) => `<a:solidFill>${c.startsWith('accent') || ['tx1', 'tx2', 'bg1', 'bg2'].includes(c) ? `<a:schemeClr val="${c}"/>` : `<a:srgbClr val="${c}"/>`}</a:solidFill>`;

/** `attrs` 用于给 <p:sld> 加属性，例如隐藏页的 show="0" */
export function slideXml(body, bg = '', attrs = '') {
  return `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"${attrs ? ' ' + attrs : ''}>
<p:cSld>${bg}<p:spTree>
${nvGrp}
${body}
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

// ---------- 整包脚手架 ----------

/**
 * 组装一份最小可用的 .pptx：主题 + 母版 + 版式 + 若干页。
 *
 * 早期每个 make-*.mjs 都各抄一份这套骨架。新固件统一走这里；
 * 既有生成器保持原样不动，免得为了「统一」去动它们的产物、白白搅动快照。
 *
 * 可选的扩展点（全部默认空串 / 空数组，不传时产物字节与从前完全一致）：
 * `presExtra` 插进 <p:presentation> 末尾，`presRels` 追加 presentation 的关系，
 * `extraTypes` 追加 [Content_Types] 的 Override，`extraEntries` 追加任意部件。
 */
export function deck({ name = 'Fixture', width, height, slides, presExtra = '', presRels = '', extraTypes = '', extraEntries = [] }) {
  const slideOverrides = slides.map((_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  const rel = (items) => `${XML}<Relationships xmlns="${NS.rel}">${items}</Relationships>`;
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  const entries = [
    ['[Content_Types].xml', `${XML}<Types xmlns="${NS.ct}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
${slideOverrides}${extraTypes}
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`],
    ['_rels/.rels', rel(`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>`)],
    ['ppt/presentation.xml', `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${px(width)}" cy="${px(height)}"/><p:notesSz cx="6858000" cy="9144000"/>${presExtra}</p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', rel(
      `<Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
      slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${slides.length + 2}" Type="${REL}/theme" Target="theme/theme1.xml"/>` +
      presRels)],
    ['ppt/theme/theme1.xml', `${XML}<a:theme xmlns:a="${NS.a}" name="${name}">
<a:themeElements>
<a:clrScheme name="${name}">
<a:dk1><a:sysClr val="windowText" lastClr="1A1A1A"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>
<a:accent1><a:srgbClr val="2E75B6"/></a:accent1><a:accent2><a:srgbClr val="A6A6A6"/></a:accent2>
<a:accent3><a:srgbClr val="70AD47"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="ED7D31"/></a:accent5><a:accent6><a:srgbClr val="7030A0"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="${name}">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="${name}">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`],
    ['ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
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
</p:sldMaster>`],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rel(
      `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/>`)],
    ['ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Blank"><p:spTree>${nvGrp}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rel(
      `<Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`)],
  ];
  const slideRels = rel(`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`);
  slides.forEach((xml, i) => {
    entries.push([`ppt/slides/slide${i + 1}.xml`, xml]);
    entries.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels]);
  });
  entries.push(...extraEntries);
  return makeZip(entries);
}

// ---------- CFB 复合文档写入 ----------

/**
 * 只写我们自己要读的那点结构：一个 FAT 扇区 + 目录 + 两条常规流。
 * 流一律走常规扇区（不用 MiniFAT），因此每条流必须 ≥ 4096 字节——
 * EncryptionInfo 只有几百字节，补零到 4096 即可，读取方按内部长度字段截断。
 */
export function writeCfb(streams) {
  const SECTOR = 512;
  const padded = streams.map(([name, data]) => [name, data.length < 4096
    ? Buffer.concat([data, Buffer.alloc(4096 - data.length)]) : data]);

  const dirEntries = 1 + padded.length;                 // Root + 各流
  const dirSectors = Math.ceil(dirEntries / 4);
  const streamSectors = padded.map(([, d]) => Math.ceil(d.length / SECTOR));
  const totalData = streamSectors.reduce((a, b) => a + b, 0);
  const fatEntries = 1 + dirSectors + totalData;        // FAT 自身 + 目录 + 数据
  const fatSectors = Math.ceil(fatEntries / (SECTOR / 4));

  const fat = Buffer.alloc(fatSectors * SECTOR, 0xff);
  const setFat = (i, v) => fat.writeUInt32LE(v >>> 0, i * 4);
  let next = 0;
  const fatStart = next; for (let i = 0; i < fatSectors; i++) setFat(next++, 0xfffffffd);
  const dirStart = next;
  for (let i = 0; i < dirSectors; i++) setFat(next, i === dirSectors - 1 ? 0xfffffffe : next + 1), next++;
  const starts = [];
  for (const n of streamSectors) {
    starts.push(next);
    for (let i = 0; i < n; i++) setFat(next, i === n - 1 ? 0xfffffffe : next + 1), next++;
  }

  const dir = Buffer.alloc(dirSectors * SECTOR);
  const putEntry = (idx, name, type, start, size) => {
    const off = idx * 128;
    const nm = Buffer.from(name + ' ', 'utf16le');
    nm.copy(dir, off);
    dir.writeUInt16LE(nm.length, off + 64);
    dir.writeUInt8(type, off + 66);        // 5=Root 2=Stream
    dir.writeUInt8(1, off + 67);           // color: black
    dir.writeInt32LE(-1, off + 68);        // left
    dir.writeInt32LE(-1, off + 72);        // right
    dir.writeInt32LE(type === 5 ? 1 : -1, off + 76); // child
    dir.writeUInt32LE(start >>> 0, off + 116);
    dir.writeUInt32LE(size >>> 0, off + 120);
  };
  putEntry(0, 'Root Entry', 5, 0xfffffffe, 0);
  padded.forEach(([name, data], i) => putEntry(i + 1, name, 2, starts[i], data.length));
  // 目录项之间用右兄弟串起来，读取方遍历时才能都看到
  for (let i = 1; i < dirEntries; i++) {
    dir.writeInt32LE(i + 1 < dirEntries ? i + 1 : -1, i * 128 + 72);
  }

  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 24);       // minor version
  header.writeUInt16LE(3, 26);            // major version（512 字节扇区）
  header.writeUInt16LE(0xfffe, 28);       // 小端标记
  header.writeUInt16LE(9, 30);            // 扇区大小 = 1<<9
  header.writeUInt16LE(6, 32);            // 迷你扇区大小 = 1<<6
  header.writeUInt32LE(fatSectors, 44);
  header.writeUInt32LE(dirStart, 48);
  header.writeUInt32LE(4096, 56);         // mini stream cutoff
  header.writeUInt32LE(0xfffffffe, 60);   // 无 MiniFAT
  header.writeUInt32LE(0, 64);
  header.writeUInt32LE(0xfffffffe, 68);   // 无 DIFAT 扩展
  header.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatSectors ? fatStart + i : 0xffffffff, 76 + i * 4);

  const body = [fat, dir, ...padded.map(([, d]) =>
    d.length % SECTOR ? Buffer.concat([d, Buffer.alloc(SECTOR - (d.length % SECTOR))]) : d)];
  return Buffer.concat([header, ...body]);
}
