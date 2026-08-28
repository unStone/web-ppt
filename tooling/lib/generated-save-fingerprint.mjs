/** 生成前有效投影与生成产物必须在各自干净进程中取两条文本路径指纹。 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installDomEnv } from './dom-env.mjs';

const [corePath, editPath, file, mode] = process.argv.slice(2);
if (!corePath || !editPath || !file || !['projected', 'saved'].includes(mode)) {
  console.error('用法: node generated-save-fingerprint.mjs <core.mjs> <edit.mjs> <file> <projected|saved>');
  process.exit(2);
}

installDomEnv();
const core = await import(`${pathToFileURL(corePath).href}?worker=${process.pid}`);
const edit = await import(`${pathToFileURL(editPath).href}?worker=${process.pid}`);
const pres = await core.parse(new Uint8Array(readFileSync(file)), {
  // 两侧都保留资源表并内联成 data URI；否则 asset: 序号会把包身份误算进视觉指纹。
  edit: mode === 'projected', keepPackage: true, lazy: false, assets: 'defer',
});
const doc = mode === 'projected' ? edit.createDoc(pres, { idPrefix: 'generated-fingerprint-' }) : null;
const slides = doc ? doc.slideOrder.map((id) => edit.toSlide(doc, id)) : pres.slides;
const assets = new Map([
  ...Object.entries(pres.package?.assets ?? {}),
  ...(pres.editInfo?.assets ?? []).map((asset) => [asset.url, asset]),
]);
const inlineAssets = (value) => {
  if (typeof value === 'string') {
    const asset = assets.get(value);
    return asset ? `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}` : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(inlineAssets);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inlineAssets(child)]));
};
const withoutNonVisualIdentity = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(withoutNonVisualIdentity);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'id' && key !== 'editInfo' && key !== 'name')
    .map(([key, child]) => [key, withoutNonVisualIdentity(child)]));
};
const result = [];
for (const [index, raw] of slides.entries()) {
  const slide = withoutNonVisualIdentity(inlineAssets(raw));
  const entry = { hidden: !!slide.hidden, notes: slide.notes ?? '' };
  for (const textMode of ['html', 'svg']) {
    const svg = core.renderSlideToSvg(pres, slide, {
      textMode, idPrefix: `generated-${index}-${textMode}-`,
    });
    entry[textMode] = `${svg.length}:${createHash('sha256').update(svg).digest('hex')}`;
  }
  result.push(entry);
}
if (doc) edit.disposeDoc(doc); else pres.dispose?.();
process.stdout.write(JSON.stringify(result));
