/**
 * ECMA-376 文档加密（[MS-OFFCRYPTO]）的解密实现。
 *
 * 设了打开密码的 .pptx 其实是个 CFB 容器，里面两条流：
 *   EncryptionInfo    —— 算法参数与口令校验值
 *   EncryptedPackage  —— 8 字节原始长度 + 密文，解出来才是真正的 Zip
 *
 * 两代方案共存，靠 EncryptionInfo 头部的版本号区分：
 *   标准（Office 2007，4.2 及以下）：AES-ECB，SHA-1 固定迭代 50000 次
 *   敏捷（Office 2010+，4.4）：头部之后是一段 XML，算法/迭代次数都可配，AES-CBC 分段
 */

import { aesDecryptCbc, aesDecryptEcb, hashByName, sha1 } from './primitives';
import type { HashFn } from './primitives';

/** 标准加密固定迭代 50000 次；这是规范写死的常数，不是可调参数 */
const STANDARD_SPIN = 50000;

/** agile 各用途的块常量（[MS-OFFCRYPTO] 2.3.4.13），顺序不能错 */
const BLOCK_VERIFIER_INPUT = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
const BLOCK_VERIFIER_VALUE = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
const BLOCK_KEY_VALUE = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

export class WrongPasswordError extends Error {
  constructor() {
    super('密码错误');
    this.name = 'WrongPasswordError';
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** 口令一律按 UTF-16LE 参与派生；这是规范要求，不是实现选择 */
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

function eq(a: Uint8Array, b: Uint8Array, len: number): boolean {
  if (a.length < len || b.length < len) return false;
  let diff = 0;
  for (let i = 0; i < len; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 迭代哈希：H0 = hash(salt+pwd)，Hi = hash(LE32(i) + H(i-1)) */
function spin(hash: HashFn, salt: Uint8Array, password: string, count: number): Uint8Array {
  let h = hash(concat(salt, utf16le(password)));
  for (let i = 0; i < count; i++) h = hash(concat(le32(i), h));
  return h;
}

/** 把派生结果裁剪 / 补齐到目标长度；不足部分补 0x36，规范如此 */
function fit(key: Uint8Array, bytes: number): Uint8Array {
  if (key.length >= bytes) return key.subarray(0, bytes);
  const out = new Uint8Array(bytes).fill(0x36);
  out.set(key);
  return out;
}

// ---------------- 标准加密 ----------------

interface StandardInfo {
  keyBytes: number;
  salt: Uint8Array;
  encryptedVerifier: Uint8Array;
  encryptedVerifierHash: Uint8Array;
}

function parseStandard(info: Uint8Array): StandardInfo | null {
  const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const headerSize = dv.getUint32(8, true);
  if (headerSize < 32 || 12 + headerSize + 8 > info.length) return null;
  // EncryptionHeader：flags/sizeExtra/algID/algIDHash/keySize/... keySize 在第 5 个 DWORD
  const keyBits = dv.getUint32(12 + 16, true);
  const keyBytes = keyBits >= 8 ? keyBits / 8 : 16;

  let off = 12 + headerSize;
  const saltSize = dv.getUint32(off, true);
  off += 4;
  if (saltSize !== 16) return null;
  const salt = info.subarray(off, off + 16); off += 16;
  const encryptedVerifier = info.subarray(off, off + 16); off += 16;
  const verifierHashSize = dv.getUint32(off, true); off += 4;
  if (verifierHashSize < 20) return null;
  const encryptedVerifierHash = info.subarray(off, off + 32);
  return { keyBytes, salt, encryptedVerifier, encryptedVerifierHash };
}

/** 标准加密的密钥派生（[MS-OFFCRYPTO] 2.3.4.7） */
function standardKey(info: StandardInfo, password: string): Uint8Array {
  const h = spin(sha1, info.salt, password, STANDARD_SPIN);
  const hFinal = sha1(concat(h, le32(0)));
  // X1/X2 是 HMAC 式的内外填充，规范原文如此，不能简化成一次哈希
  const x1 = sha1(new Uint8Array(64).map((_, i) => (i < hFinal.length ? hFinal[i] : 0) ^ 0x36));
  const x2 = sha1(new Uint8Array(64).map((_, i) => (i < hFinal.length ? hFinal[i] : 0) ^ 0x5c));
  return fit(concat(x1, x2), info.keyBytes);
}

function decryptStandard(info: Uint8Array, pkg: Uint8Array, password: string): Uint8Array {
  const std = parseStandard(info);
  if (!std) throw new Error('无法解析标准加密的 EncryptionInfo');
  const key = standardKey(std, password);

  const verifier = aesDecryptEcb(key, std.encryptedVerifier);
  const wantHash = aesDecryptEcb(key, std.encryptedVerifierHash);
  if (!eq(sha1(verifier), wantHash, 20)) throw new WrongPasswordError();

  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength).getBigUint64(0, true));
  const plain = aesDecryptEcb(key, pkg.subarray(8));
  return plain.subarray(0, Math.min(size, plain.length));
}

// ---------------- 敏捷加密 ----------------

interface AgileInfo {
  hash: HashFn;
  hashSize: number;
  blockSize: number;
  keyBytes: number;
  keySalt: Uint8Array;
  spinCount: number;
  pwSalt: Uint8Array;
  pwKeyBytes: number;
  pwHash: HashFn;
  encryptedKeyValue: Uint8Array;
  encryptedVerifierHashInput: Uint8Array;
  encryptedVerifierHashValue: Uint8Array;
}

function b64(s: string): Uint8Array {
  const bin = typeof atob === 'function'
    ? atob(s)
    // Node 环境（测试 / SSR）没有 atob 时退回 Buffer
    : (globalThis as { Buffer?: { from(v: string, e: string): { toString(e: string): string } } })
      .Buffer!.from(s, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * agile 描述符是一段 XML，但这里刻意用正则而不是 parseXml：
 * crypto 模块要能在 Worker 与 Node 里独立跑，不该反过来依赖 xml 层，
 * 而且需要的只是几个扁平属性，属性名在规范里是固定的。
 */
function parseAgile(info: Uint8Array): AgileInfo | null {
  // 头 8 字节是版本与 flags，之后是 UTF-8 的 XML
  const xml = new TextDecoder().decode(info.subarray(8));
  const keyData = /<[^>]*keyData\b[^>]*>/.exec(xml)?.[0] ?? '';
  const encKey = /<[^>]*encryptedKey\b[^>]*>/.exec(xml)?.[0] ?? '';
  if (!keyData || !encKey) return null;

  const a = (block: string, n: string): string | null => {
    const m = new RegExp(`\\b${n}="([^"]*)"`).exec(block);
    return m ? m[1] : null;
  };
  const hash = hashByName(a(keyData, 'hashAlgorithm') ?? '');
  const pwHash = hashByName(a(encKey, 'hashAlgorithm') ?? '');
  if (!hash || !pwHash) return null;
  if ((a(keyData, 'cipherAlgorithm') ?? 'AES') !== 'AES') return null;

  const num = (block: string, n: string, dflt: number): number => {
    const v = Number(a(block, n));
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };

  return {
    hash,
    hashSize: num(keyData, 'hashSize', 64),
    blockSize: num(keyData, 'blockSize', 16),
    keyBytes: num(keyData, 'keyBits', 256) / 8,
    keySalt: b64(a(keyData, 'saltValue') ?? ''),
    spinCount: num(encKey, 'spinCount', 100000),
    pwSalt: b64(a(encKey, 'saltValue') ?? ''),
    pwKeyBytes: num(encKey, 'keyBits', 256) / 8,
    pwHash,
    encryptedKeyValue: b64(a(encKey, 'encryptedKeyValue') ?? ''),
    encryptedVerifierHashInput: b64(a(encKey, 'encryptedVerifierHashInput') ?? ''),
    encryptedVerifierHashValue: b64(a(encKey, 'encryptedVerifierHashValue') ?? ''),
  };
}

function agileBlockKey(ag: AgileInfo, base: Uint8Array, block: Uint8Array): Uint8Array {
  return fit(ag.pwHash(concat(base, block)), ag.pwKeyBytes);
}

function decryptAgile(info: Uint8Array, pkg: Uint8Array, password: string): Uint8Array {
  const ag = parseAgile(info);
  if (!ag) throw new Error('无法解析敏捷加密的 EncryptionInfo');

  const base = spin(ag.pwHash, ag.pwSalt, password, ag.spinCount);

  // 校验口令：解出 verifierHashInput，其哈希必须等于解出的 verifierHashValue
  const vi = aesDecryptCbc(agileBlockKey(ag, base, BLOCK_VERIFIER_INPUT), ag.pwSalt, ag.encryptedVerifierHashInput);
  const vv = aesDecryptCbc(agileBlockKey(ag, base, BLOCK_VERIFIER_VALUE), ag.pwSalt, ag.encryptedVerifierHashValue);
  if (!eq(ag.pwHash(vi.subarray(0, 16)), vv, Math.min(ag.hashSize, vv.length))) throw new WrongPasswordError();

  const secret = aesDecryptCbc(agileBlockKey(ag, base, BLOCK_KEY_VALUE), ag.pwSalt, ag.encryptedKeyValue)
    .subarray(0, ag.keyBytes);

  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength).getBigUint64(0, true));
  const body = pkg.subarray(8);
  // 分段解密：每 4096 字节一段，IV 由 keyData 盐与段号推出，段与段之间不串链
  const SEG = 4096;
  const out = new Uint8Array(body.length);
  for (let i = 0, off = 0; off < body.length; i++, off += SEG) {
    const iv = fit(ag.hash(concat(ag.keySalt, le32(i))), ag.blockSize);
    const chunk = body.subarray(off, Math.min(off + SEG, body.length));
    out.set(aesDecryptCbc(secret, iv, chunk), off);
  }
  return out.subarray(0, Math.min(size, out.length));
}

// ---------------- 入口 ----------------

/**
 * 解密 EncryptionInfo / EncryptedPackage 两条流，返回明文 Zip 字节。
 * 密码错误抛 {@link WrongPasswordError}，与「文件坏了」区分开。
 */
export function decryptOoxml(info: Uint8Array, pkg: Uint8Array, password: string): Uint8Array {
  if (info.length < 16 || pkg.length < 16) throw new Error('加密流不完整');
  const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const major = dv.getUint16(0, true);
  const minor = dv.getUint16(2, true);
  // 4.4 是敏捷加密；4.3 是扩展（自定义 provider，我们不支持）；其余走标准
  if (major === 4 && minor === 4) return decryptAgile(info, pkg, password);
  if (major === 4 && minor === 3) throw new Error('不支持扩展加密（自定义加密提供程序）');
  return decryptStandard(info, pkg, password);
}

/** 供调试与测试：读出加密方案名 */
export function encryptionScheme(info: Uint8Array): 'agile' | 'standard' | 'extensible' {
  const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const major = dv.getUint16(0, true);
  const minor = dv.getUint16(2, true);
  if (major === 4 && minor === 4) return 'agile';
  if (major === 4 && minor === 3) return 'extensible';
  return 'standard';
}
