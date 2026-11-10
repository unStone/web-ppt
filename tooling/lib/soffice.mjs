/**
 * LibreOffice 可执行文件发现：唯一入口，替代各套件各自维护的候选数组。
 *
 * SOFFICE 环境变量优先（CI 与自定安装用），其次常见安装路径，最后裸命令名走 PATH。
 * 门禁类套件用 requireSoffice()（缺失即抛），可降级的生成脚本用 findSoffice()。
 */
import { existsSync } from 'node:fs';

const CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  'soffice',
];

export function findSoffice() {
  const override = process.env.SOFFICE;
  if (override) return override;
  return CANDIDATES.find((p) => p === 'soffice' || existsSync(p)) ?? null;
}

export function requireSoffice() {
  const soffice = findSoffice();
  if (!soffice) {
    throw new Error(
      '未找到 LibreOffice（soffice）。macOS: brew install --cask libreoffice；'
        + 'CI: apt-get install libreoffice-impress；自定安装用 SOFFICE 环境变量指定可执行文件路径。',
    );
  }
  return soffice;
}
