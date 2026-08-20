/**
 * 老式 .ppt 的 RC4 CryptoAPI 解密（[MS-OFFCRYPTO] + [MS-PPT] 2.3.7）。
 *
 * 与 OOXML 加密是两套完全不同的方案，共用不了代码：
 *   OOXML —— 整个包被加密成一条 EncryptedPackage 流
 *   .ppt   —— 容器结构本身是明文，只有各**持久化对象**的内容被加密
 *
 * 关键规则（实测确认，不是照规范推的）：RC4 的重置块号取**持久化对象 ID**，
 * 每个对象各自起一条新的 RC4 流；不是常见的「按 512 字节分块」。
 * 按 512 分块解出来全是垃圾——这个坑值得写下来。
 *
 * 以下三处保持明文，因为定位加密信息本身要靠它们：
 *   CurrentUserAtom（在另一条流里）/ UserEditAtom / PersistDirectoryAtom
 * 外加 CryptSession10Container 自己。
 */

import { sha1 } from './primitives';
import { WrongPasswordError } from './ooxml';

/** Current User 流里的加密标志 */
const TOKEN_ENCRYPTED = 0xf3d1c4df;

const RT_USER_EDIT = 0x0ff5;
const RT_PERSIST_DIR = 0x1772;
const RT_CRYPT_SESSION = 0x2f14;

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return out;
}

function le32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

/** 判断 .ppt 是否加密：只看 Current User 流的 headerToken，无需解析文档流 */
export function isPptEncrypted(currentUser: Uint8Array | null): boolean {
  if (!currentUser || currentUser.length < 16) return false;
  const dv = new DataView(currentUser.buffer, currentUser.byteOffset, currentUser.byteLength);
  return dv.getUint32(12, true) === TOKEN_ENCRYPTED;
}

interface CryptInfo {
  keyBytes: number;
  salt: Uint8Array;
  encVerifier: Uint8Array;
  encVerifierHash: Uint8Array;
}

function parseCryptSession(body: Uint8Array): CryptInfo | null {
  if (body.length < 40) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const headerSize = dv.getUint32(8, true);
  if (headerSize < 20 || 12 + headerSize + 40 > body.length) return null;
  // keySize=0 表示「用算法默认」，RC4 CryptoAPI 的默认是 40 位
  const keyBits = dv.getUint32(12 + 16, true) || 40;
  let o = 12 + headerSize;
  const saltSize = dv.getUint32(o, true); o += 4;
  if (saltSize !== 16) return null;
  const salt = body.subarray(o, o + 16); o += 16;
  const encVerifier = body.subarray(o, o + 16); o += 16;
  const vhSize = dv.getUint32(o, true); o += 4;
  if (vhSize < 20) return null;
  return { keyBytes: Math.max(1, Math.floor(keyBits / 8)), salt, encVerifier, encVerifierHash: body.subarray(o, o + 20) };
}

/**
 * 派生某个块号的 RC4 密钥。
 *
 * 只有 40 位密钥要补零到 128 位再用，56 位及以上按原长度直接用——
 * RC4 对 5 字节和 16 字节的密钥产出完全不同的密钥流，这条规则搞反了
 * 口令校验就过不了（实测：40 位必须补、56 位必须不补）。
 */
function keyFor(info: CryptInfo, h0: Uint8Array, block: number): Uint8Array {
  const hf = sha1(concat(h0, le32(block)));
  const k = hf.subarray(0, info.keyBytes);
  if (info.keyBytes !== 5) return k;
  const out = new Uint8Array(16);
  out.set(k);
  return out;
}

interface Persist {
  id: number;
  offset: number;
}

/** 明文区：UserEditAtom / PersistDirectory / CryptSession10Container */
interface Layout {
  info: CryptInfo;
  persists: Persist[];
  plain: [number, number][];
}

