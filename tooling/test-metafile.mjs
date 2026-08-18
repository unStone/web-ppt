/**
 * EMF / WMF 解码器自测。
 *
 *   node tooling/test-metafile.mjs
 *
 * 1) 手工构造最小合法的 EMF / WMF 字节流，覆盖多边形填充、折线描边、矩形、椭圆、
 *    虚线笔、空画刷、文字、DIB 位图、SAVEDC/RESTOREDC、路径模式；
 * 2) 用 esbuild 把 src/image 打成临时 ESM，在 Node 里跑真实解码；
 * 3) 若本机有 LibreOffice，把 fixtures/showcase.pptx 转成 emf/wmf 作为真实样本一并断言；
 * 4) 追加截断 / 随机破坏的模糊测试，确保永不抛异常。
 *
 * 失败以非 0 退出码结束。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out/metafile');
mkdirSync(outDir, { recursive: true });

// ---------------- 断言框架 ----------------

let pass = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; return true; }
  failures.push(detail ? `${name} — ${detail}` : name);
  return false;
}

function group(title) {
  console.log(`\n\x1b[36m▸ ${title}\x1b[0m`);
}

// ---------------- 字节构造 ----------------

class Buf {
  constructor() { this.d = []; }
  u8(v) { this.d.push(v & 0xff); return this; }
  u16(v) { this.d.push(v & 0xff, (v >>> 8) & 0xff); return this; }
  i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v) { this.d.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); return this; }
  i32(v) { return this.u32(v < 0 ? v >>> 0 : v); }
  f32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return this.raw(b); }
  raw(a) { for (const v of a) this.d.push(v & 0xff); return this; }
  str16(s, bytes) {
    for (let i = 0; i < bytes / 2; i++) this.u16(i < s.length ? s.charCodeAt(i) : 0);
    return this;
  }
  str8(s, bytes) {
    for (let i = 0; i < bytes; i++) this.u8(i < s.length ? s.charCodeAt(i) & 0xff : 0);
    return this;
  }
  pad4() { while (this.d.length % 4) this.d.push(0); return this; }
  get length() { return this.d.length; }
  bytes() { return Uint8Array.from(this.d); }
}

const cat = (...arrs) => {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

/** COLORREF 0x00BBGGRR */
const colorref = (r, g, b) => (b << 16) | (g << 8) | r;

// ---------------- EMF 构造 ----------------

/** 一条 EMF 记录：type + size + 参数（补齐 4 字节）*/
function er(type, build) {
  const p = new Buf();
  if (build) build(p);
  p.pad4();
  return new Buf().u32(type).u32(8 + p.length).raw(p.bytes()).bytes();
}

const rectl = (p, l, t, r, b) => p.i32(l).i32(t).i32(r).i32(b);

function emfFile(records, { bw = 400, bh = 300 } = {}) {
  const body = cat(...records, er(14, (p) => p.u32(0).u32(0).u32(0))); // EMR_EOF
  const frameW = Math.round((bw / 96) * 2540);
  const frameH = Math.round((bh / 96) * 2540);
  const hdr = new Buf();
  hdr.u32(1).u32(88);
  rectl(hdr, 0, 0, bw - 1, bh - 1);          // rclBounds
  rectl(hdr, 0, 0, frameW, frameH);          // rclFrame（0.01mm）
  hdr.u32(0x464d4520).u32(0x00010000);       // ' EMF' + version
  hdr.u32(88 + body.length).u32(records.length + 2);
  hdr.u16(16).u16(0).u32(0).u32(0).u32(0);   // nHandles, reserved, description, palette
  hdr.i32(bw).i32(bh);                       // szlDevice
  hdr.i32(Math.round((bw / 96) * 25.4)).i32(Math.round((bh / 96) * 25.4)); // szlMillimeters
  return cat(hdr.bytes(), body);
}

// ---------------- WMF 构造 ----------------

/** 一条 WMF 记录：size(字数) + function + 参数 */
function wr(fn, build) {
  const p = new Buf();
  if (build) build(p);
  if (p.length % 2) p.u8(0);
  return new Buf().u32((6 + p.length) / 2).u16(fn).raw(p.bytes()).bytes();
}

/** WMF 矩形参数顺序：bottom, right, top, left */
const wrect = (p, l, t, r, b) => p.i16(b).i16(r).i16(t).i16(l);

