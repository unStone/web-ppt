import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, slideXml, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shape = sp({
  x: 100, y: 100, w: 373, h: 250, name: '中英文标点',
  bodyPr: '<a:bodyPr wrap="square" anchor="t"/>',
  text: '<a:p><a:r><a:rPr sz="3465"/><a:t>数一数，画一画。 I’m ready.</a:t></a:r></a:p>',
});
const bytes = deck({
  name: 'Apostrophe', width: 1280, height: 720,
  slides: [slideXml(shape)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-apostrophe.pptx'), bytes);
console.log(`fixtures/sample-apostrophe.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
