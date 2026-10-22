import { createGenerator } from 'ts-json-schema-generator';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = {
  path: join(root, 'packages/edit-core/src/describe/types.ts'),
  tsconfig: join(root, 'tooling/tsconfig.agent-describe.json'),
  type: 'PresentationDescription', expose: 'export', jsDoc: 'extended',
  additionalProperties: false, sortProps: true,
};
const schema = createGenerator(config).createSchema(config.type);
const content = `${JSON.stringify(schema, null, 2)}\n`;
const target = join(root, 'packages/edit-core/schemas/describe.schema.json');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== content) {
    throw new Error('describe JSON Schema 与 TypeScript 类型不一致，请运行 npm run schema:describe');
  }
  console.log('describe JSON Schema 与 TypeScript 类型一致');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log('已从 PresentationDescription 生成 describe JSON Schema');
}
