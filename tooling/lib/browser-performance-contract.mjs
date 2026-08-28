const failuresKey = '__webPptBrowserPerformanceFailures';
const fixedComputeIterations = 5_000_000;
// 这组阈值只授予一次重测；第二轮仍超产品预算照常红，因此可以对环境抖动保持敏感。
const environmentBudgets = { rafP95: 24, rafMax: 50, computeP50: 5.8 };

const failures = () => {
  if (!Array.isArray(globalThis[failuresKey])) globalThis[failuresKey] = [];
  return globalThis[failuresKey];
};

export function clearPerformanceFailures() {
  globalThis[failuresKey] = [];
}

/** 性能超标先记账，功能断言继续跑完，避免环境抖动遮住真实功能回归。 */
export function recordPerformanceBudget(name, actual, budget) {
  if (actual <= budget) return;
  failures().push({ name, actual, budget });
}

export function readPerformanceFailures() {
  return failures().map((failure) => ({ ...failure }));
}

export async function sampleAnimationFrameEnvironment(frameCount = 12) {
  const samples = [];
  let previous = await new Promise((resolve) => requestAnimationFrame(resolve));
  for (let index = 0; index < frameCount; index++) {
    const current = await new Promise((resolve) => requestAnimationFrame(resolve));
    samples.push(current - previous);
    previous = current;
  }
  samples.sort((left, right) => left - right);
  const computeSamples = [];
  let checksum = 2166136261;
  for (let round = 0; round < 4; round++) {
    const started = performance.now();
    for (let index = 0; index < fixedComputeIterations; index++) {
      checksum = Math.imul(checksum ^ index, 16777619);
    }
    if (round > 0) computeSamples.push(performance.now() - started);
  }
  computeSamples.sort((left, right) => left - right);
  return {
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples.at(-1),
    computeP50: computeSamples[1],
    checksum,
  };
}

export function classifyAnimationFrameEnvironment({ before, during }) {
  const reasons = [];
  for (const [phase, sample] of [['测前', before], ['测中', during]]) {
    if (sample.p95 > environmentBudgets.rafP95) {
      reasons.push(`${phase} rAF p95 ${sample.p95.toFixed(1)}ms > ${environmentBudgets.rafP95}ms`);
    }
    if (sample.max > environmentBudgets.rafMax) {
      reasons.push(`${phase} rAF max ${sample.max.toFixed(1)}ms > ${environmentBudgets.rafMax}ms`);
    }
    if (sample.computeP50 > environmentBudgets.computeP50) {
      reasons.push(`${phase} 固定计算 p50 ${sample.computeP50.toFixed(1)}ms > `
        + `${environmentBudgets.computeP50}ms`);
    }
  }
  return { disturbed: reasons.length > 0, reasons, before, during };
}

export async function runPerformanceAttempts({ attempt, onRetry = () => {} }) {
  const first = await attempt(1);
  const mayRetry = first.functionalStatus === 'pass'
    && first.performanceFailures.length > 0
    && first.environment.disturbed;
  if (!mayRetry) return { result: first, retried: false, attempts: 1 };
  await onRetry(first);
  const second = await attempt(2);
  return { result: second, retried: true, attempts: 2 };
}
