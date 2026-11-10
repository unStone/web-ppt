import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, readImageMetadata } from '@web-ppt/core';
import { createDoc, disposeDoc, sourceAsset, sourcePartBytes } from '@web-ppt/edit-core';
import { describePresentation } from '@web-ppt/edit-core/describe';
import { LAYOUT_CHECKS, lintPresentation } from '@web-ppt/edit-core/lint';
import { TASKS, createTaskPrompt, getTask } from './agent-eval/tasks.mjs';
import { buildFixture, buildReferenceSolution } from './agent-eval/fixtures.mjs';
import { createTemplateFillMeasurement, verifyTemplateFillFonts } from './lib/template-fill-measurement.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'tooling/agent-eval/fixtures');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
verifyTemplateFillFonts(root, assert);
const measureText = createTemplateFillMeasurement(root);
assert.equal(TASKS.length, 8);
assert.equal(new Set(TASKS.map((task) => task.id)).size, TASKS.length);
assert.deepEqual(TASKS.map((task) => task.kind).sort(), ['clean', ...LAYOUT_CHECKS].sort());
assert.throws(() => getTask('unknown-evaluation-task'), /unknown-evaluation-task/);
assert.throws(() => buildFixture('unknown-evaluation-task'), /unknown-evaluation-task/);
assert.throws(() => buildReferenceSolution('unknown-evaluation-task'), /unknown-evaluation-task/);
assert.throws(() => createTaskPrompt(TASKS[0].id, null), /inputPath.*outputPath/);
assert.throws(() => createTaskPrompt(TASKS[0].id, { inputPath: '', outputPath: 'result.pptx' }), /inputPath/);
assert.throws(() => createTaskPrompt(TASKS[0].id, { inputPath: 'source.pptx', outputPath: '' }), /outputPath/);
assert.throws(() => createTaskPrompt(TASKS[0].id, { inputPath: 'same.pptx', outputPath: 'same.pptx' }), /different/);
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);

for (const task of TASKS) {
  assert.equal(getTask(task.id), task);
  assert.equal(task.minFontSize, 12);
  const prompt = createTaskPrompt(task.id, { inputPath: '/input/source.pptx', outputPath: '/output/result.pptx' });
  assert(prompt.includes(task.expectedTitle));
  assert(prompt.includes('positions and sizes') && prompt.includes('opaque foreground'));
  assert(prompt.includes('/input/source.pptx') && prompt.includes('/output/result.pptx'));
  assert(!prompt.includes(task.kind), `${task.id} 的提示不应直接给出问题分类`);
  const inputs = [buildFixture(task.id), buildFixture(task.id)];
  const references = [buildReferenceSolution(task.id), buildReferenceSolution(task.id)];
  assert.deepEqual(inputs[0], inputs[1], `${task.id} 同进程输入必须确定性`);
  assert.deepEqual(references[0], references[1], `${task.id} 同进程参考必须确定性`);
  assert.deepEqual(readFileSync(join(directory, task.fixtureName)), Buffer.from(inputs[0]));
  assert.deepEqual(readFileSync(join(directory, task.referenceName)), Buffer.from(references[0]));
  const recorded = manifest.tasks.find((item) => item.id === task.id);
  assert.equal(recorded.inputSha256, hash(inputs[0]));
  assert.equal(recorded.referenceSha256, hash(references[0]));
  const opened = [];
  try {
    for (const [label, bytes] of [
      ['input', inputs[0]],
      ['reference', references[0]],
    ]) {
      const presentation = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
      const doc = createDoc(presentation, { idPrefix: 'eval-fixture-' });
      opened.push(doc);
      const description = describePresentation(doc);
      assert.equal(description.width, 720);
      assert.equal(description.height, 405);
      assert.equal(description.totalSlides, 1);
      assert.equal(description.totalElements, 4);
      const elements = description.slides[0].elements;
      assert.deepEqual(
        elements.map((element) => element.name),
        ['Evaluation title', 'Evaluation body', 'Evaluation image', 'Evaluation card'],
      );
      assert(elements.every((element) => !element.hidden && !element.locked));
      const title = elements.find((element) => element.name === task.titleName);
      assert(title.placeholder?.layout, `${task.id} 必须有真实版式提示来源`);
      const image = doc.elements[elements.find((element) => element.kind === 'image').id].src;
      const asset = sourceAsset(doc, image.src);
      assert(asset && asset.mime === 'image/png');
      const metadata = readImageMetadata(asset.bytes);
      assert.equal(metadata.width / metadata.height, 2);
      const options = { fonts: { available: [task.fontFamily], embedded: [] }, measureText };
      if (label === 'reference') {
        assert.equal(title.paragraphs.map((paragraph) => paragraph.text).join('\n'), task.expectedTitle);
        const report = await lintPresentation(doc, options);
        assert.deepEqual(report.checks, [...LAYOUT_CHECKS]);
        assert.deepEqual(report.issues, [], `${task.id} 参考必须七项零问题`);
      } else if (task.kind === 'clean') {
        assert.deepEqual((await lintPresentation(doc, options)).issues, []);
      } else {
        const report = await lintPresentation(doc, { ...options, checks: [task.kind] });
        assert(
          report.issues.some((issue) => issue.reason === task.kind),
          `${task.id} 必须真实触发目标检查`,
        );
      }
    }
    const [input, reference] = opened;
    const inputDescription = describePresentation(input),
      referenceDescription = describePresentation(reference);
    assert.deepEqual(
      inputDescription.slides[0].elements.map((element) => element.id),
      referenceDescription.slides[0].elements.map((element) => element.id),
    );
    for (const part of ['ppt/theme/theme1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']) {
      assert.deepEqual(sourcePartBytes(input, part), sourcePartBytes(reference, part), `${task.id} 设计资源不得改变`);
    }
    const imageBytes = (doc) => {
      const element = describePresentation(doc).slides[0].elements.find((item) => item.kind === 'image');
      return sourceAsset(doc, doc.elements[element.id].src.src).bytes;
    };
    assert.deepEqual(imageBytes(input), imageBytes(reference));
  } finally {
    for (const doc of opened) disposeDoc(doc);
  }
}
console.log('Agent eval 八类任务、真实七项正反例、字体/媒体/设计资源与双次字节确定性通过');
