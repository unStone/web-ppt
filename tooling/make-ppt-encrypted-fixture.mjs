/**
 * 生成 fixtures/sample-ppt-encrypted.ppt —— 老式 .ppt 的 RC4 CryptoAPI 加密。
 *
 * 与 OOXML 加密是完全不同的两套东西，所以要单独一个固件：
 *   OOXML —— 整包被封进 EncryptedPackage 流
 *   .ppt   —— 容器结构仍是明文，只有各**持久化对象**的内容被加密，
 *             且 RC4 的重置块号取「持久化对象 ID」，不是常见的按 512 字节分块
 *
 * 三处保持明文（定位加密信息本身要靠它们）：
 *   CurrentUserAtom（另一条流）/ UserEditAtom / PersistDirectoryAtom，
 * 外加 CryptSession10Container 自己。
 *
 * 两页各用一种密钥长度：40 位（要补零到 128 位）与 56 位（按原长度用）——
 * 这条规则搞反了口令校验就过不了，必须两种都有覆盖。
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCfb } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const PASSWORD = 'web-ppt-2024';

// ---------- 记录构造 ----------

const rec = (verInst, type, body) => {
  const out = Buffer.alloc(8 + body.length);
  out.writeUInt16LE(verInst, 0);
  out.writeUInt16LE(type, 2);
  out.writeUInt32LE(body.length, 4);
  Buffer.from(body).copy(out, 8);
  return out;
};
const utf16 = (s) => Buffer.from(s, 'utf16le');
const u32 = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32LE(x >>> 0, i * 4)); return b; };

const slideText = (title, lines) => Buffer.concat([
  rec(0x01, 0x03f3, Buffer.alloc(20)),          // SlidePersistAtom
  rec(0x00, 0x0f9f, u32(0)),                    // TextHeaderAtom: 标题
  rec(0x00, 0x0fa0, utf16(title)),              // TextCharsAtom
  rec(0x00, 0x0f9f, u32(1)),                    // TextHeaderAtom: 正文
  rec(0x00, 0x0fa0, utf16(lines.join('\r'))),
]);

/** 持久化对象 1：Document 容器（含两页的文本列表） */
const documentObj = rec(0x0f, 0x03e8, Buffer.concat([
  rec(0x01, 0x03e9, u32(5760, 4320, 5760, 4320, 0, 0, 0, 0, 0, 0)),   // DocumentAtom
  rec(0x0f, 0x0ff0, Buffer.concat([                                   // SlideListWithText
    slideText('加密的 .ppt', ['RC4 CryptoAPI 解密', '块号取持久化对象 ID', '而不是按 512 字节分块']),
    slideText('第二页', ['UserEditAtom 与持久化目录保持明文', '否则无从定位加密信息']),
  ])),
]));

