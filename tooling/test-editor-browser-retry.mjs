import assert from 'node:assert/strict';
import {
  classifyAnimationFrameEnvironment,
  clearPerformanceFailures,
  readPerformanceFailures,
  recordPerformanceBudget,
  runPerformanceAttempts,
} from './lib/browser-performance-contract.mjs';

const quietEnvironment = classifyAnimationFrameEnvironment({
  before: { p95: 16.8, max: 17.2, computeP50: 5.8 },
  during: { p95: 16.7, max: 17.4, computeP50: 5.7 },
});
const disturbedEnvironment = classifyAnimationFrameEnvironment({
  before: { p95: 16.8, max: 17.2, computeP50: 5.8 },
  during: { p95: 31.4, max: 68.1, computeP50: 5.7 },
});
const computeDisturbedEnvironment = classifyAnimationFrameEnvironment({
  before: { p95: 16.8, max: 17.2, computeP50: 12.4 },
  during: { p95: 16.7, max: 17.4, computeP50: 11.8 },
});
assert.equal(quietEnvironment.disturbed, false, '安静 rAF 基线不应触发重测');
assert.equal(disturbedEnvironment.disturbed, true, '受扰 rAF 基线必须触发重测');
assert.equal(computeDisturbedEnvironment.disturbed, true, '受扰固定计算基线必须触发重测');

clearPerformanceFailures();
recordPerformanceBudget('安静预算', 8, 8);
recordPerformanceBudget('超时预算', 8.01, 8);
assert.deepEqual(readPerformanceFailures(), [
  { name: '超时预算', actual: 8.01, budget: 8 },
], '性能预算只汇总超标项，不能中断功能断言');

const passAttempts = [];
const pass = await runPerformanceAttempts({
  attempt: async (number) => {
    passAttempts.push(number);
    return { functionalStatus: 'pass', performanceFailures: [], environment: quietEnvironment };
  },
});
assert.deepEqual(passAttempts, [1], '安静通过行为必须保持单轮');
assert.equal(pass.retried, false);

const functionAttempts = [];
const functionFailure = await runPerformanceAttempts({
  attempt: async (number) => {
    functionAttempts.push(number);
    return {
      functionalStatus: 'fail',
      performanceFailures: [{ name: '同时超时', actual: 20, budget: 8 }],
      environment: disturbedEnvironment,
    };
  },
});
assert.deepEqual(functionAttempts, [1], '功能失败即使环境受扰也不能重测或被掩盖');
assert.equal(functionFailure.result.functionalStatus, 'fail');

const retryAttempts = [];
const retryNotices = [];
const recovered = await runPerformanceAttempts({
  attempt: async (number) => {
    retryAttempts.push(number);
    return number === 1
      ? {
        functionalStatus: 'pass',
        performanceFailures: [{ name: '60 元素删除', actual: 14, budget: 8 }],
        environment: disturbedEnvironment,
      }
      : { functionalStatus: 'pass', performanceFailures: [], environment: quietEnvironment };
  },
  onRetry: (result) => retryNotices.push(result),
});
assert.deepEqual(retryAttempts, [1, 2], '受扰性能超标只重测一轮');
assert.equal(retryNotices.length, 1);
assert.equal(recovered.retried, true);
assert.equal(recovered.result.performanceFailures.length, 0);

const repeatedAttempts = [];
const repeated = await runPerformanceAttempts({
  attempt: async (number) => {
    repeatedAttempts.push(number);
    return {
      functionalStatus: 'pass',
      performanceFailures: [{ name: '持续超时', actual: number === 1 ? 12 : 11, budget: 8 }],
      environment: disturbedEnvironment,
    };
  },
});
assert.deepEqual(repeatedAttempts, [1, 2]);
assert.equal(repeated.result.performanceFailures[0].actual, 11, '第二轮仍超标必须返回红灯证据');

const quietFailureAttempts = [];
await runPerformanceAttempts({
  attempt: async (number) => {
    quietFailureAttempts.push(number);
    return {
      functionalStatus: 'pass',
      performanceFailures: [{ name: '真实退化', actual: 9, budget: 8 }],
      environment: quietEnvironment,
    };
  },
});
assert.deepEqual(quietFailureAttempts, [1], '安静环境超标必须直接红，不能靠重测漂绿');

console.log('  性能契约 · 功能/预算隔离与受扰单次重测通过');
