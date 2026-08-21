/**
 * PPT 字体 → 免费替代字体。
 *
 * 拉丁一栏挑的全是**度量兼容**字体：每个字符的前进宽度与原字体逐一相等，
 * 于是断行位置与 PowerPoint 逐字对齐。LibreOffice 用的就是这一套，
 * 它解决的正是 README 里「字体缺失导致的断行差异」那条。
 *
 * 中文没有度量兼容品，但影响比想象小：汉字都是 1em 全角等宽，换字体不改前进宽度，
 * 偏差只来自 CJK 字体里的西文 / 数字 / 标点。行高用 @font-face 的
 * `size-adjust` / `ascent-override` 拉齐即可。
 *
 * 只收**可再分发、可子集化**的字体（OFL / Apache）。MiSans、HarmonyOS Sans、
 * 阿里普惠、OPPO Sans 这些「免费商用」的许可各自限制再分发与改字，不进内置表——
 * 想用的人自己往 `overrides` 里加。
 */

/** 一条替换规则 */
export interface Substitution {
  /** 替代字体的家族名 */
  family: string;
  /**
   * 前进宽度与原字体逐字相等。为真时断行与 PowerPoint 完全一致，
   * 为假时只是形近，行高仍可能要靠 `size-adjust` 修。
   */
  metricCompatible: boolean;
  /** 中日韩字体：切片多、体积大，加载策略与拉丁不同 */
  cjk: boolean;
}

const LATIN: Record<string, Substitution> = {
  calibri: { family: 'Carlito', metricCompatible: true, cjk: false },
  'calibri light': { family: 'Carlito', metricCompatible: true, cjk: false },
  cambria: { family: 'Caladea', metricCompatible: true, cjk: false },
  'cambria math': { family: 'Caladea', metricCompatible: true, cjk: false },
  arial: { family: 'Arimo', metricCompatible: true, cjk: false },
  'arial narrow': { family: 'Arimo', metricCompatible: true, cjk: false },
  helvetica: { family: 'Arimo', metricCompatible: true, cjk: false },
  'helvetica neue': { family: 'Arimo', metricCompatible: true, cjk: false },
  'liberation sans': { family: 'Arimo', metricCompatible: true, cjk: false },
  'times new roman': { family: 'Tinos', metricCompatible: true, cjk: false },
  times: { family: 'Tinos', metricCompatible: true, cjk: false },
  'liberation serif': { family: 'Tinos', metricCompatible: true, cjk: false },
  'courier new': { family: 'Cousine', metricCompatible: true, cjk: false },
  courier: { family: 'Cousine', metricCompatible: true, cjk: false },
  consolas: { family: 'Cousine', metricCompatible: false, cjk: false },
  'liberation mono': { family: 'Cousine', metricCompatible: true, cjk: false },
  // 无度量兼容品，只能形近
  'segoe ui': { family: 'Open Sans', metricCompatible: false, cjk: false },
  tahoma: { family: 'Open Sans', metricCompatible: false, cjk: false },
  verdana: { family: 'Open Sans', metricCompatible: false, cjk: false },
  georgia: { family: 'Tinos', metricCompatible: false, cjk: false },
};

const CJK: Record<string, Substitution> = {
  // 黑体系
  微软雅黑: { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  'microsoft yahei': { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  'microsoft yahei ui': { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  苹方: { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  'pingfang sc': { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  黑体: { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  simhei: { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  等线: { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  dengxian: { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  'source han sans sc': { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  思源黑体: { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  'hiragino sans gb': { family: 'Noto Sans SC', metricCompatible: false, cjk: true },
  // 宋体系
  宋体: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  simsun: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  新宋体: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  nsimsun: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  华文宋体: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  'stsong': { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  思源宋体: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  'source han serif sc': { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  // 楷体：霞鹜文楷的 OFL 头里有一条附加许可，明确允许「专用于 web font 分发」
  // 的子集 / WOFF2 转换保留原名，正好是这里的用法
  楷体: { family: 'LXGW WenKai', metricCompatible: false, cjk: true },
  kaiti: { family: 'LXGW WenKai', metricCompatible: false, cjk: true },
  华文楷体: { family: 'LXGW WenKai', metricCompatible: false, cjk: true },
  stkaiti: { family: 'LXGW WenKai', metricCompatible: false, cjk: true },
  // 仿宋没有对位的免费品，退到宋体系比退到黑体近
  仿宋: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
  fangsong: { family: 'Noto Serif SC', metricCompatible: false, cjk: true },
};

/** 内置替换表；键是小写后的原字体名 */
export const SUBSTITUTIONS: Readonly<Record<string, Substitution>> = { ...LATIN, ...CJK };

/**
 * 符号字体不该找替代品——它们是私用区自定义映射，换一份字体只会得到另一套
 * 不相干的图形。渲染层已经把这类项目符号换成了 `•`。
 */
const SYMBOL = /^(wingdings|webdings|symbol|marlett)/i;

/** 查一个字体该用什么替代；没有对应项返回 null */
export function substituteFor(
  family: string,
  overrides?: Readonly<Record<string, Substitution>>,
): Substitution | null {
  const key = family.trim().toLowerCase();
  if (!key || SYMBOL.test(key)) return null;
  return overrides?.[key] ?? SUBSTITUTIONS[key] ?? null;
}
