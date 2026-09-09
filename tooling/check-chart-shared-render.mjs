import assert from 'node:assert/strict';
import { mixedRenderCases } from './lib/chart-shared-mixed-render-contract.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve('out/chart-shared');
if (process.argv[2] === '--worker') {
  const core = process.argv.includes('--dist') ? await import('@web-ppt/core')
    : (await import(pathToFileURL(`${out}/contract.mjs`))).core;
  const name = process.argv[3], presentation = await core.parse(readFileSync(`${out}/${name}.pptx`), { keepPackage: true, lazy: false });
  const result = [];
  for (const [index, slide] of presentation.slides.entries()) for (const textMode of ['html', 'svg']) {
    // 生成保存会重分配形状编号；仅去掉不参与绘制的寻址属性，保留全部绘制结构与样式。
    const svg = core.renderSlideToSvg(presentation, slide, { textMode }).replace(/ data-el="[^"]*"/g, '');
    writeFileSync(`${out}/${name}-${index + 1}-${textMode}.svg`, svg);
    result.push({ page: index + 1, textMode, bytes: Buffer.byteLength(svg), sha256: createHash('sha256').update(svg).digest('hex') });
  }
  presentation.dispose(); process.stdout.write(JSON.stringify(result));
} else {
  const reports = [];
  const run = name => JSON.parse(execFileSync(process.execPath, [import.meta.filename, '--worker', name,
    ...(process.argv.includes('--dist') ? ['--dist'] : [])], { encoding: 'utf8' }));
  const cases = [...JSON.parse(readFileSync('tooling/chart-shared-cases.json', 'utf8')),
    ...mixedRenderCases.map(name => ({ stem: `render-${name}` }))];
  for (const { stem } of cases) {
    const patched = run(`${stem}-patched`), generated = run(`${stem}-generated`);
    assert.deepEqual(patched, generated, `${stem} 共享结构编辑的两种保存路径渲染相同`);
    reports.push({ stem, patched, generated });
  }
  writeFileSync(`${out}/render-proof.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(`共享结构编辑：独立进程 ${reports.reduce((count, report) => count + report.patched.length, 0)} 对 SVG 仅移除 data-el 寻址属性后逐字节一致`);
}
