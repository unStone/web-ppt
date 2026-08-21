/**
 * 嵌入字体的还原：EOT 容器 → 浏览器能用的 sfnt。
 *
 * PowerPoint 的 `ppt/fonts/*.fntdata` **不是裸 TTF**，是 EOT（Embedded OpenType）
 * 容器，而且基本都开了 MTX（MicroType Express）压缩——实测 POI 语料里 6 个字体部件
 * 全是压缩 EOT，零个裸 sfnt。直接把这段字节塞进 `@font-face`，浏览器会在控制台
 * 报 `invalid sfntVersion` 然后整份丢掉：它把 EOT 头四个字节当成了 sfnt 版本号。
 *
 * 未压缩的 EOT 只要剥掉头就能用，这里自己处理；MTX 解压是另一码事（LZCOMP +
 * CTF 重建），体积和 EMF 解码器一个量级，因此走 hook 注入，与解析器解耦。
 * 没注入解码器时压缩字体**直接放弃**——塞一份浏览器注定拒绝的字节没有任何好处。
 *
 * @see http://www.w3.org/Submission/EOT/
 */

/** EOT 里的 `MagicNumber` 字段，位置固定在偏移 34（小端） */
const EOT_MAGIC = 0x504c;
/** 字体数据经 MTX 压缩 */
const TTEMBED_TTCOMPRESSED = 0x00000004;
/** 字体数据整体异或混淆，密钥固定 0x50 */
const TTEMBED_XORENCRYPTDATA = 0x10000000;

/**
 * EOT 容器 → sfnt 字节。拿不出可用字体时返回 null。
 *
 * 只在字体确实是 MTX 压缩时才会被调用，未压缩的容器解析器自己就能剥。
 * 入参是**整份 EOT**（不是切出来的字体数据），这样 `mtx-decompressor` 的
 * `eotToTtf` 可以直接注册，不必再包一层。
 */
export type FontDecoder = (eot: Uint8Array) => Uint8Array | null;

let decoder: FontDecoder | null = null;

/** 传 null 注销（测试里要能恢复到「没有解码器」的状态） */
export function setFontDecoder(fn: FontDecoder | null): void {
  decoder = fn;
}

export function hasFontDecoder(): boolean {
  return decoder !== null;
}

/** 还原出来的字体 */
export interface DecodedFont {
  data: Uint8Array;
  /** Blob 的 MIME，按魔数判定而不是靠扩展名 */
  mime: string;
}

const be32 = (b: Uint8Array, at: number): number =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const le32 = (b: Uint8Array, at: number): number =>
  ((b[at + 3] << 24) | (b[at + 2] << 16) | (b[at + 1] << 8) | b[at]) >>> 0;
const le16 = (b: Uint8Array, at: number): number => (b[at + 1] << 8) | b[at];

/** 已经是浏览器直接认的字体格式就原样放行 */
function sfntMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  switch (be32(bytes, 0)) {
    case 0x00010000: // TrueType 轮廓
    case 0x74727565: // 'true'，老 Mac TrueType
    case 0x74746366: // 'ttcf'，TrueType 集合
      return 'font/ttf';
    case 0x4f54544f: // 'OTTO'，CFF 轮廓
      return 'font/otf';
    case 0x774f4646: // 'wOFF'
      return 'font/woff';
    case 0x774f4632: // 'wOF2'
      return 'font/woff2';
    default:
      return null;
  }
}

/**
 * 嵌入字体字节 → 浏览器能用的字体。无法还原时返回 null。
 *
 * 判定顺序：已是 sfnt / WOFF → 原样用；是 EOT → 按 Flags 决定剥头、解异或、
 * 还是交给注入的解码器；都不是 → 放弃。
 */
export function embeddedFontToSfnt(bytes: Uint8Array): DecodedFont | null {
  const direct = sfntMime(bytes);
  if (direct) return { data: bytes, mime: direct };

  // EOT 头至少 82 字节（v1 定长部分 + 四个空字符串）；Magic 的位置是固定的
  if (bytes.length < 82 || le16(bytes, 34) !== EOT_MAGIC) return null;

  const flags = le32(bytes, 12);
  if (flags & TTEMBED_TTCOMPRESSED) {
    if (!decoder) return null;
    let out: Uint8Array | null = null;
    try {
      out = decoder(bytes);
    } catch {
      return null; // 解码器抛错只该丢这一个字体，不该让整份文件解析失败
    }
    if (!out?.length) return null;
    return { data: out, mime: sfntMime(out) ?? 'font/ttf' };
  }

  // 未压缩：字体数据就是文件末尾的 FontDataSize 个字节
  // （EOTSize − FontDataSize 即变长头的长度，不必逐字段走完整个头）
  const size = le32(bytes, 4);
  if (!size || size > bytes.length - 82) return null;
  let data = bytes.subarray(bytes.length - size);

  if (flags & TTEMBED_XORENCRYPTDATA) {
    data = data.slice();
    for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  }
  const mime = sfntMime(data);
  return mime ? { data, mime } : null;
}
