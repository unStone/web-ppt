import { unzipSync } from 'fflate';
let ready: Promise<void> | undefined;
let threeD: Promise<void> | undefined;

/** 先识别实际 EMF+ 标记，普通演示文稿无需下载 GDI+ 和三维网格实现。 */
export async function prepareAdvancedRendering(input: Uint8Array | ArrayBuffer): Promise<void> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const contains = (data: Uint8Array) => {
    for (let i = 0; i + 16 <= data.length; i++) {
      if (data[i] === 0x45 && data[i + 1] === 0x4d && data[i + 2] === 0x46 && data[i + 3] === 0x2b
        && data[i + 4] === 1 && data[i + 5] === 0x40) return true;
    }
    return false;
  };
  let needed = false, spatial = false;
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      let total = 0;
      const media = unzipSync(bytes, { filter: e => (/\/media\//.test(e.name) || /^ppt\/(slides|slideLayouts|slideMasters|theme)\/.*\.xml$/.test(e.name)) && e.originalSize <= 32 * 1024 * 1024
        && (total += e.originalSize) <= 128 * 1024 * 1024 });
      needed = Object.values(media).some(contains);
      spatial = Object.entries(media).some(([name, data]) => name.endsWith('.xml')
        && /<(?:[\w]+:)?(?:scene3d|sp3d)[\s>]/.test(new TextDecoder().decode(data)));
    } else needed = contains(bytes);
  } catch { return; }
  if (spatial) {
    try { threeD ??= import('@web-ppt/core/three-d').then(m => m.enableThreeD()); await threeD; }
    catch { threeD = undefined; }
  }
  if (!needed) return;
  try { ready ??= import('@web-ppt/core/emf-plus').then(m => m.enableEmfPlus()); await ready; }
  catch { ready = undefined; }
}
