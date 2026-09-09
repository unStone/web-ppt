const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) };
};

export const initChartLab = browser => browser.evaluate("(async () => { globalThis.lab = await import('/tooling/lib/chart-shared-browser-workload.mjs'); })()");
const heap = async (browser, gc = false) => {
  if (gc) await browser.request('HeapProfiler.collectGarbage');
  return browser.request('Runtime.getHeapUsage');
};

export function recordMeasurementError(record, error) {
  record.status = 'failed';
  record.error = { phase: record.phase, message: error.message, stack: error.stack,
    expression: error.expression, pageErrors: error.pageErrors };
}

function assertHealthy(browser) {
  if (browser.pageErrors?.length) throw Object.assign(new Error('测量页面出现未处理异常或 console error'),
    { pageErrors: [...browser.pageErrors] });
}

/** 每个已完成操作立即落盘；失败和中断不能把已采集样本从报告中抹掉。 */
export async function measureChartCase(browser, record, { iterations, profile, cycles = 0, persist, saveProfile }) {
  const phase = async (name, run) => {
    record.phase = name; persist();
    const result = await run(); assertHealthy(browser); persist(); return result;
  };
  record.status = 'running'; record.memory = { samples: [] }; record.environment = {};
  record.edits = []; record.duplicates = []; record.clipboard = []; record.saves = [];
  let profiling = false;
  try {
    await phase('initialize', () => initChartLab(browser));
    await phase('environment.before', async () => { record.environment.before = await browser.evaluate('lab.environment()'); });
    await phase('heap.initial', async () => { record.memory.initialHeap = await heap(browser, true); });
    await phase('prepare', async () => { record.setup = await browser.evaluate(`lab.prepare(${JSON.stringify({ scenario: record.scenario, pages: record.pages })})`); });
    await phase('heap.prepared', async () => { record.memory.preparedHeap = await heap(browser, true); });
    await phase('activate', async () => { record.activation = await browser.evaluate('lab.activate()'); });
    if (profile) await phase('profile', async () => {
      await browser.request('Profiler.enable'); await browser.request('Profiler.start'); profiling = true;
      await browser.evaluate('lab.step(999)'); await browser.evaluate('lab.clipboard()');
      saveProfile((await browser.request('Profiler.stop')).profile); profiling = false;
    });
    await phase('heap.active', async () => { record.memory.activeHeap = await heap(browser, true); });
    for (let index = 0; index < iterations; index++) {
      await phase(`edit.${index}`, async () => { record.edits.push(await browser.evaluate(`lab.step(${index})`)); });
      await phase(`duplicate.${index}`, async () => { record.duplicates.push(await browser.evaluate('lab.duplicate()')); });
      if (index < 5) await phase(`clipboard.${index}`, async () => { record.clipboard.push(await browser.evaluate('lab.clipboard()')); });
      await phase(`heap.${index}`, async () => { record.memory.samples.push(await heap(browser)); });
    }
    for (let index = 0; index < 3; index++) await phase(`save.${index}`, async () => { record.saves.push(await browser.evaluate('lab.save()')); });
    await phase('heap.retained', async () => { record.memory.retainedHeap = await heap(browser, true); });
    await phase('dispose', () => browser.evaluate('lab.dispose()'));
    await phase('heap.disposed', async () => { record.memory.disposedHeap = await heap(browser, true); });
    record.retention = [];
    for (let cycle = 0; cycle < cycles; cycle++) {
      const sample = { cycle }; record.retention.push(sample);
      await phase(`retention.${cycle}.prepare`, async () => { sample.setup = await browser.evaluate(
        `lab.prepare(${JSON.stringify({ scenario: record.scenario, pages: record.pages, registered: true })})`); });
      await phase(`retention.${cycle}.activate`, async () => { sample.activation = await browser.evaluate('lab.activate()'); });
      await phase(`retention.${cycle}.edit`, async () => { sample.edit = await browser.evaluate(`lab.step(${cycle})`); });
      await phase(`retention.${cycle}.save`, async () => { sample.save = await browser.evaluate('lab.save()'); });
      await phase(`retention.${cycle}.activeHeap`, async () => { sample.activeHeap = await heap(browser, true); });
      await phase(`retention.${cycle}.dispose`, () => browser.evaluate('lab.dispose()'));
      await phase(`retention.${cycle}.disposedHeap`, async () => { sample.disposedHeap = await heap(browser, true); });
    }
    await phase('environment.after', async () => { record.environment.after = await browser.evaluate('lab.environment()'); });
    record.metrics = {};
    for (const [group, fields] of [[record.edits, ['commandMs', 'layoutMs', 'projectionAllMs']], [record.duplicates, ['duplicateMs', 'undoMs']],
      [record.clipboard, ['copyMs', 'pasteMs']], [record.saves, ['saveMs']]]) {
      for (const field of fields) record.metrics[field] = summary(group.map(row => row[field]));
    }
    record.status = 'complete'; record.phase = 'complete';
  } catch (error) { recordMeasurementError(record, error); throw error; }
  finally {
    if (profiling) try { saveProfile((await browser.request('Profiler.stop')).profile); }
    catch (error) { record.profileError = error.message; }
    record.pageErrors = [...(browser.pageErrors ?? [])]; persist();
  }
}

export async function measureChartCold(browser, record, persist) {
  const phase = async (name, run) => { record.phase = name; persist(); await run(); assertHealthy(browser); persist(); };
  try {
    record.status = 'running';
    await phase('initialize', () => initChartLab(browser));
    await phase('heap.before', async () => { record.heapBefore = await heap(browser, true); });
    await phase('import', async () => { Object.assign(record, await browser.evaluate('lab.coldImport()')); });
    await phase('heap.after', async () => { record.heapAfterGc = await heap(browser, true); });
    record.status = 'complete'; record.phase = 'complete';
  } catch (error) { recordMeasurementError(record, error); throw error; }
  finally { record.pageErrors = [...(browser.pageErrors ?? [])]; persist(); }
}
