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

let stream = documentContainer;
const streamSize = Math.max(4096, Math.ceil(stream.length / 512) * 512);
const padded = new Uint8Array(streamSize);
padded.set(stream);

// ---------- CFB 容器 ----------

const streamSectors = streamSize / 512;
const totalSectors = 2 + streamSectors; // FAT + DIR + stream

const fat = new Uint8Array(512).fill(0xff);
{
  const dv = new DataView(fat.buffer);
  dv.setUint32(0, FATSECT, true); // sector 0: FAT 本身
  dv.setUint32(4, ENDOFCHAIN, true); // sector 1: 目录（单扇区）
  for (let i = 0; i < streamSectors; i++) {
    dv.setUint32((2 + i) * 4, i === streamSectors - 1 ? ENDOFCHAIN : 3 + i, true);
  }
  for (let i = totalSectors; i < 128; i++) dv.setUint32(i * 4, FREESECT, true);
}

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

const dirSector = new Uint8Array(512);
dirSector.set(dirEntry('Root Entry', 5, ENDOFCHAIN, 0), 0);
dirSector.set(dirEntry('PowerPoint Document', 2, 2, streamSize), 128);

const header = new Uint8Array(512);
{
  const dv = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  dv.setUint16(26, 3, true); // major version 3
  dv.setUint16(28, 0xfffe, true); // little-endian
  dv.setUint16(30, 9, true); // sector 512
  dv.setUint16(32, 6, true); // mini sector 64
  dv.setUint32(44, 1, true); // FAT 扇区数
  dv.setUint32(48, 1, true); // 目录起始扇区
  dv.setUint32(56, 4096, true); // ministream 阈值
  dv.setUint32(60, ENDOFCHAIN, true); // 无 miniFAT
  dv.setUint32(64, 0, true);
  dv.setUint32(68, ENDOFCHAIN, true); // 无额外 DIFAT
  dv.setUint32(72, 0, true);
  dv.setUint32(76, 0, true); // DIFAT[0] = FAT 在扇区 0
  for (let i = 1; i < 109; i++) dv.setUint32(76 + i * 4, FREESECT, true);
}

const file = concat([header, fat, dirSector, padded]);
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample.ppt'), file);
console.log(`fixtures/sample.ppt 已生成（${file.length} 字节）`);
