import { unzipSync } from 'fflate';

/**
 * 预览首屏不必先 inflate 的部件。
 * 后页 XML / 图表 / 备注只在 `slides[i]` 时才读；OLE 预览走页面里的图，不读 embeddings。
 * 母版、版式、主题、presentation、批注作者不在这里——当前页继承链马上要用。
 */
export function isPreviewDeferredPart(name: string): boolean {
  if (name.endsWith('/')) return false;
  return /\/(?:media|embeddings)\//i.test(name)
    || /^ppt\/slides\/(?:_rels\/)?slide[^/]+$/i.test(name)
    || /^ppt\/(?:notesSlides|comments|charts|diagrams)\//i.test(name)
    || /^ppt\/vbaProject/i.test(name);
}

/**
 * 默认 parse 用：先 inflate 全局部件，后页和嵌入物按名字补解。
 * 不把未解部件列进 ownKeys——内部 Object.keys 不会误触发整包 inflate。
 * keepPackage 不得走这里：编辑层会展开 parts。
 */
export function openPreviewParts(source: Uint8Array): Record<string, Uint8Array> {
  const deferred = new Set<string>();
  const ready = unzipSync(source, {
    filter: (entry) => {
      if (!isPreviewDeferredPart(entry.name)) return true;
      deferred.add(entry.name);
      return false;
    },
  });
  if (deferred.size === 0) return ready;

  const inflate = (name: string): Uint8Array | undefined => {
    if (Object.prototype.hasOwnProperty.call(ready, name)) return ready[name];
    if (!deferred.has(name)) return undefined;
    const extracted = unzipSync(source, { filter: (entry) => entry.name === name });
    deferred.delete(name);
    const data = extracted[name];
    if (!data) return undefined;
    ready[name] = data;
    return data;
  };

  return new Proxy(ready, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && deferred.has(prop)) return inflate(prop);
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return Reflect.has(target, prop) || (typeof prop === 'string' && deferred.has(prop));
    },
  });
}
