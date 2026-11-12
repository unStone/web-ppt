/**
 * 导出子集化引擎入口。
 *
 * `createHarfBuzzSubsetter` 是 HarfBuzz 适配器；wasm 与字体字节都由宿主提供。
 * 产出的 `FontSubsetter` 直接作为 core 导出选项 `fonts.subsetter` 传入。
 */
export { createHarfBuzzSubsetter } from './harfbuzz';
