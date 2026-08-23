/**
 * 在一个全新 Node 进程中计算单份固件的逐页 SVG 指纹。
 *
 *   node edit-fingerprint.mjs <bundle> <file> <readonly|edit> [password]
 *
 * 每次只处理一个文件，避免渲染器跨解析的全局 defs 计数影响证据；同时显式 idPrefix，
 * 因而这里哈希的是原始 SVG，而不是会掩盖差异的归一化结果。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installDomEnv } from './dom-env.mjs';

const [bundle, file, mode, password] = process.argv.slice(2);
if (!bundle || !file || (mode !== 'readonly' && mode !== 'edit')) {
  console.error('用法: node edit-fingerprint.mjs <bundle> <file> <readonly|edit> [password]');
  process.exit(2);
}

installDomEnv();
const lib = await import(`${pathToFileURL(bundle).href}?run=${process.pid}`);
const bytes = new Uint8Array(readFileSync(file));
const parseOptions = mode === 'edit'
  ? { edit: true, keepPackage: true, lazy: false, ...(password ? { password } : {}) }
  : { ...(password ? { password } : {}) };
const pres = await lib.parse(bytes, parseOptions);
const doc = mode === 'edit' ? lib.createDoc(pres, { idPrefix: 'fingerprint-doc-' }) : null;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const slides = [];

for (let index = 0; index < pres.slides.length; index++) {
  const slide = doc ? lib.toSlide(doc, doc.slideOrder[index]) : pres.slides[index];
  const result = {
    hidden: !!slide.hidden,
    notes: slide.notes ?? '',
    html: '',
    svg: '',
  };
  for (const textMode of ['html', 'svg']) {
    const markup = lib.renderSlideToSvg(pres, slide, {
      textMode,
      idPrefix: `m0-page-${index + 1}-`,
    });
    result[textMode] = `${markup.length}:${hash(markup)}`;
  }
  slides.push(result);
}

const output = {
  width: pres.width,
  height: pres.height,
  source: pres.source,
  pages: slides.length,
  slides,
};
if (doc) lib.disposeDoc(doc);
else pres.dispose?.();
process.stdout.write(JSON.stringify(output));
