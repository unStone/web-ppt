import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as core from '@web-ppt/core';
import { buildFixture, buildReferenceSolution } from '../agent-eval/fixtures.mjs';

let calls = 0;
const failure = new Error('injected parser dependency failure');
mock.module('@web-ppt/core', {
  namedExports: {
    ...core,
    parse: (...args) => {
      if (++calls === 2) throw failure;
      return core.parse(...args);
    },
  },
});

const { judgeTask } = await import('../agent-eval/judge.mjs');
await assert.rejects(
  judgeTask({ taskId: 'case-01', inputBytes: buildFixture('case-01'), outputBytes: buildReferenceSolution('case-01') }),
  (error) => error.cause === failure,
);
console.log('判定器保留候选SDK读取依赖错误，未冒充模型输出错误');
