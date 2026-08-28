/**
 * 生成最小合法 .ppt（fixtures/sample.ppt）用于测试 CFB 读取器与文本提取：
 * 512B 头 + 1 FAT 扇区 + 1 目录扇区 + PowerPoint Document 流（≥4096B，走常规 FAT）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const FREESECT = 0xffffffff;

// ---------- PowerPoint 记录流 ----------

function rec(verInst, type, body) {
  const out = new Uint8Array(8 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, verInst, true);
  dv.setUint16(2, type, true);
  dv.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

const utf16 = (s) => {
  const out = new Uint8Array(s.length * 2);
  const dv = new DataView(out.buffer);
  [...s].forEach((ch, i) => dv.setUint16(i * 2, ch.charCodeAt(0), true));
  return out;
};

const u32 = (...vals) => {
  const out = new Uint8Array(vals.length * 4);
  const dv = new DataView(out.buffer);
  vals.forEach((v, i) => dv.setUint32(i * 4, v, true));
  return out;
};

const i16 = (...vals) => {
  const out = new Uint8Array(vals.length * 2);
  const dv = new DataView(out.buffer);
  vals.forEach((v, i) => dv.setInt16(i * 2, v, true));
  return out;
};

const concat = (arrs) => {
  const total = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
};

function slideRecords(title, bodyLines) {
  return concat([
    rec(0x01, 0x03f3, new Uint8Array(20)), // SlidePersistAtom
    rec(0x00, 0x0f9f, u32(0)), // TextHeaderAtom: title
    rec(0x00, 0x0fa0, utf16(title)), // TextCharsAtom
    rec(0x00, 0x0f9f, u32(1)), // TextHeaderAtom: body
    rec(0x00, 0x0fa0, utf16(bodyLines.join('\r'))),
  ]);
}

const slideList = concat([
  slideRecords('.ppt 实验性解析', ['CFB 复合文档容器读取', 'PowerPoint Document 流记录遍历', 'SlideListWithText 文本提取']),
  slideRecords('第二页：路线图', ['OfficeArt (Escher) 图形记录解析', '样式记录 StyleTextPropAtom', '与 .pptx 共用同一渲染 Schema']),
]);

// DocumentAtom：slideSize 单位 1/576 英寸，10×7.5 英寸 = 4:3
const documentAtom = rec(0x01, 0x03e9, u32(5760, 4320, 5760, 4320, 0, 0, 0, 0, 0, 0));
const slideListContainer = rec(0x0f, 0x0ff0, slideList);
const documentContainer = rec(0x0f, 0x03e8, concat([documentAtom, slideListContainer]));

// ---------- CFB 容器 ----------

function dirEntry(name, type, start, size, color = 1) {
  const out = new Uint8Array(128);
  const dv = new DataView(out.buffer);
  [...name].forEach((ch, i) => dv.setUint16(i * 2, ch.charCodeAt(0), true));
  dv.setUint16(64, (name.length + 1) * 2, true);
  dv.setUint8(66, type);
  dv.setUint8(67, color); // black
  dv.setInt32(68, -1, true); // left sibling
  dv.setInt32(72, -1, true); // right sibling
  dv.setInt32(76, type === 5 ? 1 : -1, true); // root 的 child 指向条目 1
  dv.setUint32(116, start, true);
  dv.setUint32(120, size, true);
  return out;
}

function cfbFile(stream) {
  const streamSize = Math.max(4096, Math.ceil(stream.length / 512) * 512);
  const padded = new Uint8Array(streamSize);
  padded.set(stream);
  const streamSectors = streamSize / 512;
  const totalSectors = 2 + streamSectors; // FAT + DIR + stream
  const fat = new Uint8Array(512).fill(0xff);
  const fatView = new DataView(fat.buffer);
  fatView.setUint32(0, FATSECT, true); // sector 0: FAT 本身
  fatView.setUint32(4, ENDOFCHAIN, true); // sector 1: 目录（单扇区）
  for (let i = 0; i < streamSectors; i++) {
    fatView.setUint32((2 + i) * 4, i === streamSectors - 1 ? ENDOFCHAIN : 3 + i, true);
  }
  for (let i = totalSectors; i < 128; i++) fatView.setUint32(i * 4, FREESECT, true);

  const dirSector = new Uint8Array(512);
  dirSector.set(dirEntry('Root Entry', 5, ENDOFCHAIN, 0), 0);
  dirSector.set(dirEntry('PowerPoint Document', 2, 2, streamSize), 128);

  const header = new Uint8Array(512);
  const headerView = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  headerView.setUint16(26, 3, true); // major version 3
  headerView.setUint16(28, 0xfffe, true); // little-endian
  headerView.setUint16(30, 9, true); // sector 512
  headerView.setUint16(32, 6, true); // mini sector 64
  headerView.setUint32(44, 1, true); // FAT 扇区数
  headerView.setUint32(48, 1, true); // 目录起始扇区
  headerView.setUint32(56, 4096, true); // ministream 阈值
  headerView.setUint32(60, ENDOFCHAIN, true); // 无 miniFAT
  headerView.setUint32(64, 0, true);
  headerView.setUint32(68, ENDOFCHAIN, true); // 无额外 DIFAT
  headerView.setUint32(72, 0, true);
  headerView.setUint32(76, 0, true); // DIFAT[0] = FAT 在扇区 0
  for (let i = 1; i < 109; i++) headerView.setUint32(76 + i * 4, FREESECT, true);
  return concat([header, fat, dirSector, padded]);
}

mkdirSync(join(root, 'fixtures'), { recursive: true });
const sampleFile = cfbFile(documentContainer);
writeFileSync(join(root, 'fixtures/sample.ppt'), sampleFile);
console.log(`fixtures/sample.ppt 已生成（${sampleFile.length} 字节）`);

// 故意写入一个 MSO_SHAPE 表中不存在的 instance，防止未建模形状再次静默变成普通矩形。
const unknownShapeType = 300;
const unknownSp = rec((unknownShapeType << 4) | 0x2, 0xf00a, u32(42, 0x0a00));
const unknownAnchor = rec(0x0, 0xf010, i16(480, 600, 1800, 1200));
const unknownSpContainer = rec(0x0f, 0xf004, concat([unknownSp, unknownAnchor]));
const oleSp = rec((1 << 4) | 0x2, 0xf00a, u32(43, 0x0a10));
const oleAnchor = rec(0x0, 0xf010, i16(480, 600, 1800, 1200));
const oleSpContainer = rec(0x0f, 0xf004, concat([oleSp, oleAnchor]));
const unknownTree = rec(0x0f, 0xf003, unknownSpContainer);
const unknownDrawing = rec(0x0f, 0x040c, rec(0x0f, 0xf002, unknownTree));
const unknownSlide = rec(0x0f, 0x03ee, unknownDrawing);
const oleTree = rec(0x0f, 0xf003, oleSpContainer);
const oleDrawing = rec(0x0f, 0x040c, rec(0x0f, 0xf002, oleTree));
const oleSlide = rec(0x0f, 0x03ee, oleDrawing);
const unknownDocument = rec(0x0f, 0x03e8, documentAtom);
const unsupportedFile = cfbFile(concat([unknownDocument, unknownSlide, oleSlide]));
writeFileSync(join(root, 'fixtures/sample-ppt-unsupported.ppt'), unsupportedFile);
console.log(`fixtures/sample-ppt-unsupported.ppt 已生成（${unsupportedFile.length} 字节）`);
