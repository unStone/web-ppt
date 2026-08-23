/** ZIP 元数据可能变化；按解压 part 区分演示内容差异与容器差异。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { equalBytes } from './lib/bytes.mjs';

export function diffPackageBytes(beforeBytes, afterBytes) {
  const before = unzipSync(beforeBytes);
  const after = unzipSync(afterBytes);
  const beforeNames = new Set(Object.keys(before));
  const afterNames = new Set(Object.keys(after));
  const added = [...afterNames].filter((name) => !beforeNames.has(name)).sort();
  const removed = [...beforeNames].filter((name) => !afterNames.has(name)).sort();
  const changed = [...beforeNames]
    .filter((name) => afterNames.has(name) && !equalBytes(before[name], after[name]))
    .sort();
  return { equal: !added.length && !removed.length && !changed.length, added, removed, changed };
}

function report(diff) {
  if (diff.equal) return '包内全部 part 解压内容相同';
  const lines = [];
  for (const name of diff.added) lines.push(`+ ${name}`);
  for (const name of diff.removed) lines.push(`- ${name}`);
  for (const name of diff.changed) lines.push(`~ ${name}`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error('用法: node tooling/diff-package.mjs <before.pptx> <after.pptx>');
    process.exitCode = 2;
  } else {
    const diff = diffPackageBytes(
      new Uint8Array(readFileSync(beforePath)),
      new Uint8Array(readFileSync(afterPath)),
    );
    console.log(report(diff));
    if (!diff.equal) process.exitCode = 1;
  }
}
