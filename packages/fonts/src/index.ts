/**
 * @web-ppt/fonts —— 字体替换与按需加载。
 *
 * 默认入口解决的是**文件没带字体、本机也没装**的情况：拉丁用度量兼容的免费字体，
 * 断行与 PowerPoint 逐字对齐；中文换成思源系，行高靠 @font-face 描述符拉近。
 *
 * 包里**一个字节的字体都没有**：切片指向 fontsource 的已发布版本，
 * 由 jsDelivr 分发，用不到就不下载。
 * 显式字体字节与字形能力见独立的 ./glyphs 按需入口。
 */
export { SUBSTITUTIONS, substituteFor } from './substitute';
export type { Substitution } from './substitute';
export { DEFAULT_BASE, PACKAGES, cssUrl } from './sources';
export type { FontPackage } from './sources';
export { isInstalled, loadFontsFor, rewriteFontFaceCss, unloadFonts } from './load';
export type { LoadOptions, LoadResult } from './load';
