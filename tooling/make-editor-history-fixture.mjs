/** 撤销回显必须跨页恢复选区；独立固件固定两页身份与单元素增量 DOM 边界。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = deck({
  name: 'Editor History', width: 1000, height: 600,
  slides: [
    slideXml([
      sp({ x: 90, y: 90, w: 120, h: 80, fill: solid('accent1'), name: 'history-first' }),
      sp({ x: 280, y: 90, w: 120, h: 80, fill: solid('accent3'), name: 'history-peer' }),
    ].join('')),
    slideXml(sp({
      x: 120, y: 120, w: 140, h: 90, fill: solid('accent5'), name: 'history-second-page',
    })),
  ],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-history.pptx'), bytes);
console.log(`fixtures/sample-editor-history.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
