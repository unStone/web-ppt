import { performance } from 'node:perf_hooks';

const before = process.memoryUsage().heapUsed;
const started = performance.now();
await import('@web-ppt/edit-core/fill');
process.stdout.write(JSON.stringify({ importMs: performance.now() - started,
  heapDeltaBytes: process.memoryUsage().heapUsed - before }));
