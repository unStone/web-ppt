import assert from 'node:assert/strict';
import { waitForDevToolsPort } from './lib/chrome-devtools-launch.mjs';

let tick = 0;
const delayed = await waitForDevToolsPort({
  profile: '/unused',
  isRunning: () => true,
  readPort: () => tick >= 3 ? 43210 : undefined,
  delay: async () => { tick += 1; },
  now: () => tick * 100,
  timeoutMs: 1_000,
});
assert.equal(delayed, 43210, 'CI 较慢时必须等待 DevToolsActivePort，不能用固定 10 秒 stderr 窗口误判');

await assert.rejects(
  waitForDevToolsPort({
    profile: '/unused',
    isRunning: () => false,
    diagnostics: () => '启动失败详情',
    readPort: () => undefined,
    now: () => 0,
  }),
  /Chrome 在 DevTools 就绪前退出：启动失败详情/,
  'Chrome 真正退出时必须携带诊断，不能伪装成启动超时',
);

console.log('Chrome DevTools 启动等待：延迟就绪与提前退出诊断通过');
