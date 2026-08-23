/** 生成带本地/中央 extra field 与条目注释的确定性 PPTX，专门覆盖 ZIP 词法保全。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, unzipSync } from 'fflate';
import { concat, crc32 } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = unzipSync(new Uint8Array(readFileSync(join(root, 'fixtures/sample.pptx'))));
const encoder = new TextEncoder();
const localExtra = new Uint8Array([0xfe, 0xca, 4, 0, 0x11, 0x22, 0x33, 0x44]);
const centralExtra = new Uint8Array([0xef, 0xbe, 2, 0, 0x55, 0x66]);
const entryComment = encoder.encode('web-ppt:preserve-entry-comment');
const locals = [];
const centrals = [];
let offset = 0;

for (const [index, [name, data]] of Object.entries(source).entries()) {
  const nameBytes = encoder.encode(name);
  const compressed = deflateSync(data, { level: 6 });
  const method = index % 3 === 0 ? 0 : 8;
  const payload = method === 8 ? compressed : data;
  // 一条作为脏条目验证元数据重用，另一条保持净状态验证整段本地记录直通。
  const carriesMetadata = name === '[Content_Types].xml' || name === '_rels/.rels';
  const ownLocalExtra = carriesMetadata ? localExtra : new Uint8Array();
  const ownCentralExtra = carriesMetadata ? centralExtra : new Uint8Array();
  const ownComment = carriesMetadata ? entryComment : new Uint8Array();
  const checksum = crc32(data);

  const local = new Uint8Array(30 + nameBytes.length + ownLocalExtra.length + payload.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0x0800, true);
  localView.setUint16(8, method, true);
  localView.setUint16(10, 0, true);
  localView.setUint16(12, 0x0021, true);
  localView.setUint32(14, checksum, true);
  localView.setUint32(18, payload.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  localView.setUint16(28, ownLocalExtra.length, true);
  local.set(nameBytes, 30);
  local.set(ownLocalExtra, 30 + nameBytes.length);
  local.set(payload, 30 + nameBytes.length + ownLocalExtra.length);
  locals.push(local);

  const central = new Uint8Array(46 + nameBytes.length + ownCentralExtra.length + ownComment.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 0x031e, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0x0800, true);
  centralView.setUint16(10, method, true);
  centralView.setUint16(12, 0, true);
  centralView.setUint16(14, 0x0021, true);
  centralView.setUint32(16, checksum, true);
  centralView.setUint32(20, payload.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint16(30, ownCentralExtra.length, true);
  centralView.setUint16(32, ownComment.length, true);
  centralView.setUint32(38, name.endsWith('/') ? 0x10 : 0, true);
  centralView.setUint32(42, offset, true);
  central.set(nameBytes, 46);
  central.set(ownCentralExtra, 46 + nameBytes.length);
  central.set(ownComment, 46 + nameBytes.length + ownCentralExtra.length);
  centrals.push(central);
  offset += local.length;
}

const centralSize = centrals.reduce((total, bytes) => total + bytes.length, 0);
const end = new Uint8Array(22);
const endView = new DataView(end.buffer);
endView.setUint32(0, 0x06054b50, true);
endView.setUint16(8, centrals.length, true);
endView.setUint16(10, centrals.length, true);
endView.setUint32(12, centralSize, true);
endView.setUint32(16, offset, true);

writeFileSync(join(root, 'fixtures/sample-zip-passthrough.pptx'), concat([...locals, ...centrals, end]));
