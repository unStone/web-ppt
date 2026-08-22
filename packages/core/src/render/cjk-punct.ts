/**
 * CJK 标点挤压。
 *
 * 汉字和全角标点都占一个字宽的方格，但标点的墨迹只占半格：`，` `。` 的墨在
 * 左半格，`（` `《` 的墨在右半格，另外半格是空的。一行放不下时，PowerPoint
 * 会把这些空半格挤掉再排。
 *
 * 这件事的分量比听上去大。实测一份小学课件里「数一数，画一画。」这类标题
 * 出现 9 次，每次都是：可用 354px、按全角要 370px、挤压后 323px。文件里那些
 * 文本框都带 `spAutoFit`，框高是 PowerPoint 按**一行**算完写进去的——等于文件
 * 自己作证 PowerPoint 排的是一行。不挤压就会多断出一行，整页版式跟着塌。
 *
 * 换字体救不了：所有中文字体的方格一样大，黑体、PingFang、思源黑体量出来
 * 完全相同。这也是为什么字体替换对这类问题毫无帮助。
 *
 * 规则取「放不下才挤」：放得下时保持全角。PowerPoint 的完整标点挤压规则
 * （连续标点、行首行尾各有不同处理）比这复杂，但那些差异只影响标点周围的
 * 空隙，而**断行位置**是版式塌不塌的关键，先把这一条做对。
 */

/** 墨在左半格，可挤掉右半格：句读与各类收尾符号 */
const CLOSING = /[、。，．：；！？」』】〕）》〉｝］”’]/;
/** 墨在右半格，可挤掉左半格：各类起始符号 */
const OPENING = /[「『【〔（《〈｛［“‘]/;

/** 起始符号（墨在右半格），挤压时它自己左移；其余可挤符号是后面的字左移 */
export const isOpening = (ch: string): boolean => OPENING.test(ch);

/** 可挤压的宽度，单位是 em；不可挤压返回 0 */
export function squeezeEm(ch: string): number {
  return CLOSING.test(ch) || OPENING.test(ch) ? 0.5 : 0;
}

/** 一段文字全部挤压后能省下多少 em */
export function squeezeTotal(text: string): number {
  let n = 0;
  for (const ch of text) n += squeezeEm(ch);
  return n;
}

/**
 * 是否是占满一个字宽的全角字符（汉字、假名、全角标点、CJK 符号）。
 * 量不到字时的回退估算要用它——把中文按半角算会窄掉将近一半。
 */
export function isFullWidth(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x1100 && c <= 0x115f)      // 韩文字母
    || (c >= 0x2e80 && c <= 0x303e)        // CJK 部首、假名标点、CJK 符号
    || (c >= 0x3041 && c <= 0x33ff)        // 假名、注音、兼容符号
    || (c >= 0x3400 && c <= 0x4dbf)        // 扩展 A
    || (c >= 0x4e00 && c <= 0x9fff)        // 统一汉字
    || (c >= 0xa000 && c <= 0xa4cf)        // 彝文
    || (c >= 0xac00 && c <= 0xd7a3)        // 韩文音节
    || (c >= 0xf900 && c <= 0xfaff)        // 兼容汉字
    || (c >= 0xfe30 && c <= 0xfe6f)        // 竖排 / 小写变体
    || (c >= 0xff00 && c <= 0xff60)        // 全角 ASCII 与标点
    || (c >= 0xffe0 && c <= 0xffe6)        // 全角货币符号
    || (c >= 0x20000 && c <= 0x3fffd);     // 扩展 B 及以后
}
