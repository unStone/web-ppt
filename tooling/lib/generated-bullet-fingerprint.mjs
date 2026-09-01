/** 生成前有效投影与生成产物必须在各自干净进程中取两条文本路径指纹。 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installDomEnv } from './dom-env.mjs';

const [corePath, editPath, file, mode] = process.argv.slice(2);
if (!corePath || !editPath || !file || !['projected', 'saved'].includes(mode)) {
  console.error('用法: node generated-bullet-fingerprint.mjs <core.mjs> <generate.mjs> <file> <projected|saved>');
  process.exit(2);
}

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
installDomEnv();
const core = await import(`${pathToFileURL(corePath).href}?worker=${process.pid}`);
const edit = await import(`${pathToFileURL(editPath).href}?worker=${process.pid}`);
let presentation;
let doc;
let slide;
if (mode === 'projected') {
  presentation = await core.parse(edit.createBlankPptx(), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  doc = edit.createDoc(presentation, { idPrefix: 'generated-bullet-fingerprint-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  editor.exec({
    type: 'AddShape', slideId, preset: 'roundRect', rect: { x: 96, y: 88, w: 320, h: 160 },
  });
  const id = editor.selection.ids[0];
  editor.exec({
    type: 'EditText', id, ops: [{
      type: 'replaceFragment',
      from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      fragment: { paragraphs: [
        { text: '字符列表', marks: [{ from: 0, to: 4, props: {} }] },
        { text: '自动编号', marks: [{ from: 0, to: 4, props: {} }] },
        { text: '图片列表', marks: [{ from: 0, to: 4, props: {} }] },
      ] },
    }],
  });
  editor.exec({
    type: 'SetParaProps', id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } },
    props: { bullet: { kind: 'char', char: '→' } },
  });
  editor.exec({
    type: 'SetParaProps', id,
    range: { from: { p: 1, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } },
    props: { bullet: { kind: 'autoNum', type: 'romanLcPeriod', startAt: 4 } },
  });
  editor.exec({
    type: 'SetParaProps', id,
    range: { from: { p: 2, r: 0, off: 0 }, to: { p: 2, r: 0, off: 0 } },
    props: { bullet: {
      kind: 'blip', image: {
        bytes: Uint8Array.from(Buffer.from(PNG_1PX, 'base64')), mime: 'image/png',
      },
      font: 'Wingdings', color: '#336699', size: { kind: 'percent', value: 1.35 },
    } },
  });
  slide = edit.toSlide(doc, slideId);
} else {
  presentation = await core.parse(new Uint8Array(readFileSync(file)), {
    edit: false, keepPackage: true, lazy: false, assets: 'defer',
  });
  slide = presentation.slides[0];
}

const assets = new Map([
  ...Object.entries(presentation.package?.assets ?? {}),
  ...(presentation.editInfo?.assets ?? []).map((asset) => [asset.url, asset]),
]);
const normalize = (value) => {
  if (typeof value === 'string') {
    const asset = assets.get(value);
    return asset ? `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}` : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'editInfo', 'name'].includes(key))
    .map(([key, child]) => [key, normalize(child)]));
};
const normalized = normalize(slide);
const result = {};
for (const textMode of ['html', 'svg']) {
  const svg = core.renderSlideToSvg(presentation, normalized, {
    textMode, idPrefix: `generated-bullets-${textMode}-`,
  });
  result[textMode] = `${svg.length}:${createHash('sha256').update(svg).digest('hex')}`;
}
if (doc) edit.disposeDoc(doc); else presentation.dispose?.();
process.stdout.write(JSON.stringify(result));
