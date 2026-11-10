import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { installGalleryFontCompletionGate } from './lib/site-font-completion-gate.mjs';

const outcomes = Array.from({ length: 3 }, () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
});
let calls = 0;
class FontFaceSetBoundary {
  load(...args) {
    assert.equal(this, fonts);
    assert.deepEqual(args, ['16px actual-family', 'actual-text']);
    return outcomes[calls++].promise;
  }
}
const fonts = new FontFaceSetBoundary();
const original = Object.getOwnPropertyDescriptor(FontFaceSetBoundary.prototype, 'load');
const context = createContext({ FontFaceSet: FontFaceSetBoundary, location: { pathname: '/web-ppt/samples.en.html' } });
const commands = [];
let source;
const gate = await installGalleryFontCompletionGate({
  request: async (method, params) => {
    commands.push({ method, params });
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      source = params.source;
      runInContext(source, context);
      return { result: { identifier: 'gallery-font-gate' } };
    }
    assert.equal(method, 'Page.removeScriptToEvaluateOnNewDocument');
    assert.equal(params.identifier, 'gallery-font-gate');
    return {};
  },
  evaluate: async (expression, awaitPromise) => {
    assert.equal(awaitPromise, true);
    return runInContext(expression, context);
  },
});
await gate.assertActive();
const value = [{ family: 'actual native result' }];
const failure = new Error('actual native failure');
let completed = false,
  rejected = false;
const successful = fonts.load('16px actual-family', 'actual-text').then((result) => {
  completed = true;
  return result;
});
const failed = fonts.load('16px actual-family', 'actual-text').catch((error) => {
  rejected = true;
  return error;
});
const unfinished = fonts.load('16px actual-family', 'actual-text');
outcomes[0].resolve(value);
outcomes[1].reject(failure);
await Promise.allSettled(outcomes.slice(0, 2).map(({ promise }) => promise));
assert.equal(completed, false);
assert.equal(rejected, false);
await gate.release();
assert.equal(await successful, value, '门控必须保留真实 native 返回对象');
assert.equal(await failed, failure, '门控必须保留真实 native 异常对象');
assert.equal(completed, true);
assert.equal(rejected, true);
assert.deepEqual(Object.getOwnPropertyDescriptor(FontFaceSetBoundary.prototype, 'load'), original);
assert.equal(runInContext('globalThis.__siteGalleryFontCompletionGate', context), undefined);
outcomes[2].resolve(value);
assert.equal(await unfinished, value, '清理不能等网络请求结束，迟到结果必须正常释放');
await gate.release();
assert.equal(commands.length, 2, '清理幂等且只移除自己注册的脚本');

const otherPage = createContext({ FontFaceSet: FontFaceSetBoundary, location: { pathname: '/web-ppt/editor.html' } });
runInContext(source, otherPage);
assert.deepEqual(Object.getOwnPropertyDescriptor(FontFaceSetBoundary.prototype, 'load'), original);
console.log('样本字体完成门控：真实结果/异常、未完成请求、方法恢复、脚本清理与页面隔离通过');
