import assert from 'node:assert/strict';

export function planRuns(tasks, repetitions = 1) {
  assert(Number.isInteger(repetitions) && repetitions > 0, 'repetitions必须为正整数');
  const ids = tasks.map((task) => task.id);
  assert.equal(new Set(ids).size, ids.length, '任务ID不能重复');
  assert(ids.length > 0, '至少需要一个评测任务');
  const runs = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const [index, task] of tasks.entries()) {
      const order = (index + repetition) % 2 ? ['with-lint', 'without-lint'] : ['without-lint', 'with-lint'];
      for (const condition of order) {
        const id = `r${String(runs.length + 1).padStart(3, '0')}`;
        runs.push({ id, taskId: task.id, condition, repetition, directory: `runs/${id}` });
      }
    }
  }
  return runs;
}