function wmfFile(records, { bw = 4000, bh = 3000, inch = 1000 } = {}) {
  const body = cat(...records, wr(0x0000));
  const place = new Buf();
  place.u32(0x9ac6cdd7).u16(0);
  place.i16(0).i16(0).i16(bw).i16(bh);
  place.u16(inch).u32(0);
  // 校验和：前 10 个 word 的异或
  const words = new Uint16Array(Uint8Array.from(place.d).buffer);
  let sum = 0;
  for (let i = 0; i < 10; i++) sum ^= words[i];
  place.u16(sum);

  const maxRec = Math.max(3, ...records.map((r) => r.length / 2));
  const head = new Buf();
  head.u16(1).u16(9).u16(0x0300);
  head.u32((18 + body.length) / 2);
  head.u16(16).u32(maxRec).u16(0);
  return cat(place.bytes(), head.bytes(), body);
}

// ---------------- DIB 构造 ----------------

function bih(w, h, bpp, { comp = 0, clrUsed = 0, sizeImage = 0 } = {}) {
  return new Buf().u32(40).i32(w).i32(h).u16(1).u16(bpp)
    .u32(comp).u32(sizeImage).i32(2835).i32(2835).u32(clrUsed).u32(0);
}

/** 2x2 24 位真彩，自底向上、每行 4 字节对齐 */
function dib24() {
  const b = bih(2, 2, 24, { sizeImage: 16 });
  b.raw([0, 0, 255, 0, 255, 0, 0, 0]);       // 底行：红、绿
  b.raw([255, 0, 0, 255, 255, 255, 0, 0]);   // 顶行：蓝、白
  return b.bytes();
}

/** 4x4 8 位调色板（4 色）*/
function dib8() {
  const b = bih(4, 4, 8, { clrUsed: 4, sizeImage: 16 });
  b.raw([0, 0, 0, 0]).raw([0, 0, 255, 0]).raw([0, 255, 0, 0]).raw([255, 0, 0, 0]); // BGRA
  for (let y = 0; y < 4; y++) b.raw([0, 1, 2, 3]);
  return b.bytes();
}

/** 8x2 单色，带 2 项调色板 */
function dib1() {
  const b = bih(8, 2, 1, { clrUsed: 2, sizeImage: 8 });
  b.raw([0, 0, 0, 0]).raw([255, 255, 255, 0]);
  b.raw([0b10101010, 0, 0, 0]);
  b.raw([0b11110000, 0, 0, 0]);
  return b.bytes();
}

// ---------------- 样例：EMF ----------------

