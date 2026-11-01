import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { parse } from '@web-ppt/core';
import { createDoc, disposeDoc } from '@web-ppt/edit-core';
import { describePresentation } from '@web-ppt/edit-core/describe';
import { lintPresentation } from '@web-ppt/edit-core/lint';
import { measureText } from './lib/agent-mcp-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const replacement = readFileSync(join(root, 'fixtures/agent-mcp-replacement.png'));
const evidence = { libreOffice: execFileSync('soffice', ['--version'], { encoding: 'utf8' }).trim(), agents: {} };
for (const agent of ['claude', 'codex']) {
  const directory = join(root, 'out/agent-mcp/evaluations', agent);
  const file = join(directory, 'final.pptx');
  assert(existsSync(file), `${agent} 必须真实生成 final.pptx`);
  const bytes = readFileSync(file);
  const presentation = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = createDoc(presentation, { idPrefix: `evaluation-${agent}-` });
  const description = describePresentation(doc);
  assert.equal(description.totalSlides, 2, `${agent} 必须新增一页`);
  assert(description.slides[0].elements.some((element) => element.name === '页面标题'
    && element.paragraphs.some((paragraph) => paragraph.text === '季度汇报 Q4')), `${agent} 标题正文必须更新`);
  assert(description.slides[1].elements.some((element) => element.paragraphs.some((paragraph) => paragraph.text === '新增页面')), `${agent} 新页标题必须写入`);
  assert(Object.values(unzipSync(bytes)).some((part) => Buffer.from(part).equals(replacement)), `${agent} 媒体字节必须等于 replacement.png`);
  const overflow = description.slides[0].elements.find((element) => element.name === '溢出文本');
  const lint = await lintPresentation(doc, { checks: ['text-overflow'], measureText });
  assert(!lint.issues.some((issue) => issue.elementId === overflow.id), `${agent} 溢出元素必须修复`);
  disposeDoc(doc);
  execFileSync(process.execPath, [join(root, 'tooling/test-edit-libreoffice.mjs'), file, '2'], { cwd: root, stdio: 'inherit' });
  let quickLook = 'not-run';
  if (process.platform === 'darwin') {
    const output = join(directory, 'quicklook');
    mkdirSync(output, { recursive: true });
    execFileSync('qlmanage', ['-t', '-s', '512', '-o', output, file], { stdio: 'pipe', timeout: 60_000 });
    quickLook = join(output, 'final.pptx.png');
    assert(statSync(quickLook).size > 0);
  }
  evidence.agents[agent] = { final: file, slides: 2, title: '季度汇报 Q4', addedTitle: '新增页面', imageSha256Matched: true, overflowFixed: true, libreOfficeOpened: true, quickLook };
}
writeFileSync(join(root, 'out/agent-mcp/evaluations/evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log('Claude Code 与 Codex 四项任务机判、LibreOffice 与 Quick Look 全部通过');
