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
export function sp({ x, y, w, h, prst = 'rect', avLst = '', fill = '', ln = '', effect = '', text = '', rot, flipH, flipV, name = 'sp', bodyPr = '' }) {
  const xfrmAttrs = [rot ? ` rot="${rot}"` : '', flipH ? ' flipH="1"' : '', flipV ? ' flipV="1"' : ''].join('');
  return `<p:sp>
<p:nvSpPr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm${xfrmAttrs}><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="${prst}"><a:avLst>${avLst}</a:avLst></a:prstGeom>${fill}${ln}${effect}</p:spPr>
<p:txBody>${bodyPr || '<a:bodyPr anchor="ctr"/>'}<a:lstStyle/>${text || '<a:p><a:endParaRPr/></a:p>'}</p:txBody>
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