function buildEmf() {
  const recs = [];
  const push = (r) => recs.push(r);

  push(er(17, (p) => p.u32(1)));                                        // SETMAPMODE MM_TEXT
  push(er(19, (p) => p.u32(2)));                                        // SETPOLYFILLMODE WINDING

  // 实心红画刷 + 蓝色虚线笔
  push(er(39, (p) => p.u32(1).u32(0).u32(colorref(220, 20, 60)).u32(0)));   // CREATEBRUSHINDIRECT
  push(er(38, (p) => p.u32(2).u32(1).i32(3).i32(0).u32(colorref(20, 60, 220)))); // CREATEPEN PS_DASH w=3
  push(er(37, (p) => p.u32(1)));                                        // SELECTOBJECT brush
  push(er(37, (p) => p.u32(2)));                                        // SELECTOBJECT pen

  // 多边形填充（16 位变体）
  push(er(86, (p) => {                                                  // EMR_POLYGON16
    rectl(p, 20, 20, 120, 100);
    p.u32(3).i16(20).i16(100).i16(70).i16(20).i16(120).i16(100);
  }));

  // 空画刷 + 折线描边
  push(er(37, (p) => p.u32(0x80000005)));                               // SELECTOBJECT NULL_BRUSH
  push(er(87, (p) => {                                                  // EMR_POLYLINE16
    rectl(p, 140, 20, 260, 100);
    p.u32(4).i16(140).i16(100).i16(180).i16(20).i16(220).i16(100).i16(260).i16(20);
  }));

  push(er(43, (p) => rectl(p, 280, 20, 380, 100)));                     // RECTANGLE
  push(er(42, (p) => rectl(p, 20, 120, 120, 200)));                     // ELLIPSE
  push(er(44, (p) => { rectl(p, 140, 120, 260, 200); p.i32(24).i32(24); })); // ROUNDRECT
  push(er(45, (p) => { rectl(p, 270, 110, 380, 210); p.i32(380).i32(160).i32(325).i32(110); })); // ARC
  push(er(47, (p) => { rectl(p, 270, 110, 380, 210); p.i32(380).i32(160).i32(325).i32(110); })); // PIE
  push(er(46, (p) => { rectl(p, 270, 110, 380, 210); p.i32(380).i32(160).i32(325).i32(110); })); // CHORD

  // SAVEDC → 世界变换 → 画一个被缩放的矩形 → RESTOREDC
  push(er(33));                                                         // SAVEDC
  push(er(35, (p) => p.f32(0.5).f32(0).f32(0).f32(0.5).f32(10).f32(220))); // SETWORLDTRANSFORM
  push(er(43, (p) => rectl(p, 0, 0, 200, 100)));                        // RECTANGLE（缩放后）
  push(er(36, (p) => p.f32(1).f32(0).f32(0).f32(1).f32(20).f32(0).u32(3))); // MODIFYWORLDTRANSFORM RIGHT
  push(er(43, (p) => rectl(p, 0, 0, 100, 60)));
  push(er(34, (p) => p.i32(-1)));                                       // RESTOREDC

  // 路径模式：BEGINPATH … 贝塞尔 … CLOSEFIGURE … ENDPATH … STROKEANDFILLPATH
  push(er(37, (p) => p.u32(1)));                                        // 重新选中红画刷
  push(er(59));                                                         // BEGINPATH
  push(er(27, (p) => p.i32(60).i32(230)));                              // MOVETOEX
  push(er(54, (p) => p.i32(160).i32(230)));                             // LINETO
  push(er(88, (p) => {                                                  // POLYBEZIERTO16
    rectl(p, 160, 230, 260, 290);
    p.u32(3).i16(200).i16(290).i16(230).i16(200).i16(260).i16(260);
  }));
  push(er(61));                                                         // CLOSEFIGURE
  push(er(60));                                                         // ENDPATH
  push(er(63));                                                         // STROKEANDFILLPATH

  // 文字：粗体倾斜 + ETO_OPAQUE 背景 + 居中对齐
  push(er(82, (p) => {                                                  // EXTCREATEFONTINDIRECTW
    p.u32(3);
    p.i32(-24).i32(0).i32(0).i32(0).i32(700);
    p.u8(1).u8(1).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0);
    p.str16('Georgia', 64);
  }));
  push(er(37, (p) => p.u32(3)));                                        // SELECTOBJECT font
  push(er(24, (p) => p.u32(colorref(10, 90, 160))));                    // SETTEXTCOLOR
  push(er(25, (p) => p.u32(colorref(250, 240, 200))));                  // SETBKCOLOR
  push(er(18, (p) => p.u32(2)));                                        // SETBKMODE OPAQUE
  push(er(22, (p) => p.u32(6)));                                        // SETTEXTALIGN TA_CENTER
  push(er(84, (p) => {                                                  // EXTTEXTOUTW
    const text = 'Hello <EMF> & 图元';
    rectl(p, 200, 250, 400, 290);
    p.u32(1).f32(1).f32(1);
    p.i32(300).i32(255);                                                // 参考点
    p.u32(text.length).u32(76).u32(0x0002);                             // chars / offString / ETO_OPAQUE
    rectl(p, 200, 250, 400, 290);
    p.u32(0);                                                           // offDx
    p.str16(text, text.length * 2);
  }));

  // 位图：STRETCHDIBITS（24 位）与 BITBLT（单色）
  push(er(81, (p) => {                                                  // STRETCHDIBITS
    const d = dib24();
    rectl(p, 20, 240, 60, 280);
    p.i32(20).i32(240).i32(0).i32(0).i32(2).i32(2);
    p.u32(80).u32(40).u32(120).u32(d.length - 40);
    p.u32(0).u32(0x00cc0020);
    p.i32(40).i32(40);
    p.raw(d);
  }));
  push(er(76, (p) => {                                                  // BITBLT
    const d = dib1();
    rectl(p, 340, 240, 390, 280);
    p.i32(340).i32(240).i32(50).i32(40);
    p.u32(0x00cc0020).i32(0).i32(0);
    p.f32(1).f32(0).f32(0).f32(1).f32(0).f32(0);                        // XformSrc
    p.u32(0).u32(0);
    p.u32(100).u32(48).u32(148).u32(d.length - 48);
    p.raw(d);
  }));

  push(er(30, (p) => rectl(p, 0, 0, 400, 300)));                        // INTERSECTCLIPRECT
  push(er(40, (p) => p.u32(2)));                                        // DELETEOBJECT
  return emfFile(recs);
}