// ---------- RC4 与密钥派生 ----------

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; const t = s[i]; s[i] = s[j]; s[j] = t; }
  const out = Buffer.alloc(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

/** 固定串派生盐，保证固件字节可重复 */
const seeded = (label, len) => createHash('sha512').update(`web-ppt/${label}`).digest().subarray(0, len);

function build(keyBits, salt) {
  const keyBytes = keyBits / 8;
  const h0 = createHash('sha1').update(Buffer.concat([salt, utf16(PASSWORD)])).digest();
  const keyFor = (block) => {
    const hf = createHash('sha1').update(Buffer.concat([h0, u32(block)])).digest();
    const k = hf.subarray(0, keyBytes);
    // 只有 40 位要补零到 128 位；56 位按原长度用
    if (keyBytes !== 5) return k;
    const out = Buffer.alloc(16);
    k.copy(out);
    return out;
  };

  // 口令校验对：verifier 与其哈希共用一条 RC4 流
  const verifier = seeded(`verifier-${keyBits}`, 16);
  const vh = createHash('sha1').update(verifier).digest();
  const encPair = rc4(keyFor(0), Buffer.concat([verifier, vh]));

  // EncryptionHeader：flags/sizeExtra/algID/algIDHash/keySize/providerType/reserved×2 + CSPName
  const csp = utf16('Microsoft Base Cryptographic Provider v1.0 ');
  const header = Buffer.alloc(32 + csp.length);
  header.writeUInt32LE(0x04, 0);        // fCryptoAPI
  header.writeUInt32LE(0x6801, 8);      // algID = RC4
  header.writeUInt32LE(0x8004, 12);     // algIDHash = SHA-1
  header.writeUInt32LE(keyBits, 16);
  header.writeUInt32LE(0x01, 20);       // providerType = RC4
  csp.copy(header, 32);

  const body = Buffer.concat([
    Buffer.from([2, 0, 2, 0]),                          // versionMajor/Minor = 2.2
    u32(0x04),                                          // EncryptionHeader.Flags
    u32(header.length),
    header,
    u32(16), salt, encPair.subarray(0, 16),
    u32(20), encPair.subarray(16, 36),
  ]);
  return { cryptSession: rec(0x0f, 0x2f14, body), keyFor };
}

// ---------- 组流 ----------

function makeStream(keyBits) {
  const salt = seeded(`salt-${keyBits}`, 16);
  const { cryptSession, keyFor } = build(keyBits, salt);

  // 布局：[对象1 Document][CryptSession(明文)][持久化目录(明文)][UserEditAtom(明文)]
  const DOC_ID = 1, ENC_ID = 2;
  const docOff = 0;
  const encOff = docOff + documentObj.length;
  const pdOff = encOff + cryptSession.length;

  // PersistDirectoryAtom：高 12 位是条目数、低 20 位是起始 id，随后是各偏移
  const pdBody = Buffer.concat([u32((2 << 20) | DOC_ID), u32(docOff, encOff)]);
  const persistDir = rec(0x00, 0x1772, pdBody);
  const ueOff = pdOff + persistDir.length;

  const ueBody = Buffer.alloc(32);
  ueBody.writeUInt32LE(256 + 1, 0);      // lastSlideIdRef
  ueBody.writeUInt16LE(0x0f, 4);         // version
  ueBody.writeUInt8(0, 6); ueBody.writeUInt8(3, 7);
  ueBody.writeUInt32LE(0, 8);            // offsetLastEdit：无上一次编辑
  ueBody.writeUInt32LE(pdOff, 12);       // offsetPersistDirectory
  ueBody.writeUInt32LE(DOC_ID, 16);      // docPersistIdRef
  ueBody.writeUInt32LE(ENC_ID + 1, 20);  // persistIdSeed
  ueBody.writeUInt16LE(0, 24);           // lastView
  ueBody.writeUInt32LE(ENC_ID, 28);      // encryptSessionPersistIdRef
  const userEdit = rec(0x00, 0x0ff5, ueBody);

  // 只加密持久化对象的内容，其余三处原样
  const doc = Buffer.concat([
    rc4(keyFor(DOC_ID), documentObj),
    cryptSession, persistDir, userEdit,
  ]);

  // Current User 流：headerToken 标记加密，offsetToCurrentEdit 指向 UserEditAtom
  const cuBody = Buffer.alloc(24);
  cuBody.writeUInt32LE(0x14, 0);          // size
  cuBody.writeUInt32LE(0xf3d1c4df, 4);    // headerToken = 已加密
  cuBody.writeUInt32LE(ueOff, 8);         // offsetToCurrentEdit
  cuBody.writeUInt16LE(0, 12);            // lenUserName
  cuBody.writeUInt16LE(0, 14);            // docFileVersion
  cuBody.writeUInt8(3, 16); cuBody.writeUInt8(0, 17);
  const currentUser = rec(0x00, 0x0ff6, cuBody);

  return { doc, currentUser };
}

for (const [name, keyBits] of [['sample-ppt-encrypted.ppt', 40], ['sample-ppt-encrypted-56.ppt', 56]]) {
  const { doc, currentUser } = makeStream(keyBits);
  const out = writeCfb([['PowerPoint Document', doc], ['Current User', currentUser]]);
  writeFileSync(join(root, 'fixtures', name), out);
  console.log(`fixtures/${name} 已生成（${out.length} 字节，${keyBits} 位密钥，密码 ${PASSWORD}）`);
}
