import type { ExportFontOptions, FontSubsetter, Slide } from '@web-ppt/core';
import { collectFonts } from '@web-ppt/core';
import { exportFontFaces } from '@web-ppt/fonts';
import { createHarfBuzzSubsetter } from '@web-ppt/fonts/subset';

// wasm 由 tooling/sync-font-wasm.mjs 在 dev/build 前拷进 public/vendor；
// 不用 `?url` 导入：官网 WebMCP 测试用 esbuild 打包 site 源码，两套打包器语义不同
const WASM_URL = '/vendor/harfbuzz-subset.wasm';

let engine: Promise<FontSubsetter> | undefined;

/** wasm 惰性加载、全站一个实例：确定性引擎没有会话状态，重复实例化只浪费内存 */
function subsetter(): Promise<FontSubsetter> {
  engine ??= fetch(WASM_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`子集化 wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => createHarfBuzzSubsetter(bytes));
  return engine;
}

/**
 * 导出用的字体选项：嵌入字体按页字符集子集化 + 替代字体命中切片内联。
 *
 * - 引擎加载失败降级为不传 `subsetter`（整字体内联，即旧行为）；wasm 随应用分发，
 *   失败只可能是构建问题，降级保证导出本身不受阻。
 * - 替代脸集独立生效：切片取不到时 `exportFontFaces` 自身已按 reason 降级。
 * - 中文替代不跟随预览的省流开关：预览关 cjk 是带宽取舍，导出是显式交付动作，
 *   收件人的机器上没有「系统字体兜底也够看」的保证。
 */
export async function exportFontOptions(slides: readonly Slide[]): Promise<ExportFontOptions | undefined> {
  const [engineReady, faces] = await Promise.all([
    subsetter().then(
      (value) => value,
      () => undefined,
    ),
    exportFontFaces(collectFonts(slides)).catch(() => []),
  ]);
  if (!engineReady) return faces.length ? { extraFontFaces: faces } : undefined;
  return { subsetter: engineReady, extraFontFaces: faces };
}
