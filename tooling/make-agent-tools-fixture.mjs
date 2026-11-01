import { writeFileSync } from 'node:fs';
import { deck, label, slideXml, sp } from './lib/ooxml.mjs';

const title = sp({
  name: '页面标题', x: 40, y: 30, w: 300, h: 60, text: label('可编辑标题'),
}).replace('<p:nvPr/>', '<p:nvPr><p:ph type="title" idx="7"/></p:nvPr>');
const outside = sp({ name: '越界证据', x: 620, y: 280, w: 80, h: 40, text: label('越界') });
const second = sp({ name: '第二页文字', x: 40, y: 40, w: 300, h: 40, text: label('第二页') });

writeFileSync(new URL('../fixtures/sample-agent-tools.pptx', import.meta.url), deck({
  name: 'Agent tools', width: 640, height: 360,
  slides: [slideXml(title + outside), slideXml(second)],
}));
