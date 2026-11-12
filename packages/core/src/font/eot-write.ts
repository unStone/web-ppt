/**
 * 嵌入字体的写入：sfnt → EOT 容器 + 嵌入权利判定。
 *
 * 读侧（eot.ts）剥容器、glyphs Provider 校验许可；写侧是同一规范的逆方向。
 * PowerPoint 的 `ppt/fonts/*.fntdata` 是 EOT 容器——裸 sfnt 塞进去，PowerPoint
 * 自己能容忍，但 Quick Look 与其它读侧按 EOT 头解释，直接报错。写入统一封容器。
 *
 * 容器头为 EOT v1：定长部分 + 四个变长字符串（Family / Style / Version / FullName），
 * 每个字符串前置一个 USHORT Padding（W3C Embedded OpenType 提交文档的格式规定）。
 * 不做 MTX 压缩（无开源压缩器），Flags 里只置 TTEMBED_SUBSET 这类**描述性**位。
 */

const TTEMBED_SUBSET = 0x00000001;
/** 字体数据整体异或混淆，密钥固定 0x50；读写两侧共用该常量语义 */
const TTEMBED_XORENCRYPTDATA = 0x10000000;

export { TTEMBED_SUBSET, TTEMBED_XORENCRYPTDATA };

/** 嵌入权利（OS/2 fsType 的低四位 usage + 两位限制） */
export interface EmbeddingRights {
  usage: 'installable' | 'editable' | 'view-print' | 'restricted';
  subsetAllowed: boolean;
  outlineAllowed: boolean;
}

export type EmbeddingCheck = { ok: true; rights: EmbeddingRights } | { ok: false; reason: string };

const le16 = (target: number[], v: number): void => {
  target.push(v & 0xff, (v >> 8) & 0xff);
};
const le32 = (target: number[], v: number): void => {
  target.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
};
// sfnt 的表目录与表内容按规范是大端；EOT 容器头才是小端（与 eot.ts 的剥头一致）
const be16 = (bytes: Uint8Array, at: number): number => (bytes[at] << 8) | bytes[at + 1];
const be32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

/** sfnt 表目录里找一张表；TTC 首个 face（offset 0 的表目录） */
function tableOffset(bytes: Uint8Array, tag: string): { offset: number; length: number } | null {
  const count = be16(bytes, 4);
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(bytes[record], bytes[record + 1], bytes[record + 2], bytes[record + 3]) === tag) {
      return { offset: be32(bytes, record + 8), length: be32(bytes, record + 12) };
    }
  }
  return null;
}

/**
 * 读 sfnt 的 OS/2 表并判定嵌入权利。
 *
 * 语义与 `@web-ppt/fonts/glyphs` 的 `embeddingRights` + `embeddingProblem` 一致
 * （usage 低四位按 OS/2 版本解释、0x100/0x200 限制位 version 2 起），实现独立于
 * fonts 包：依赖方向是 fonts → core，core 不能反向 import。`writable` 是**写入
 * 边界**的判定：restricted 与 outline 限制（bitmap-only）一律不可写；view-print
 * 允许写入——PowerPoint 对这类字体的编辑限制由读方按嵌入位自判。TTC 只读首个
 * face——写入按单 face 处理。
 */
