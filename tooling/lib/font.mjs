/**
 * 固件用的最小字体工具：手写一份合法 TrueType，再按需套上 EOT 容器。
 *
 * 为什么不直接塞一份现成字体：固件必须确定性、必须可解释，而且不该把
 * 第三方字体连同它的授权一起拖进仓库。这里生成的字体只有 .notdef 和 'A'
 * 两个字形——够证明「解出来的确实是一份 sfnt」，也就够了。
 */

const enc = new TextEncoder();

const u8 = (v) => [v & 0xff];
const u16 = (v) => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const i16 = (v) => u16(v < 0 ? v + 0x10000 : v);
const bytes = (arr) => Uint8Array.from(arr);

/** sfnt 校验和：按大端 U32 求和，末尾不足四字节补零 */
function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const w = ((buf[i] << 24) | ((buf[i + 1] ?? 0) << 16) | ((buf[i + 2] ?? 0) << 8) | (buf[i + 3] ?? 0)) >>> 0;
    sum = (sum + w) >>> 0;
  }
  return sum;
}

/** platform 3 / encoding 1 的 name 记录用 UTF-16BE */
function utf16be(s) {
  const out = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      out.push(...u16(0xd800 | (v >> 10)), ...u16(0xdc00 | (v & 0x3ff)));
    } else out.push(...u16(cp));
  }
  return out;
}

/**
 * 生成一份最小 TrueType。
 * `family` / `style` 写进 name 表，`bold` / `italic` 反映在 head.macStyle。
 */
export function makeTtf({ family = 'WebPPT Test', style = 'Regular', bold = false, italic = false } = {}) {
  const UPEM = 1000;
  // 'A' 画成一个矩形：4 个点、1 条轮廓，够证明 glyf/loca 是通的。
  // 长度必须是偶数——short 格式的 loca 存的是偏移的一半。
  const glyphA = [
    ...i16(1), ...i16(100), ...i16(0), ...i16(500), ...i16(700), // numberOfContours + 包围盒
    ...u16(3),                                                    // endPtsOfContours
    ...u16(0),                                                    // instructionLength
    ...u8(1), ...u8(1), ...u8(1), ...u8(1),                       // flags：4 个点都在曲线上
    ...i16(100), ...i16(400), ...i16(0), ...i16(-400),            // x 增量
    ...i16(0), ...i16(0), ...i16(700), ...i16(0),                 // y 增量
  ];

  const tables = new Map();
  // .notdef 长度为 0，'A' 紧随其后
  tables.set('glyf', bytes(glyphA));
  tables.set('loca', bytes([...u16(0), ...u16(0), ...u16(glyphA.length / 2)]));
  tables.set('head', bytes([
    ...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5),
    ...u16(0x000b), ...u16(UPEM),
    ...u32(0), ...u32(0), ...u32(0), ...u32(0),                   // created / modified 固定为 0，保证可重复
    ...i16(100), ...i16(0), ...i16(500), ...i16(700),             // 全局包围盒
    ...u16((bold ? 1 : 0) | (italic ? 2 : 0)),                    // macStyle
    ...u16(8), ...i16(2), ...i16(0), ...i16(0),                   // lowestRecPPEM / fontDirectionHint / indexToLocFormat / glyphDataFormat
  ]));
  tables.set('hhea', bytes([
    ...u32(0x00010000), ...i16(800), ...i16(-200), ...i16(0),
    ...u16(600), ...i16(0), ...i16(0), ...i16(600),
    ...i16(1), ...i16(0), ...i16(0),
    ...i16(0), ...i16(0), ...i16(0), ...i16(0),
    ...i16(0), ...u16(2),                                          // metricDataFormat / numberOfHMetrics
  ]));
  tables.set('maxp', bytes([
    ...u32(0x00010000), ...u16(2),
    ...u16(4), ...u16(0), ...u16(0), ...u16(0), ...u16(1), ...u16(0),
    ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
  ]));
  tables.set('hmtx', bytes([...u16(600), ...i16(0), ...u16(600), ...i16(100)]));

  // cmap：format 4，只映射 'A'
  const sub4 = [
    ...u16(4), ...u16(32), ...u16(0),
    ...u16(4), ...u16(4), ...u16(1), ...u16(0),
    ...u16(0x41), ...u16(0xffff),
    ...u16(0),
    ...u16(0x41), ...u16(0xffff),
    ...i16(1 - 0x41), ...i16(1),
    ...u16(0), ...u16(0),
  ];
  tables.set('cmap', bytes([...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12), ...sub4]));

  const strings = [family, style, `${family} ${style}`, `${family.replace(/\s+/g, '')}-${style.replace(/\s+/g, '')}`];
  const ids = [1, 2, 4, 6];
  let strOff = 0;
  const records = [];
  const pool = [];
  strings.forEach((s, i) => {
    const b = utf16be(s);
    records.push(...u16(3), ...u16(1), ...u16(0x0409), ...u16(ids[i]), ...u16(b.length), ...u16(strOff));
    pool.push(...b);
    strOff += b.length;
  });
  tables.set('name', bytes([...u16(0), ...u16(strings.length), ...u16(6 + records.length), ...records, ...pool]));

  // OS/2 version 4 定长 96 字节，字段顺序照 spec 排，别少也别多
  tables.set('OS/2', bytes([
    ...u16(4), ...i16(600), ...u16(bold ? 700 : 400), ...u16(5), ...u16(0),
    ...i16(650), ...i16(600), ...i16(0), ...i16(75), ...i16(650), ...i16(600), ...i16(0), ...i16(350),
    ...i16(50), ...i16(300),                                       // yStrikeoutSize / Position
    ...i16(0),                                                     // sFamilyClass
    ...new Array(10).fill(0),                                      // panose
    ...u32(1), ...u32(0), ...u32(0), ...u32(0),                    // ulUnicodeRange1..4
    ...enc.encode('WPPT'),                                          // achVendID
    ...u16((italic ? 1 : 0) | (bold ? 32 : 0)),                    // fsSelection
    ...u16(0x41), ...u16(0x41),                                     // usFirstCharIndex / usLastCharIndex
    ...i16(800), ...i16(-200), ...i16(0), ...u16(800), ...u16(200),
    ...u32(1), ...u32(0),                                           // ulCodePageRange1..2
    ...i16(500), ...i16(700), ...u16(0), ...u16(0x20), ...u16(1),
  ]));
  tables.set('post', bytes([...u32(0x00030000), ...u32(0), ...i16(0), ...i16(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0)]));

  // 表目录按 tag 升序；目录里记的是**真实长度**，四字节对齐靠表之间补零
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const log2 = Math.floor(Math.log2(n));
  const align = (v) => (v + 3) & ~3;
  let off = 12 + n * 16;
  const dir = [...u32(0x00010000), ...u16(n), ...u16(16 * 2 ** log2), ...u16(log2), ...u16(n * 16 - 16 * 2 ** log2)];
  for (const tag of tags) {
    const buf = tables.get(tag);
    dir.push(...enc.encode(tag), ...u32(checksum(buf)), ...u32(off), ...u32(buf.length));
    off = align(off + buf.length);
  }

  const out = new Uint8Array(off);
  out.set(bytes(dir), 0);
  let at = 12 + n * 16;
  for (const tag of tags) {
    out.set(tables.get(tag), at);
    at = align(at + tables.get(tag).length);
  }
  return out;
}

