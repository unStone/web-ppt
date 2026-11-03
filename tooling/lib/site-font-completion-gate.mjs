export async function installGalleryFontCompletionGate({ request, evaluate }) {
  const source = `(() => {
    if (!/\\/samples(?:\\.en)?\\.html$/.test(location.pathname)) return;
    if (globalThis.__siteGalleryFontCompletionGate) throw new Error('样本字体完成门控重复安装');
    const prototype = FontFaceSet.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'load');
    if (typeof descriptor?.value !== 'function') throw new Error('FontFaceSet.load 不可用');
    const pending = new Set();
    let released = false;
    const load = function(...args) {
      const native = Reflect.apply(descriptor.value, this, args);
      let promise;
      promise = new Promise((resolve, reject) => {
        const complete = (settle, value) => {
          const finish = () => settle(value);
          if (released) finish(); else pending.add({ finish, promise });
        };
        Promise.resolve(native).then((value) => complete(resolve, value), (error) => complete(reject, error));
      });
      return promise;
    };
    Object.defineProperty(prototype, 'load', { ...descriptor, value: load });
    globalThis.__siteGalleryFontCompletionGate = {
      active: true,
      async release() {
        if (Object.getOwnPropertyDescriptor(prototype, 'load')?.value !== load) throw new Error('FontFaceSet.load 在门控期间被其他代码改写');
        Object.defineProperty(prototype, 'load', descriptor);
        released = true;
        const completed = [...pending];
        pending.clear();
        for (const { finish } of completed) finish();
        await Promise.allSettled(completed.map(({ promise }) => promise));
        delete globalThis.__siteGalleryFontCompletionGate;
      },
    };
  })()`;
  const registered = await request('Page.addScriptToEvaluateOnNewDocument', { source });
  const identifier = registered.result?.identifier;
  if (typeof identifier !== 'string' || !identifier) throw new Error('Chrome 未返回字体门控脚本标识');
  let active = true;
  return {
    async assertActive() {
      if (!await evaluate('globalThis.__siteGalleryFontCompletionGate?.active === true', true)) {
        throw new Error('样本页面未安装字体完成门控');
      }
    },
    async release() {
      if (!active) return;
      await request('Page.removeScriptToEvaluateOnNewDocument', { identifier });
      await evaluate('globalThis.__siteGalleryFontCompletionGate?.release()', true);
      active = false;
    },
  };
}
