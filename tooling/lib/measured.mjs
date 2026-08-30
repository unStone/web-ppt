/**
 * 各测试套件把自己的实测规模落盘，供 `npm run verify` 与文档里的数字比对。
 *
 * 断言数只有跑完测试才知道，而 verify 是秒级的静态检查，不该为了核对一个数字
 * 把整套测试再跑一遍。所以由测试自己写下来：CI 的顺序是先测后 verify，读到的
 * 就是本次运行的真实结果；本地没跑过测试时文件不存在，verify 跳过这一组。
 *
 * 只在测试全绿的路径上调用——失败的运行不该把半截数字留给文档去对照。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '../../out/verify/counts.json');

export function recordCount(key, value) {
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  current[key] = value;
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}

export function readCounts() {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
