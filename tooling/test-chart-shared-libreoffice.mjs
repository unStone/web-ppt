import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, posix } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

const out = resolve('out/chart-shared'), soffice = process.env.SOFFICE ?? '/Applications/LibreOffice.app/Contents/MacOS/soffice';
const inputs = resolve(process.env.CHART_SHARED_INPUTS ?? out);
const cases = process.env.CHART_SHARED_CASES ?? 'tooling/chart-shared-cases.json';
const report = resolve(process.env.CHART_SHARED_REPORT ?? join(out, 'libreoffice.json'));
const c = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const r = 'http://schemas.openxmlformats.org/package/2006/relationships';
const snapshot = bytes => {
  const parts = unzipSync(bytes), windows = [];
  const xml = part => {
    const window = new JSDOM(strFromU8(parts[part]), { contentType: 'text/xml' }).window;
    windows.push(window); return window.document;
  };
  const nodes = (parent, localName) => [...parent.getElementsByTagNameNS(c, localName)];
  const points = cache => cache ? nodes(cache, 'pt').map(point => [Number(point.getAttribute('idx')), point.textContent]) : [];
  const relationships = [...xml('ppt/_rels/presentation.xml.rels').getElementsByTagNameNS(r, 'Relationship')];
  const slides = [...xml('ppt/presentation.xml').getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId')];
  const result = slides.flatMap(slide => {
    const id = slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const source = posix.normalize(posix.join('ppt', relationships.find(rel => rel.getAttribute('Id') === id).getAttribute('Target')));
    const relations = [...xml(source.replace(/([^/]+)$/, '_rels/$1.rels')).getElementsByTagNameNS(r, 'Relationship')];
    return nodes(xml(source), 'chart').map(frame => {
      const id = frame.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = relations.find(node => node.getAttribute('Id') === id);
      const part = posix.normalize(posix.join('ppt/slides', rel.getAttribute('Target')));
      return nodes(xml(part), 'ser').map(series => {
      const cache = nodes(series, 'multiLvlStrCache')[0];
      const numeric = ['val', 'xVal', 'yVal', 'bubbleSize'].map(field => {
        const block = nodes(series, field)[0];
        return block ? nodes(block, 'numCache')[0] ?? nodes(block, 'numLit')[0] : null;
      });
      return { name: nodes(nodes(series, 'tx')[0], 'v')[0]?.textContent ?? '',
        empty: numeric.some(Boolean) && numeric.filter(Boolean).every(cache => nodes(cache, 'ptCount')[0]?.getAttribute('val') === '0'),
        levels: cache ? nodes(cache, 'lvl').map(points).reverse() : [],
        values: numeric.map(cache => points(cache).map(([index, value]) => [index, Number(value)])) };
      });
    });
  });
  windows.forEach(window => window.close()); return result;
};

const evidence = { version: execFileSync(soffice, ['--version'], { encoding: 'utf8' }).trim(), readers: {} };
for (const { stem, officeDropsEmptySeries } of JSON.parse(readFileSync(cases, 'utf8')).filter(item => item.office)) {
  const views = [];
  for (const mode of ['patched', 'generated']) {
    const name = `${stem}-${mode}`, file = join(inputs, `${name}.pptx`), dir = join(out, 'libreoffice', name);
    const input = readFileSync(file);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, basename(file)); rmSync(target, { force: true });
    execFileSync(soffice, [`-env:UserInstallation=file://${out}/lo-profile`, '--headless', '--norestore',
      '--convert-to', 'pptx', '--outdir', dir, file], { timeout: 60000, stdio: 'pipe' });
    assert(existsSync(target), '独立读取器实际生成文件');
    const before = snapshot(input), after = snapshot(readFileSync(target));
    const retained = before.map(view => view.filter(series => !officeDropsEmptySeries || !series.empty));
    assert.deepEqual(after.map(view => view.length), retained.map(view => view.length), `${name} 独立读取保留各框架非空系列成员`);
    const normalized = retained.map(view => view.map(series => ({ ...series,
      levels: series.levels.map(level => level.filter(([, value]) => value !== '')) })));
    assert.deepEqual(after, normalized, '独立读取保留新增系列名称、类别层级和 XY 三维数值');
    evidence.readers[name] = { inputSha256: createHash('sha256').update(input).digest('hex'),
      before, after, droppedEmptySeries: before.map((view, index) => view.length - retained[index].length) }; views.push(after);
  }
  assert.deepEqual(views[0], views[1], '两种保存产物在 LibreOffice 中等价');
}
evidence.boundary = 'LibreOffice 重存省略多级类别显式空字符串，并删除零数据点 XY 系列；仅空系列专项允许并记录此差异。Windows PowerPoint 仍按用户要求暂缓。';
writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
console.log('LibreOffice：共享系列、类别与 XY 点的非空数据保留；零数据点 XY 系列移除已单独记录');
