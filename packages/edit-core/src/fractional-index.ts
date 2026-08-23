import type { FractionalIndex } from './types';

// ASCII 顺序与这里完全一致，因此普通字符串比较就是 z 序比较。
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const WIDTH = 8;
const BASE_BIG = BigInt(BASE);
const CAPACITY = BASE_BIG ** BigInt(WIDTH);
const START = (CAPACITY / 4n / BASE_BIG) * BASE_BIG;

function digit(ch: string): number {
  const value = DIGITS.indexOf(ch);
  if (value < 0) throw new Error(`非法分数序字符：${JSON.stringify(ch)}`);
  return value;
}

function assertKey(key: string): void {
  if (!key) throw new Error('分数序不能为空');
  for (const ch of key) digit(ch);
  // 最小字符结尾会产生没有可插入字符串的开区间，生成器永远不产这种键。
  if (key.endsWith(DIGITS[0])) throw new Error('分数序不能以最小字符结尾');
}

function encodeFixed(value: bigint): FractionalIndex {
  if (value < 0n || value >= CAPACITY) throw new Error('初始分数序超出容量');
  let rest = value;
  let out = '';
  for (let i = 0; i < WIDTH; i++) {
    out = DIGITS[Number(rest % BASE_BIG)] + out;
    rest /= BASE_BIG;
  }
  return out;
}

/** 初始兄弟顺序留出 61 个直接插槽，避免导入大文档时键长随元素数增长。 */
export function initialFractionalIndex(index: number): FractionalIndex {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('初始分数序下标必须是非负安全整数');
  return encodeFixed(START + BigInt(index) * BASE_BIG + BigInt(Math.floor(BASE / 2)));
}

function encodeDiscriminator(value: string): string {
  let out = 'z';
  // JS code unit 固定三位，既无拼接歧义，也不会把两个不同的非法代理项都编码成 U+FFFD。
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    out += DIGITS[Math.floor(unit / (BASE * BASE))]
      + DIGITS[Math.floor(unit / BASE) % BASE]
      + DIGITS[unit % BASE];
  }
  // 结尾 V 保持合法键不以 0 收尾。
  return `${out}V`;
}

/**
 * 生成严格位于 lower 与 upper 之间的字典序键；null 表示无界。
 * 只要输入来自本模块，就能无限向任一边或任意相邻键之间继续插入。
 */
function midpointBetween(
  lower: FractionalIndex | null,
  upper: FractionalIndex | null,
): FractionalIndex {
  if (lower !== null) assertKey(lower);
  if (upper !== null) assertKey(upper);
  if (lower !== null && upper !== null && lower >= upper) {
    throw new Error(`分数序边界无效：${lower} >= ${upper}`);
  }

  let prefix = '';
  let offset = 0;
  for (;;) {
    const lo = lower === null || offset >= lower.length ? -1 : digit(lower[offset]);
    const hi = upper === null || offset >= upper.length ? BASE : digit(upper[offset]);

    if (lo === hi) {
      prefix += DIGITS[lo];
      offset++;
      continue;
    }
    if (lo + 1 < hi) {
      const middle = Math.floor((lo + hi) / 2);
      // lower 恰好结束且中点落在 0 时，追加一个中位后缀，避免生成非法的 0 结尾。
      if (lo === -1 && middle === 0) return prefix + DIGITS[0] + midpointBetween(null, null);
      return prefix + DIGITS[middle];
    }
    if (lo === -1) {
      const suffix = upper?.slice(offset + 1) ?? '';
      if (!suffix) throw new Error('上界不是本模块生成的合法分数序');
      return prefix + DIGITS[0] + midpointBetween(null, suffix);
    }

    const suffix = lower && offset + 1 < lower.length ? lower.slice(offset + 1) : null;
    return prefix + DIGITS[lo] + midpointBetween(suffix, null);
  }
}

/**
 * `discriminator` 供协同插入传稳定唯一值（通常就是新元素 ULID）。中点本身已在边界的
 * 某一位留出严格间隙，因此追加编码后仍在原开区间内；不同客户端不会占用同一个 z。
 */
export function fractionalIndexBetween(
  lower: FractionalIndex | null,
  upper: FractionalIndex | null,
  discriminator?: string,
): FractionalIndex {
  const midpoint = midpointBetween(lower, upper);
  return discriminator === undefined ? midpoint : midpoint + encodeDiscriminator(discriminator);
}

export function compareFractionalIndex(a: FractionalIndex, b: FractionalIndex): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
