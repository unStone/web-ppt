import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** 多入口构建会提取公共块；按每个静态依赖文件计费，不能把入口文件变小误报成减重。 */
export function moduleClosure(entry) {
  const files = new Map();
  const visit = file => {
    if (files.has(file)) return;
    const bytes = readFileSync(file), source = bytes.toString('utf8');
    files.set(file, { bytes, source });
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      visit(resolve(dirname(file), match[1]));
    }
  };
  visit(resolve(entry));
  return { files: [...files.keys()], source: [...files.values()].map(file => file.source).join('\n'),
    raw: [...files.values()].reduce((sum, file) => sum + file.bytes.length, 0),
    gzip: [...files.values()].reduce((sum, file) => sum + gzipSync(file.bytes).length, 0) };
}
