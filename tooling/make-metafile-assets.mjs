import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { METAFILE_PARTS, METAFILE_SOURCE, readRequiredFile, sha256 } from './lib/metafile-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'tooling/metafile-assets');
let sourcePath = join(root, METAFILE_SOURCE.path);
let check = false;
let sourceSpecified = false;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--check' && !check) check = true;
  else if (argument === '--source-pptx' && !sourceSpecified && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    sourcePath = resolve(process.argv[++index]);
    sourceSpecified = true;
  } else throw new Error(`未知参数或缺少参数值：${argument}；支持 --check 与 --source-pptx <file>`);
}

const source = readRequiredFile(sourcePath);
const hash = sha256(source);
if (source.length !== METAFILE_SOURCE.bytes || hash !== METAFILE_SOURCE.sha256) {
  throw new Error(
    `metafile 来源基线字节数或 SHA256 不符：${sourcePath}；实际 ${source.length} / ${hash}，预期 ${METAFILE_SOURCE.bytes} / ${METAFILE_SOURCE.sha256}`,
  );
}
// 只从标准 ZIP 中提取原始媒体，不解析或重新编码 EMF/WMF。
const parts = unzipSync(source);
const assets = METAFILE_PARTS.map(({ name, part }) => {
  const bytes = parts[part];
  if (!bytes?.length) throw new Error(`metafile 来源基线缺少媒体：${sourcePath} / ${part}`);
  return { name, part, bytes: bytes.length, sha256: sha256(bytes) };
});
const manifest = `${JSON.stringify({ version: 1, generator: 'tooling/make-metafile-assets.mjs', source: METAFILE_SOURCE, assets }, null, 2)}\n`;
const files = [...METAFILE_PARTS.map(({ name, part }) => [name, parts[part]]), ['manifest.json', Buffer.from(manifest)]];
if (!check) mkdirSync(directory, { recursive: true });
for (const [name, bytes] of files) {
  const path = join(directory, name);
  if (check) {
    if (!Buffer.from(readRequiredFile(path)).equals(Buffer.from(bytes)))
      throw new Error(`canonical metafile 资产与来源基线不一致：${path}`);
  } else writeFileSync(path, bytes);
}
console.log(`canonical metafile 资产${check ? '校验通过' : '已生成'}：${assets.length} 个媒体，来源 ${METAFILE_SOURCE.commit}`);
