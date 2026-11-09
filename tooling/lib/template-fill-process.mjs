import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTemplateFillMeasurement } from './template-fill-measurement.mjs';
import { TEMPLATE_FILL_GEOMETRY_CHECKS } from './template-fill-cases.mjs';

const [runtime, templatePath, outlinePath, outputPath] = process.argv.slice(2);
if (!runtime || !templatePath || !outlinePath || !outputPath) {
  throw new Error('用法：node template-fill-process.mjs <runtime> <template> <outline> <output>');
}
const root = resolve(import.meta.dirname, '../..');
const api = await import(pathToFileURL(runtime).href);
const result = await api.fill.fillTemplate(new Uint8Array(readFileSync(templatePath)), JSON.parse(readFileSync(outlinePath, 'utf8')), {
  idPrefix: 'fill-contract-',
  lint: { checks: TEMPLATE_FILL_GEOMETRY_CHECKS, measureText: createTemplateFillMeasurement(root) },
});
writeFileSync(outputPath, result.bytes);
process.stdout.write(JSON.stringify({ description: result.description, lint: result.lint, bindings: result.bindings }));
