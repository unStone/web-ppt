import {createGenerator} from 'ts-json-schema-generator';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const config={path:join(root,'packages/edit-core/src/lint/report.ts'),tsconfig:join(root,'tooling/tsconfig.agent-lint.json'),type:'LayoutLintReport',expose:'export',jsDoc:'extended',additionalProperties:false,sortProps:true};
const content=JSON.stringify(createGenerator(config).createSchema(config.type),null,2)+'\n';
const target=join(root,'packages/edit-core/schemas/lint.schema.json');
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==content)throw new Error('lint Schema 与类型不一致，请运行 npm run schema:lint');}
else{mkdirSync(join(root,'packages/edit-core/schemas'),{recursive:true});writeFileSync(target,content);}
console.log('lint Schema 与 TypeScript 类型一致');