// ---------------- 样例：WMF ----------------

function buildWmf() {
  const recs = [];
  const push = (r) => recs.push(r);

  push(wr(0x0103, (p) => p.u16(8)));                                    // SETMAPMODE MM_ANISOTROPIC
  push(wr(0x020b, (p) => p.i16(0).i16(0)));                             // SETWINDOWORG (y, x)
  push(wr(0x020c, (p) => p.i16(3000).i16(4000)));                       // SETWINDOWEXT (y, x)
  push(wr(0x0106, (p) => p.u16(2)));                                    // SETPOLYFILLMODE WINDING

  push(wr(0x02fc, (p) => p.u16(0).u32(colorref(30, 160, 80)).u16(0)));  // CREATEBRUSHINDIRECT solid → obj0
  push(wr(0x02fa, (p) => p.u16(2).i16(20).i16(0).u32(colorref(200, 40, 40)))); // CREATEPENINDIRECT PS_DOT → obj1
  push(wr(0x012d, (p) => p.u16(0)));                                    // SELECTOBJECT brush
  push(wr(0x012d, (p) => p.u16(1)));                                    // SELECTOBJECT pen

  push(wr(0x0324, (p) => {                                              // POLYGON
    p.u16(4).i16(200).i16(200).i16(900).i16(200).i16(900).i16(800).i16(200).i16(800);
  }));

  push(wr(0x012d, (p) => p.u16(0x8005)));                               // SELECTOBJECT NULL_BRUSH（库存）
  push(wr(0x0325, (p) => {                                              // POLYLINE
    p.u16(4).i16(1100).i16(800).i16(1400).i16(200).i16(1700).i16(800).i16(2000).i16(200);
  }));

  push(wr(0x041b, (p) => wrect(p, 2200, 200, 3000, 800)));              // RECTANGLE
  push(wr(0x0418, (p) => wrect(p, 200, 1000, 1000, 1600)));             // ELLIPSE
  push(wr(0x061c, (p) => { p.i16(200).i16(200); wrect(p, 1200, 1000, 2000, 1600); })); // ROUNDRECT
  push(wr(0x081a, (p) => { p.i16(1300).i16(3000).i16(1000).i16(2600); wrect(p, 2200, 1000, 3000, 1600); })); // PIE
  push(wr(0x0817, (p) => { p.i16(1300).i16(3000).i16(1000).i16(2600); wrect(p, 2200, 1000, 3000, 1600); })); // ARC
  push(wr(0x0830, (p) => { p.i16(1300).i16(3000).i16(1000).i16(2600); wrect(p, 2200, 1000, 3000, 1600); })); // CHORD

  push(wr(0x0214, (p) => p.i16(1800).i16(200)));                        // MOVETO (y, x)
  push(wr(0x0213, (p) => p.i16(1900).i16(1200)));                       // LINETO

  // SAVEDC → 改窗口原点 → 画矩形 → RESTOREDC
  push(wr(0x001e));                                                     // SAVEDC
  push(wr(0x020b, (p) => p.i16(-400).i16(-200)));                       // SETWINDOWORG
  push(wr(0x041b, (p) => wrect(p, 2000, 200, 2400, 800)));              // RECTANGLE（被平移）
  push(wr(0x0127, (p) => p.i16(-1)));                                   // RESTOREDC
  push(wr(0x041b, (p) => wrect(p, 2000, 200, 2400, 800)));              // 同样的矩形，未平移

  // 文字
  push(wr(0x02fb, (p) => {                                              // CREATEFONTINDIRECT → obj2
    p.i16(-140).i16(0).i16(0).i16(0).i16(700);
    p.u8(0).u8(1).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0);
    p.str8('Verdana', 32);
  }));
  push(wr(0x012d, (p) => p.u16(2)));                                    // SELECTOBJECT font
  push(wr(0x0209, (p) => p.u32(colorref(120, 20, 160))));               // SETTEXTCOLOR
  push(wr(0x0201, (p) => p.u32(colorref(245, 235, 250))));              // SETBKCOLOR
  push(wr(0x0102, (p) => p.u16(2)));                                    // SETBKMODE OPAQUE
  push(wr(0x012e, (p) => p.u16(0)));                                    // SETTEXTALIGN TA_LEFT|TA_TOP
  push(wr(0x0521, (p) => { const s = 'WMF TextOut'; p.u16(s.length).str8(s, s.length + (s.length & 1)).i16(2200).i16(300); }));
  push(wr(0x0a32, (p) => {                                              // EXTTEXTOUT with ETO_OPAQUE + dx
    const s = 'Ext & <out>';
    p.i16(2400).i16(300);                                               // y, x
    p.u16(s.length).u16(0x0002);
    p.i16(300).i16(2400).i16(1600).i16(2560);                           // rect
    p.str8(s, s.length + (s.length & 1));
    for (let i = 0; i < s.length; i++) p.i16(90);                       // dx
  }));

  // 位图：STRETCHDIB（8 位调色板）
  push(wr(0x0f43, (p) => {
    p.u32(0x00cc0020).u16(0);
    p.i16(4).i16(4).i16(0).i16(0);
    p.i16(400).i16(400).i16(2700).i16(3400);                            // dh, dw, dy, dx
    p.raw(dib8());
  }));

  push(wr(0x0416, (p) => wrect(p, 0, 0, 4000, 3000)));                  // INTERSECTCLIPRECT
  push(wr(0x01f0, (p) => p.u16(1)));                                    // DELETEOBJECT pen
  return wmfFile(recs);
}

