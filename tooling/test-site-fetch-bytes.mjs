import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = process.cwd();
const out = resolve(root, 'out/site-fetch-bytes');
mkdirSync(out, { recursive: true });
const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/site/src/fetch-bytes.ts'),
  output: resolve(out, 'fetch-bytes.mjs'),
});

const nativeFetch = globalThis.fetch;
const events = [];
try {
  const payload = new Uint8Array(80_000);
  payload.fill(7);
  globalThis.fetch = async () => new Response(payload, {
    headers: { 'Content-Length': String(payload.byteLength) },
  });
  const fetched = await api.fetchBytes('/demo/held.pptx', (got, total) => events.push({ got, total }));
  assert.equal(fetched.bytes.byteLength, payload.byteLength, '必须交回完整字节');
  assert.deepEqual(new Uint8Array(fetched.bytes).subarray(0, 3), new Uint8Array([7, 7, 7]));
  assert.ok(events[0]?.got === 0 && events[0]?.total === payload.byteLength, '有总长必须先报 0 / 总量');
  assert.ok(events.some((item) => item.got === payload.byteLength), '超过 64KB 后必须再报已下载量');

  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(() => api.fetchBytes('/missing.pptx', () => {}), /HTTP 404/, 'HTTP 失败必须立刻抛出');

  globalThis.fetch = async () => new Response('<!doctype html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  await assert.rejects(
    () => api.fetchBytes('/missing.pptx', () => {}),
    /网页/,
    'HTML 回退必须停在下载，不能交给解析',
  );

  globalThis.fetch = nativeFetch;
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => api.fetchBytes('http://127.0.0.1/missing.pptx', () => {}, aborted.signal),
    (error) => error instanceof DOMException && error.name === 'AbortError',
    '已经取消的下载不能再发请求',
  );

  const controller = new AbortController();
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('下载已取消', 'AbortError'));
    }, { once: true });
  });
  const pending = api.fetchBytes('/demo/held.pptx', () => {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError', '下载中取消必须是 AbortError');
} finally {
  globalThis.fetch = nativeFetch;
}

console.log('  带进度下载与取消通过');
