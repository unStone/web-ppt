/** 核对图表显示缓存与双击数据工作簿同值，再用真实 LibreOffice 打开 0.8 清单。 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { V08_OFFICE_ARTIFACTS, V08_OFFICE_MANIFEST } from './lib/v08-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/v08-integration');
const manifest = JSON.parse(readFileSync(join(out, V08_OFFICE_MANIFEST), 'utf8'));
if (manifest.version !== 1
  || JSON.stringify(manifest.artifacts) !== JSON.stringify(V08_OFFICE_ARTIFACTS)) {
  throw new Error('0.8 LibreOffice 门禁必须消费本轮生成的完整清单');
}
for (const artifact of manifest.artifacts) {
  const source = join(out, artifact.file);
  if (!existsSync(source)) throw new Error(`0.8 Office 清单缺少产物：${artifact.file}`);
  execFileSync(process.execPath, [
    join(root, 'tooling/test-edit-libreoffice.mjs'), source, String(artifact.slides),
  ], { cwd: root, stdio: 'inherit' });
  if (!artifact.chartData) continue;
  const parts = unzipSync(new Uint8Array(readFileSync(source)));
  const decode = (part) => new TextDecoder().decode(parts[part]);
  const chartXml = decode('ppt/charts/chart1.xml');
  const workbook = unzipSync(parts['ppt/embeddings/chart-data.xlsx']);
  const workbookXml = Object.entries(workbook).filter(([name]) => name.endsWith('.xml'))
    .map(([, bytes]) => new TextDecoder().decode(bytes)).join('\n');
  if (artifact.required.some((value) =>
    !chartXml.includes(value) || !workbookXml.includes(value))) {
    throw new Error('图表显示缓存与双击数据工作簿不一致');
  }
  console.log(`\x1b[32m✓ LibreOffice 已打开且图表缓存与双击工作簿一致：${artifact.file}\x1b[0m`);
}
