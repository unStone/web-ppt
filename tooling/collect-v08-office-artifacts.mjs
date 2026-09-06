import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { V08_EXTRA_SOURCES, V08_OFFICE_ARTIFACTS, V08_OFFICE_MANIFEST } from './lib/v08-office-artifacts.mjs';

const out = 'out/v08-integration';
mkdirSync(out, { recursive: true });
for (const { file, source } of V08_EXTRA_SOURCES) {
  if (!existsSync(source)) throw new Error(`请先完成本轮专项测试：缺少 ${source}`);
  copyFileSync(source, join(out, file));
}
for (const { file } of V08_OFFICE_ARTIFACTS) {
  if (!existsSync(join(out, file))) throw new Error(`0.8 验收产物缺失：${file}`);
}
writeFileSync(join(out, V08_OFFICE_MANIFEST), `${JSON.stringify({ version: 1, artifacts: V08_OFFICE_ARTIFACTS }, null, 2)}\n`);
console.log(`0.8 统一 Office 清单：${V08_OFFICE_ARTIFACTS.length} 件图表与媒体工件`);
