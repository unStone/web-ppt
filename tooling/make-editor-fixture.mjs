/** 60 元素页固定住 DOM 增量更新的性能口径，避免用不断变化的展示稿做基准。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shapes = Array.from({ length: 60 }, (_, index) => {
  const column = index % 10;
  const row = Math.floor(index / 10);
  return sp({
    x: 20 + column * 124,
    y: 20 + row * 112,
    w: 112,
    h: 90,
    prst: index % 3 === 0 ? 'roundRect' : 'rect',
    fill: solid(`accent${index % 6 + 1}`),
    name: `性能形状 ${index + 1}`,
  });
}).join('');
const bytes = deck({
  name: 'Editor 60 Elements', width: 1280, height: 720, slides: [slideXml(shapes)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-60.pptx'), bytes);
console.log(`fixtures/sample-editor-60.pptx 已生成（60 元素，${(bytes.length / 1024).toFixed(1)} KB）`);