// ---------------- 输出校验 ----------------

/** 极简 XML 良构检查：标签配对 + 无裸尖括号 */
function xmlError(s) {
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  let last = 0;
  while ((m = re.exec(s)) !== null) {
    if (s.slice(last, m.index).includes('<')) return `文本区出现裸 <：…${s.slice(m.index - 30, m.index)}`;
    last = re.lastIndex;
    if (m[1] === '/') {
      const top = stack.pop();
      if (top !== m[2]) return `标签不匹配：</${m[2]}> vs <${top}>`;
    } else if (m[4] !== '/') {
      stack.push(m[2]);
    }
  }
  if (s.slice(last).includes('<')) return '尾部存在未解析的 <';
  if (stack.length) return `未闭合标签：${stack.join(', ')}`;
  return null;
}

const countTag = (s, tag) => (s.match(new RegExp(`<${tag}[\\s/>]`, 'g')) || []).length;

/** 所有元素通用的健康检查 */
function sane(label, svg) {
  if (!check(`${label}：返回非 null`, typeof svg === 'string' && svg.length > 0)) return false;
  check(`${label}：无 NaN`, !/NaN/.test(svg), svg.slice(0, 200));
  check(`${label}：无 undefined`, !/undefined/.test(svg));
  check(`${label}：无 Infinity`, !/Infinity/.test(svg));
  const err = xmlError(svg);
  check(`${label}：XML 良构`, err === null, err ?? '');
  check(`${label}：有 svg 根与 viewBox`, /^<svg [^>]*viewBox="[-\d. ]+"/.test(svg));
  return true;
}

// ---------------- 打包并加载模块 ----------------