/** EOT 标志位 */
export const TTEMBED_SUBSET = 0x00000001;
export const TTEMBED_TTCOMPRESSED = 0x00000004;
export const TTEMBED_XORENCRYPTDATA = 0x10000000;

/**
 * 把字体数据套进 EOT 容器（v1 头，四个变长字符串）。
 *
 * `flags` 里带 TTCOMPRESSED 时**不会**真去做 MTX 压缩——没有开源的压缩器，
 * 而解析器在这条分支上唯一该做的事就是「把整份容器交给注入的解码器」，
 * 载荷是什么它不看。固件因此只负责把标志位摆对。
 */
export function wrapEot(fontData, { flags = 0, familyName = 'WebPPT Test', styleName = 'Regular', bold = false, italic = false } = {}) {
  let data = fontData;
  if (flags & TTEMBED_XORENCRYPTDATA) {
    data = fontData.slice();
    for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  }

  const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
  const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  /** 每个变长字符串前面都有一个 USHORT Padding，格式规定如此 */
  const str = (s) => {
    const b = [];
    for (const ch of s) b.push(...le16(ch.codePointAt(0)));
    return [...le16(0), ...le16(b.length), ...b];
  };

  const head = [
    ...new Array(10).fill(0),                    // FontPANOSE
    ...u8(1),                                     // Charset = DEFAULT_CHARSET
    ...u8(italic ? 1 : 0),
    ...le32(bold ? 700 : 400),
    ...le16(0),                                   // fsType
    ...le16(0x504c),                              // MagicNumber
    ...le32(0), ...le32(0), ...le32(0), ...le32(0), // UnicodeRange 1..4
    ...le32(0), ...le32(0),                        // CodePageRange 1..2
    ...le32(0),                                   // CheckSumAdjustment
    ...le32(0), ...le32(0), ...le32(0), ...le32(0), // Reserved 1..4
    ...str(familyName), ...str(styleName), ...str('1.0'), ...str(`${familyName} ${styleName}`),
  ];

  const total = 16 + head.length + data.length;
  return Uint8Array.from([...le32(total), ...le32(data.length), ...le32(0x00010000), ...le32(flags), ...head, ...data]);
}
