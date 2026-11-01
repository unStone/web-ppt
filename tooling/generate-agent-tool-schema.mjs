import { createGenerator } from 'ts-json-schema-generator';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = {
  path: join(root, 'packages/edit-core/src/agent/types.ts'),
  tsconfig: join(root, 'tooling/tsconfig.agent-tools.json'),
  type: 'AgentToolInputMap', expose: 'export', jsDoc: 'extended',
  additionalProperties: false, sortProps: true,
};
let schema;
try {
  schema = createGenerator(config).createSchema(config.type);
} catch (error) {
  const node = error.node;
  if (node) {
    throw new Error(`Agent Schema 类型节点不受支持：${node.getSourceFile().fileName}: ${node.getText()}`, { cause: error });
  }
  throw error;
}
schema.$id = 'https://web-ppt.dev/schemas/agent-tools.schema.json';
const schemaContent = `${JSON.stringify(schema, null, 2)}\n`;
const ajv = new Ajv({ strict: true, code: { source: true, esm: true } });
const validate = ajv.compile(schema);
const validatorContent = `// @ts-nocheck\n${standaloneCode(ajv, validate)}`;
const schemaModuleContent = `export const agentToolSchema = ${JSON.stringify(schema, null, 2)} as const;\n`;
const targets = [
  [join(root, 'packages/edit-core/schemas/agent-tools.schema.json'), schemaContent],
  [join(root, 'packages/edit-core/src/agent/generated-validator.ts'), validatorContent],
  [join(root, 'packages/edit-core/src/agent/generated-schema.ts'), schemaModuleContent],
];
if (process.argv.includes('--check')) {
  for (const [target, content] of targets) {
    if (readFileSync(target, 'utf8') !== content) {
      throw new Error('Agent 工具 Schema 或校验器与 TypeScript 类型不一致，请运行 npm run schema:agent');
    }
  }
  console.log('Agent 工具 Schema、校验器与 TypeScript 类型一致');
} else {
  for (const [target, content] of targets) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log('已从 AgentToolInputMap 生成工具 Schema 与独立校验器');
}
