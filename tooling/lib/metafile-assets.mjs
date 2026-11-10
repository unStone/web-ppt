import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';

// 固定既有基线来源，避免本机 LibreOffice 版本与字体改变固件覆盖内容。
export const METAFILE_SOURCE = Object.freeze({
  commit: '88c8df92ee853fa2dc45a413fa38316527b20025',
  path: 'fixtures/sample-metafile.pptx',
  bytes: 580673,
  sha256: '8f042fece7c31a68f832bdd2d6bfb8c491d9f3a101b71120a928778931efa99b',
  description: '项目自有 showcase 演示稿在既有固件中的 EMF/WMF 导出媒体',
});
export const METAFILE_PARTS = Object.freeze([
  Object.freeze({ name: 'showcase.emf', part: 'ppt/media/image1.emf' }),
  Object.freeze({ name: 'showcase.wmf', part: 'ppt/media/image2.wmf' }),
]);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function readRequiredFile(path) {
  if (!existsSync(path)) throw new Error(`缺少 canonical metafile 文件：${path}`);
  return readFileSync(path);
}

export function readCanonicalMetafiles(directory) {
  const manifestPath = join(directory, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readRequiredFile(manifestPath).toString('utf8'));
  } catch (cause) {
    throw new Error(`无法读取 canonical metafile JSON 清单 ${manifestPath}：${cause.message}`, { cause });
  }
  if (
    manifest?.version !== 1
    || manifest.generator !== 'tooling/make-metafile-assets.mjs'
    || !isDeepStrictEqual(manifest.source, METAFILE_SOURCE)
    || !Array.isArray(manifest.assets)
    || manifest.assets.length !== METAFILE_PARTS.length
  ) {
    throw new Error(`canonical metafile 清单无效：${manifestPath}；预期版本 1、固定来源和两个媒体`);
  }
  return Object.fromEntries(
    METAFILE_PARTS.map(({ name, part }, index) => {
      const entry = manifest.assets[index];
      if (
        !entry
        || entry.name !== name
        || entry.part !== part
        || !Number.isSafeInteger(entry.bytes)
        || entry.bytes <= 0
        || typeof entry.sha256 !== 'string'
        || !/^[0-9a-f]{64}$/.test(entry.sha256)
      ) {
        throw new Error(`canonical metafile 资产记录无效：${manifestPath}；预期 ${name} / ${part} 的字节数和 SHA256`);
      }
      const path = join(directory, name);
      const bytes = readRequiredFile(path);
      if (bytes.length !== entry.bytes)
        throw new Error(`canonical metafile 字节数不符：${path}；实际 ${bytes.length}，预期 ${entry.bytes}`);
      const hash = sha256(bytes);
      if (hash !== entry.sha256) throw new Error(`canonical metafile SHA256 不符：${path}；实际 ${hash}，预期 ${entry.sha256}`);
      return [name, bytes];
    }),
  );
}