group('构建');
const bundle = join(outDir, 'image-bundle.mjs');
execFileSync('npx', [
  'esbuild', join(root, 'packages/core/src/image/index.ts'),
  '--bundle', '--format=esm', '--platform=node', '--log-level=warning',
  `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
console.log('esbuild 打包完成 →', bundle);

const { metafileToSvg, detectMetafile, metafileToDataUri } = await import(`file://${bundle}`);

// ---------------- 用例 1：合成 EMF ----------------

group('合成 EMF');
const emfBytes = buildEmf();
check('detectMetafile → emf', detectMetafile(emfBytes) === 'emf', String(detectMetafile(emfBytes)));

const emfSvg = metafileToSvg(emfBytes);
if (sane('EMF', emfSvg)) {
  check('EMF：有 <path>（多边形/路径模式）', countTag(emfSvg, 'path') >= 3, `实际 ${countTag(emfSvg, 'path')}`);
  check('EMF：有 <rect>（矩形 + 文字底色）', countTag(emfSvg, 'rect') >= 2, `实际 ${countTag(emfSvg, 'rect')}`);
  check('EMF：有 <text>', countTag(emfSvg, 'text') >= 1);
  check('EMF：有 <image>（DIB → data URI）', countTag(emfSvg, 'image') >= 1, `实际 ${countTag(emfSvg, 'image')}`);
  check('EMF：DIB 解出 PNG data URI', /xlink:href="data:image\/png;base64,[A-Za-z0-9+/=]{40,}"/.test(emfSvg));
  check('EMF：虚线笔 → stroke-dasharray', /stroke-dasharray="/.test(emfSvg));
  check('EMF：空画刷 → fill="none"', /fill="none"/.test(emfSvg));
  check('EMF：实心画刷颜色 #dc143c', emfSvg.includes('#dc143c'));
  check('EMF：笔色 #143cdc', emfSvg.includes('#143cdc'));
  check('EMF：文字内容与转义', emfSvg.includes('Hello &lt;EMF&gt; &amp; 图元'));
  check('EMF：文字颜色 #0a5aa0', emfSvg.includes('fill="#0a5aa0"'));
  check('EMF：TA_CENTER → text-anchor=middle', /text-anchor="middle"/.test(emfSvg));
  check('EMF：字体族取自 lfFaceName', /font-family="'Georgia'/.test(emfSvg));
  check('EMF：粗体 + 斜体', /font-weight="700"/.test(emfSvg) && /font-style="italic"/.test(emfSvg));
  check('EMF：ETO_OPAQUE 底色 #faf0c8', emfSvg.includes('#faf0c8'));
  check('EMF：INTERSECTCLIPRECT → clipPath', /<clipPath id="/.test(emfSvg));
  check('EMF：路径模式产生贝塞尔段', /<path d="M[^"]*C[^"]*Z"/.test(emfSvg));
  check('EMF：椭圆用贝塞尔近似（4 段 C）', (emfSvg.match(/C/g) || []).length >= 8);

  // 世界变换：SETWORLDTRANSFORM 0.5 缩放 + 平移 (10,220) → 矩形应落在 (10,220)-(110,270)
  check('EMF：SETWORLDTRANSFORM 生效', /<rect x="10" y="220" width="100" height="50"/.test(emfSvg),
    emfSvg.match(/<rect[^>]*y="2[0-9]{2}"[^>]*>/)?.[0] ?? '未找到');
  // MODIFYWORLDTRANSFORM RIGHTMULTIPLY = 先当前变换再平移 → (0,0) → (10,220) → (30,220)
  check('EMF：MODIFYWORLDTRANSFORM 生效', /<rect x="30" y="220" width="50" height="30"/.test(emfSvg),
    emfSvg.match(/<rect x="\d+" y="220"[^>]*>/g)?.join(' ') ?? '未找到');
  // RESTOREDC 之后回到 1:1，路径模式的起点应是 (60,230) 原值
  check('EMF：RESTOREDC 还原世界变换', emfSvg.includes('M60 230'));

  // viewBox 与默认尺寸
  check('EMF：viewBox 覆盖 rclBounds', /viewBox="0 0 400 300"/.test(emfSvg), emfSvg.slice(0, 220));
  const dim = emfSvg.match(/width="([\d.]+)" height="([\d.]+)"/);
  check('EMF：默认宽高取 rclFrame（≈400x300）',
    !!dim && Math.abs(+dim[1] - 400) < 1 && Math.abs(+dim[2] - 300) < 1, dim?.[0] ?? '未找到');
}

const emfSized = metafileToSvg(emfBytes, { width: 800, height: 600 });
check('EMF：opts.width/height 生效', /width="800" height="600"/.test(emfSized ?? ''));
check('EMF：viewBox 不随 opts 改变', /viewBox="0 0 400 300"/.test(emfSized ?? ''));
check('EMF：metafileToDataUri 可用', (metafileToDataUri(emfBytes) ?? '').startsWith('data:image/svg+xml'));

// ---------------- 用例 2：合成 WMF ----------------

group('合成 WMF');
const wmfBytes = buildWmf();
check('detectMetafile → wmf', detectMetafile(wmfBytes) === 'wmf', String(detectMetafile(wmfBytes)));

const wmfSvg = metafileToSvg(wmfBytes);
if (sane('WMF', wmfSvg)) {
  check('WMF：有 <path>', countTag(wmfSvg, 'path') >= 3, `实际 ${countTag(wmfSvg, 'path')}`);
  check('WMF：有 <rect>', countTag(wmfSvg, 'rect') >= 3, `实际 ${countTag(wmfSvg, 'rect')}`);
  check('WMF：有 <text>', countTag(wmfSvg, 'text') >= 2, `实际 ${countTag(wmfSvg, 'text')}`);
  check('WMF：有 <image>', countTag(wmfSvg, 'image') >= 1, `实际 ${countTag(wmfSvg, 'image')}`);
  check('WMF：8 位调色板 DIB → PNG', /xlink:href="data:image\/png;base64,[A-Za-z0-9+/=]{40,}"/.test(wmfSvg));
  check('WMF：点线笔 → stroke-dasharray', /stroke-dasharray="/.test(wmfSvg));
  check('WMF：空画刷 → fill="none"', /fill="none"/.test(wmfSvg));
  check('WMF：实心画刷 #1ea050', wmfSvg.includes('#1ea050'));
  check('WMF：笔色 #c82828', wmfSvg.includes('#c82828'));
  check('WMF：TEXTOUT 文本', wmfSvg.includes('WMF TextOut'));
  check('WMF：EXTTEXTOUT 文本与转义', wmfSvg.includes('Ext &amp; &lt;out&gt;'));
  check('WMF：EXTTEXTOUT dx → textLength', /textLength="/.test(wmfSvg));
  check('WMF：文字颜色 #7814a0', wmfSvg.includes('#7814a0'));
  check('WMF：字体族 Verdana', /font-family="'Verdana'/.test(wmfSvg));
  check('WMF：TA_TOP → dominant-baseline', /dominant-baseline="text-before-edge"/.test(wmfSvg));
  check('WMF：INTERSECTCLIPRECT → clipPath', /<clipPath id="/.test(wmfSvg));
  check('WMF：viewBox 取 placeable bbox', /viewBox="0 0 4000 3000"/.test(wmfSvg), wmfSvg.slice(0, 220));
  check('WMF：默认宽高按 inch=1000 折算 96dpi', /width="384" height="288"/.test(wmfSvg), wmfSvg.slice(0, 220));

  // POLYGON 是 200,200 → 900,800 的矩形轮廓
  check('WMF：POLYGON 坐标正确', wmfSvg.includes('M200 200L900 200L900 800L200 800Z'));
  // SAVEDC 段内窗口原点为 (-200,-400)，矩形应整体偏移 +200/+400
  check('WMF：SAVEDC 内窗口平移生效', /<rect x="2200" y="600" width="400" height="600"/.test(wmfSvg),
    wmfSvg.match(/<rect x="2[0-9]{3}" y="[0-9]+"[^>]*>/g)?.join(' ') ?? '');
  // RESTOREDC 之后同一条 RECTANGLE 回到原位
  check('WMF：RESTOREDC 还原窗口原点', /<rect x="2000" y="200" width="400" height="600"/.test(wmfSvg));
  // 库存对象索引 0x8005 = NULL_BRUSH，不应被当成普通槽位
  // lfHeight = -140 逻辑单位，窗口/视口 1:1 → 设备字号 140（占 bbox 高的 4.7%）
  check('WMF：对象槽位不错位（字体生效）', /font-size="140"/.test(wmfSvg), wmfSvg.match(/font-size="[\d.]+"/g)?.join(' ') ?? '');
}

const wmfSized = metafileToSvg(wmfBytes, { width: 1024 });
check('WMF：只给 width 时高度回落默认', /width="1024" height="288"/.test(wmfSized ?? ''));

// ---------------- 用例 3：非法输入与鲁棒性 ----------------

group('鲁棒性');
const cases = [
  ['空数组', new Uint8Array(0)],
  ['随机噪声', Uint8Array.from({ length: 512 }, (_, i) => (i * 37) & 0xff)],
  ['PNG 魔数', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
  ['Zip 魔数', Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
];
for (const [name, b] of cases) {
  let r;
  let threw = false;
  try { r = metafileToSvg(b); } catch { threw = true; }
  check(`非图元文件「${name}」不抛异常且返回 null`, !threw && r === null);
  check(`detectMetafile「${name}」→ null`, detectMetafile(b) === null);
}

// 截断：从头部到尾部各截一刀，必须永不抛异常
let truncThrew = 0;
let truncOk = 0;
for (const src of [emfBytes, wmfBytes]) {
  for (let len = 1; len <= src.length; len += Math.max(1, Math.floor(src.length / 60))) {
    try {
      const r = metafileToSvg(src.subarray(0, len));
      if (r === null || (typeof r === 'string' && !/NaN|undefined/.test(r) && xmlError(r) === null)) truncOk++;
      else truncThrew++;
    } catch { truncThrew++; }
  }
}
check('截断样本全部安全（无异常 / 无 NaN / XML 良构）', truncThrew === 0, `失败 ${truncThrew} / 通过 ${truncOk}`);

// 随机字节破坏
let fuzzBad = 0;
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = 0; i < 400; i++) {
  const src = i % 2 ? emfBytes : wmfBytes;
  const b = src.slice();
  for (let k = 0; k < 12; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
  try {
    const r = metafileToSvg(b);
    if (r !== null && (/NaN|undefined/.test(r) || xmlError(r) !== null)) fuzzBad++;
  } catch { fuzzBad++; }
}
check('随机破坏 400 例全部安全', fuzzBad === 0, `异常/脏输出 ${fuzzBad} 例`);

// ---------------- 用例 4：LibreOffice 真实样本 ----------------

group('真实样本（LibreOffice 转换）');
const SOFFICE = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice', '/usr/local/bin/soffice',
].find((p) => existsSync(p));
const srcPptx = join(root, 'fixtures/showcase.pptx');

function convert(fmt) {
  const target = join(outDir, `showcase.${fmt}`);
  if (existsSync(target)) return target;
  if (!SOFFICE || !existsSync(srcPptx)) return null;
  const tmp = join(outDir, fmt);
  mkdirSync(tmp, { recursive: true });
  execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', fmt, '--outdir', tmp, srcPptx],
    { stdio: 'ignore', timeout: 300_000 });
  const hit = readdirSync(tmp).find((f) => f.endsWith(`.${fmt}`));
  if (!hit) return null;
  renameSync(join(tmp, hit), target);
  return target;
}

if (!SOFFICE) {
  console.log('  未安装 LibreOffice，跳过真实样本（不计入失败）');
} else {
  for (const [fmt, kind] of [['emf', 'emf'], ['wmf', 'wmf']]) {
    let file = null;
    try { file = convert(fmt); } catch (e) { console.log(`  ${fmt} 转换失败：${e.message.slice(0, 120)}`); }
    if (!file) { console.log(`  ${fmt} 样本不可用，跳过`); continue; }
    const bytes = new Uint8Array(readFileSync(file));
    check(`真实 ${fmt}：detectMetafile → ${kind}`, detectMetafile(bytes) === kind, String(detectMetafile(bytes)));

    const t0 = Date.now();
    const svg = metafileToSvg(bytes, { width: 1280, height: 720 });
    const ms = Date.now() - t0;
    if (!sane(`真实 ${fmt}`, svg)) continue;

    const paths = countTag(svg, 'path');
    const rects = countTag(svg, 'rect');
    const texts = countTag(svg, 'text');
    const shapes = paths + rects;
    check(`真实 ${fmt}：解出足量图形（>200）`, shapes > 200, `path=${paths} rect=${rects}`);
    check(`真实 ${fmt}：解出文本`, texts > 0, `text=${texts}`);
    check(`真实 ${fmt}：输出尺寸为请求值`, /width="1280" height="720"/.test(svg));
    check(`真实 ${fmt}：坐标落在 viewBox 内`, coordsInRange(svg), '存在明显越界坐标');
    console.log(`  ${fmt}: ${(bytes.length / 1024).toFixed(0)}KB → ${(svg.length / 1024).toFixed(0)}KB SVG，` +
      `path=${paths} rect=${rects} text=${texts} image=${countTag(svg, 'image')}，${ms}ms`);
  }
}

/** 抽样检查坐标数量级，防止映射算错导致图形飞到天外 */
function coordsInRange(svg) {
  const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
  if (!vb) return false;
  const w = Number(vb[3]);
  const h = Number(vb[4]);
  const nums = svg.match(/[-+]?\d+(\.\d+)?/g) || [];
  const limit = Math.max(w, h) * 50;
  let outliers = 0;
  for (const s of nums) {
    const v = Math.abs(Number(s));
    if (v > limit) outliers++;
  }
  return outliers / Math.max(1, nums.length) < 0.02;
}

// 需要人眼确认时：DUMP_FIXTURES=1 会把合成样本与其 SVG 落盘到 out/metafile
if (process.env.DUMP_FIXTURES) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(outDir, 'synthetic.emf'), emfBytes);
  writeFileSync(join(outDir, 'synthetic.wmf'), wmfBytes);
  writeFileSync(join(outDir, 'synthetic-emf.svg'), emfSvg ?? '');
  writeFileSync(join(outDir, 'synthetic-wmf.svg'), wmfSvg ?? '');
  console.log('  合成样本已落盘 → out/metafile/synthetic-*.svg');
}

// ---------------- 汇总 ----------------

console.log(`\n${'─'.repeat(60)}`);
if (failures.length) {
  console.log(`\x1b[31m✗ ${failures.length} 项失败\x1b[0m（通过 ${pass}）`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`\x1b[32m✓ 全部 ${pass} 项断言通过\x1b[0m`);
