import { createGenerator } from 'ts-json-schema-generator';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = {
  path: join(root, 'packages/edit-core/src/fill/types.ts'),
  tsconfig: join(root, 'tooling/tsconfig.template-fill.json'),
  type: 'TemplateFillOutline', expose: 'export', jsDoc: 'extended',
  additionalProperties: false, sortProps: true,
};
let schema;
try {
  schema = createGenerator(config).createSchema(config.type);
} catch (error) {
  const node = error.node;
  if (node) {
    throw new Error(`模板大纲 Schema 类型节点不受支持：${node.getSourceFile().fileName}: ${node.getText()}`, { cause: error });
  }
  throw error;
}
schema.$id = 'https://web-ppt.dev/schemas/template-fill.schema.json';
const ajv = new Ajv({ strict: true, code: { source: true, esm: true } });
const validate = ajv.compile(schema);
const targets = [
  [join(root, 'packages/edit-core/schemas/template-fill.schema.json'), `${JSON.stringify(schema, null, 2)}\n`],
  [join(root, 'packages/edit-core/src/fill/generated-validator.ts'), `// @ts-nocheck\n${standaloneCode(ajv, validate)}`],
  [join(root, 'packages/edit-core/src/fill/generated-schema.ts'), `export const templateFillSchema = ${JSON.stringify(schema, null, 2)} as const;\n`],
];

if (process.argv.includes('--check')) {
  for (const [target, content] of targets) {
    if (readFileSync(target, 'utf8') !== content) {
      throw new Error('模板大纲 Schema 或校验器与 TypeScript 类型不一致，请运行 npm run schema:fill');
    }
  }
  console.log('模板大纲 Schema、校验器与 TypeScript 类型一致');
} else {
  for (const [target, content] of targets) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log('已从 TemplateFillOutline 生成大纲 Schema 与独立校验器');
}
