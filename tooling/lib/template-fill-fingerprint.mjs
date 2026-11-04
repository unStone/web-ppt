import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDomEnv } from './dom-env.mjs';
import { normalizeSvg } from './snapshot.mjs';
import { createTemplateFillMeasurement } from './template-fill-measurement.mjs';

const [runtime, file, mode] = process.argv.slice(2);
if (!runtime || !file || !['read', 'edit'].includes(mode)) throw new Error('用法：template-fill-fingerprint <runtime> <pptx> <read|edit>');
installDomEnv();
const api = await import(pathToFileURL(runtime).href);
const presentation = await api.core.parse(new Uint8Array(readFileSync(file)), { edit: true, keepPackage: true, lazy: false });
const doc = mode === 'edit' ? api.edit.createDoc(presentation, { idPrefix: 'fingerprint-' }) : null;
const measureText = createTemplateFillMeasurement(resolve(import.meta.dirname, '../..'));
try {
  const result = {};
  for (const textMode of ['html', 'svg']) {
    const pages = (doc ? doc.slideOrder.map(id => api.edit.toSlide(doc, id)) : presentation.slides)
      .map(slide => normalizeSvg(api.core.renderSlideToSvg(presentation, slide, { textMode, measureText })));
    result[textMode] = createHash('sha256').update(pages.join('\n')).digest('hex');
  }
  process.stdout.write(JSON.stringify(result));
} finally { if (doc) api.edit.disposeDoc(doc); else presentation.dispose?.(); }