function readLayout(doc: Uint8Array, currentUser: Uint8Array): Layout | null {
  const cdv = new DataView(currentUser.buffer, currentUser.byteOffset, currentUser.byteLength);
  const dv = new DataView(doc.buffer, doc.byteOffset, doc.byteLength);
  const recLen = (off: number): number => dv.getUint32(off + 4, true);
  const recType = (off: number): number => dv.getUint16(off + 2, true);

  const plain: [number, number][] = [];
  const persists = new Map<number, number>();
  let encRef = -1;

  // UserEditAtom 链：每个 UserEditAtom 指向上一次编辑，持久化目录要沿链合并
  let ueOff = cdv.getUint32(16, true);
  let guard = 0;
  while (ueOff > 0 && ueOff + 8 <= doc.length && guard++ < 64) {
    if (recType(ueOff) !== RT_USER_EDIT) return null;
    const len = recLen(ueOff);
    plain.push([ueOff, 8 + len]);
    const b = ueOff + 8;
    const prev = dv.getUint32(b + 8, true);
    const pdOff = dv.getUint32(b + 12, true);
    if (len >= 32 && encRef < 0) encRef = dv.getUint32(b + 28, true);

    if (pdOff > 0 && pdOff + 8 <= doc.length && recType(pdOff) === RT_PERSIST_DIR) {
      const pdLen = recLen(pdOff);
      plain.push([pdOff, 8 + pdLen]);
      let p = pdOff + 8;
      const end = Math.min(p + pdLen, doc.length);
      while (p + 4 <= end) {
        const h = dv.getUint32(p, true); p += 4;
        const startId = h & 0xfffff;
        const cnt = h >>> 20;
        for (let i = 0; i < cnt && p + 4 <= end; i++) {
          // 沿链向前走，先看到的是较新的编辑，不能被旧的覆盖
          if (!persists.has(startId + i)) persists.set(startId + i, dv.getUint32(p, true));
          p += 4;
        }
      }
    }
    ueOff = prev;
  }

  const encOff = encRef >= 0 ? persists.get(encRef) : undefined;
  if (encOff === undefined || encOff + 8 > doc.length || recType(encOff) !== RT_CRYPT_SESSION) return null;
  const encLen = recLen(encOff);
  plain.push([encOff, 8 + encLen]);
  const info = parseCryptSession(doc.subarray(encOff + 8, encOff + 8 + encLen));
  if (!info) return null;

  return {
    info,
    persists: [...persists.entries()]
      .filter(([id]) => id !== encRef)
      .map(([id, offset]) => ({ id, offset })),
    plain,
  };
}

/**
 * 解密 .ppt 的 PowerPoint Document 流，返回明文副本。
 * 密码错误抛 {@link WrongPasswordError}；结构认不出返回 null 由调用方兜底。
 */
export function decryptPptStream(
  doc: Uint8Array, currentUser: Uint8Array, password: string,
): Uint8Array | null {
  const layout = readLayout(doc, currentUser);
  if (!layout) return null;
  const { info, persists, plain } = layout;

  const h0 = sha1(concat(info.salt, utf16le(password)));

  // 口令校验：verifier 与其哈希共用同一条 RC4 流，不能分两次起流
  const k0 = keyFor(info, h0, 0);
  const chk = rc4(k0, concat(info.encVerifier, info.encVerifierHash));
  const got = sha1(chk.subarray(0, 16));
  let diff = 0;
  for (let i = 0; i < 20; i++) diff |= got[i] ^ chk[16 + i];
  if (diff !== 0) throw new WrongPasswordError();

  const out = new Uint8Array(doc);
  const dv = new DataView(doc.buffer, doc.byteOffset, doc.byteLength);
  const covered: [number, number][] = [];

  for (const { id, offset } of persists) {
    if (offset + 8 > doc.length) continue;
    // 长度字段本身是密文，先解头 8 字节才知道对象有多长
    const head = rc4(keyFor(info, h0, id), doc.subarray(offset, offset + 8));
    const len = new DataView(head.buffer).getUint32(4, true);
    const total = Math.min(8 + len, doc.length - offset);
    if (!(total > 8) || total > doc.length) continue;
    out.set(rc4(keyFor(info, h0, id), doc.subarray(offset, offset + total)), offset);
    covered.push([offset, total]);
  }
  if (!covered.length) return null;

  // 明文区回填。RC4 是按位置异或的流密码，上面整段解密会把这几处本来
  // 就是明文的字节搅坏，必须原样拷回来
  for (const [off, len] of plain) {
    if (off >= 0 && off + len <= doc.length) out.set(doc.subarray(off, off + len), off);
  }
  void dv;
  return out;
}
