import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'fixtures/zip-security');
mkdirSync(directory, { recursive: true });
const base = unzipSync(readFileSync(join(root, 'fixtures/sample.pptx')));
const write = (name, parts) =>
  writeFileSync(join(directory, name), makeZip(Object.entries(parts).sort(([left], [right]) => left.localeCompare(right))));
const copy = () => ({ ...base });

write('sample-zip-bomb.pptx', { ...copy(), 'ppt/media/bomb.bin': new Uint8Array(16 * 1024 * 1024) });
write('sample-zip-entry-count.pptx', {
  ...copy(),
  'ppt/security/1.txt': new Uint8Array(1),
  'ppt/security/2.txt': new Uint8Array(1),
  'ppt/security/3.txt': new Uint8Array(1),
  'ppt/security/4.txt': new Uint8Array(1),
});
write('sample-zip-duplicate-case.pptx', { ...copy(), 'PPT/PRESENTATION.XML': base['ppt/presentation.xml'] });
write('sample-zip-duplicate-separator.pptx', { ...copy(), 'ppt\\presentation.xml': base['ppt/presentation.xml'] });
write('sample-zip-traversal.pptx', { ...copy(), '../evil.xml': new Uint8Array(1) });

const forgedParts = copy();
forgedParts['[Content_Types].xml'] = new Uint8Array(8 * 1024 * 1024).fill(120);
const forged = makeZip(Object.entries(forgedParts).sort(([left], [right]) => left.localeCompare(right)));
const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
const name = '[Content_Types].xml';
const decoder = new TextDecoder();
let localUpdated = false;
let centralUpdated = false;
for (let offset = 0; offset + 30 <= forged.length; offset++) {
  const signature = view.getUint32(offset, true);
  if (signature === 0x04034b50) {
    const length = view.getUint16(offset + 26, true);
    if (decoder.decode(forged.subarray(offset + 30, offset + 30 + length)) === name) {
      view.setUint32(offset + 22, 16, true);
      localUpdated = true;
    }
  } else if (signature === 0x02014b50) {
    const length = view.getUint16(offset + 28, true);
    if (decoder.decode(forged.subarray(offset + 46, offset + 46 + length)) === name) {
      view.setUint32(offset + 24, 16, true);
      centralUpdated = true;
    }
  }
}
if (!localUpdated || !centralUpdated) throw new Error('伪造大小固件未找到目标本地头与中央目录');
writeFileSync(join(directory, 'sample-zip-forged-size.pptx'), forged);

const zip64 = readFileSync(join(root, 'fixtures/sample.pptx'));
const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
let zip64End = -1;
for (let offset = zip64.length - 22; offset >= 0; offset--) {
  if (zip64View.getUint32(offset, true) === 0x06054b50) {
    zip64End = offset;
    break;
  }
}
if (zip64End < 0) throw new Error('ZIP64 固件缺少 EOCD');
zip64View.setUint16(zip64End + 10, 0xffff, true);
writeFileSync(join(directory, 'sample-zip-64.pptx'), zip64);

const invalidEnd = readFileSync(join(root, 'fixtures/sample.pptx'));
writeFileSync(join(directory, 'sample-zip-invalid-eocd.pptx'), Buffer.concat([invalidEnd, Buffer.from([0])]));
console.log('ZIP 安全固件已生成');
