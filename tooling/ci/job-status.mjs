import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkJobResults(jobs) {
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) throw new Error('缺少完整 job 结论');
  if (jobs.changes?.result !== 'success') throw new Error('路径检查未成功');
  const code = jobs.changes.outputs?.code;
  if (!['true', 'false'].includes(code)) throw new Error(`路径检查输出无效：${code}`);
  const expected = code === 'true' ? 'success' : 'skipped';
  const gates = Object.entries(jobs).filter(([name]) => name !== 'changes');
  if (!gates.length) throw new Error('缺少门禁 job 结论');
  for (const [name, job] of gates) {
    if (job?.result !== expected) throw new Error(`${name}: ${job?.result}，预期 ${expected}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkJobResults(JSON.parse(process.env.RESULTS ?? 'null'));
  console.log('全部门禁结论符合本轮路径检查结果');
}