export function sfntEmbeddingRights(bytes: Uint8Array): EmbeddingCheck {
  if (bytes.length < 12) return { ok: false, reason: 'invalid-font' };
  const os2 = tableOffset(bytes, 'OS/2');
  if (!os2 || os2.length < 10) return { ok: false, reason: 'invalid-font' };
  const version = be16(bytes, os2.offset);
  const fsType = be16(bytes, os2.offset + 8);
  const usage = fsType & 15;
  // OS/2 0–2 的混合使用标志取较宽权限，3 起必须互斥；0–1 不解释高位限制
  if (version > 5 || usage & 1 || (version >= 3 && ![0, 2, 4, 8].includes(usage)) || (version >= 2 && fsType & 0xfcf0)) {
    return { ok: false, reason: 'invalid-font' };
  }
  const outlineAllowed = version < 2 || !(fsType & 0x200);
  const rights: EmbeddingRights = {
    usage: usage & 8 ? 'editable' : usage & 4 ? 'view-print' : usage & 2 ? 'restricted' : 'installable',
    subsetAllowed: version < 2 || !(fsType & 0x100),
    outlineAllowed,
  };
  if (!outlineAllowed) return { ok: false, reason: 'bitmap-only' };
  if (rights.usage === 'restricted') return { ok: false, reason: 'embedding-restricted' };
  return { ok: true, rights };
}

export interface EotContainerOptions {
  family: string;
  /** 常规 / Bold / Italic / Bold Italic 的样式名 */
  style?: string;
  bold?: boolean;
  italic?: boolean;
  /** 字体真实的 OS/2 fsType；容器头原样回写，读方据此保留许可边界 */
  fsType?: number;
  /** 已按使用字符子集化（写入侧只置描述位，不做压缩） */
  subset?: boolean;
  /** 整体 XOR 0x50 混淆；EOTVersion 与 Flags 不受影响 */
  xor?: boolean;
}

/**
 * sfnt 字体数据 → EOT 容器。
 *
 * PANOSE / UnicodeRange / CodePageRange / CheckSum / Reserved 全部填 0——
 * 这些是「未指定」值，读方（浏览器、PowerPoint、本仓库剥头）按字体数据自定；
 * 剥头逻辑只依赖 EOTSize / FontDataSize / Flags / MagicNumber / 字符串区。
 */
export function wrapEotContainer(fontData: Uint8Array, options: EotContainerOptions): Uint8Array {
  const { family, bold = false, italic = false } = options;
  if (!family.trim() || family.length > 256 || /[\u0000-\u001f\u007f]/.test(family)) {
    throw new Error(`嵌入字体的家族名不合法：${JSON.stringify(family.slice(0, 32))}`);
  }
  const style = options.style ?? (bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular');
  let data = fontData;
  if (options.xor) {
    data = fontData.slice();
    for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  }

  const head: number[] = [];
  for (let i = 0; i < 10; i++) head.push(0); // FontPANOSE
  head.push(1); // Charset = DEFAULT_CHARSET（单字节；多写一字节会把 MagicNumber 顶出偏移 34）
  head.push(italic ? 1 : 0);
  le32(head, bold ? 700 : 400); // Weight
  le16(head, options.fsType ?? 0);
  le16(head, 0x504c); // MagicNumber，固定在偏移 34
  for (let i = 0; i < 8; i++) le32(head, 0); // UnicodeRange 1..4
  for (let i = 0; i < 2; i++) le32(head, 0); // CodePageRange 1..2
  le32(head, 0); // CheckSumAdjustment
  for (let i = 0; i < 4; i++) le32(head, 0); // Reserved 1..4
  const str = (s: string): void => {
    le16(head, 0); // USHORT Padding，格式规定如此
    const units: number[] = [];
    for (const ch of s) units.push(ch.codePointAt(0) ?? 0);
    le16(head, units.length * 2);
    for (const unit of units) le16(head, unit);
  };
  str(family);
  str(style);
  str('1.0');
  str(`${family} ${style}`);

  const flags = (options.subset ? TTEMBED_SUBSET : 0) | (options.xor ? TTEMBED_XORENCRYPTDATA : 0);
  const out: number[] = [];
  le32(out, 16 + head.length + data.length); // EOTSize
  le32(out, data.length); // FontDataSize
  le32(out, 0x00010000); // EOTVersion
  le32(out, flags);
  const bytes = new Uint8Array(16 + head.length + data.length);
  bytes.set(out, 0);
  bytes.set(head, 16);
  bytes.set(data, 16 + head.length);
  return bytes;
}
