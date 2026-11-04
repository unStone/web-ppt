import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectApiContract, assertApiContract, checkApiArtifacts } from './lib/api-contract-model.mjs';

const root = join(import.meta.dirname, '..');
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--write', '--dist'].includes(flag)) || flags.size !== process.argv.length - 2) {
  throw new Error('API 候选清单参数无效；只接受 --write 或 --dist');
}
if (flags.has('--write') && flags.has('--dist')) throw new Error('API 候选清单不能同时重建与校验发布产物');
const target = join(root, 'docs/api/api-contract.json');
const contract = await collectApiContract(root);
if (flags.has('--write')) {
  writeFileSync(target, `${JSON.stringify(contract, null, 2)}\n`);
  console.log('已生成 API 候选清单；请审查差异及迁移说明，当前 phase=candidate');
} else {
  assertApiContract(JSON.parse(readFileSync(target, 'utf8')), contract);
  if (flags.has('--dist')) await checkApiArtifacts(root, contract);
  console.log(`API 候选清单一致：${contract.packages.length} 包、${contract.packages.reduce((count, pkg) => count + pkg.exports.length, 0)} 个导出、${contract.schemas.length} 份 Schema、${contract.protocols.length} 项协议；${flags.has('--dist') ? '全部发布目标与协议声明通过' : '源码模式'}`);
}
