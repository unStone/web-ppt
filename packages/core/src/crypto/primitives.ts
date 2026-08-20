/**
 * ECMA-376 文档加密所需的最小密码学原语：SHA-1 / SHA-256 / SHA-512 与 AES 解密。
 *
 * 为什么不用 WebCrypto：
 *   1. `subtle.digest` 是异步的，而 agile 加密的密钥派生要迭代 spinCount（常见 100000）
 *      次哈希——十万次 await 的调度开销比同步实现慢一个数量级
 *   2. `subtle.decrypt` 的 AES-CBC 强制校验 PKCS#7 填充，而 Office 的分段是补零的，
 *      过不了校验；标准加密用的 ECB 模式 WebCrypto 更是压根不提供
 *
 * 本文件只做解密。加密侧（生成测试固件）在 tooling 里用 Node 的 crypto 完成。
 */

// ---------------- SHA-1 ----------------

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** 按 SHA 系列的规矩补位：0x80 + 补零 + 64 位大端长度 */
function padBE(msg: Uint8Array, blockBytes: number, lenBytes: number): Uint8Array {
  const bitLen = msg.length * 8;
  const total = Math.ceil((msg.length + 1 + lenBytes) / blockBytes) * blockBytes;
  const out = new Uint8Array(total);
  out.set(msg);
  out[msg.length] = 0x80;
  // 位长度写在末尾 8 字节；文档不会大到需要高位，只填低 53 位安全整数
  const dv = new DataView(out.buffer);
  dv.setUint32(total - 4, bitLen >>> 0, false);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  return out;
}

export function sha1(msg: Uint8Array): Uint8Array {
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const data = padBE(msg, 64, 8);
  const w = new Uint32Array(80);
  const dv = new DataView(data.buffer);

  for (let off = 0; off < data.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}

// ---------------- SHA-256 ----------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const data = padBE(msg, 64, 8);
  const dv = new DataView(data.buffer);
  const w = new Uint32Array(64);
  const rr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < data.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + add[i]) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}

// ---------------- SHA-512 / SHA-384 ----------------

/**
 * 64 位运算用 hi/lo 两个 32 位量模拟。用 BigInt 会简洁得多，
 * 但 spinCount 迭代要跑十万次，BigInt 的分配开销在这里是实打实的。
 */
const K512_HI = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  0xca273ece, 0xd186b8c7, 0xeada7dd6, 0xf57d4f7f, 0x06f067aa, 0x0a637dc5, 0x113f9804, 0x1b710b35,
  0x28db77f5, 0x32caab7b, 0x3c9ebe0a, 0x431d67c4, 0x4cc5d4be, 0x597f299c, 0x5fcb6fab, 0x6c44198c,
]);
const K512_LO = new Uint32Array([
  0xd728ae22, 0x23ef65cd, 0xec4d3b2f, 0x8189dbbc, 0xf348b538, 0xb605d019, 0xaf194f9b, 0xda6d8118,
  0xa3030242, 0x45706fbe, 0x4ee4b28c, 0xd5ffb4e2, 0xf27b896f, 0x3b1696b1, 0x25c71235, 0xcf692694,
  0x9ef14ad2, 0x384f25e3, 0x8b8cd5b5, 0x77ac9c65, 0x592b0275, 0x6ea6e483, 0xbd41fbd4, 0x831153b5,
  0xee66dfab, 0x2db43210, 0x98fb213f, 0xbeef0ee4, 0x3da88fc2, 0x930aa725, 0xe003826f, 0x0a0e6e70,
  0x46d22ffc, 0x5c26c926, 0x5ac42aed, 0x9d95b3df, 0x8baf63de, 0x3c77b2a8, 0x47edaee6, 0x1482353b,
  0x4cf10364, 0xbc423001, 0xd0f89791, 0x0654be30, 0xd6ef5218, 0x5565a910, 0x5771202a, 0x32bbd1b8,
  0xb8d2d0c8, 0x5141ab53, 0xdf8eeb99, 0xe19b48a8, 0xc5c95a63, 0xe3418acb, 0x7763e373, 0xd6b2b8a3,
  0x5defb2fc, 0x43172f60, 0xa1f0ab72, 0x1a6439ec, 0x23631e28, 0xde82bde9, 0xb2c67915, 0xe372532b,
  0xea26619c, 0x21c0c207, 0xcde0eb1e, 0xee6ed178, 0x72176fba, 0xa2c898a6, 0xbef90dae, 0x131c471b,
  0x23047d84, 0x40c72493, 0x15c9bebc, 0x9c100d4c, 0xcb3e42b6, 0xfc657e2a, 0x3ad6faec, 0x4a475817,
]);

const IV512 = [
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
];
const IV384 = [
  0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
  0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
];

function sha512Core(msg: Uint8Array, iv: number[], outBytes: number): Uint8Array {
  const hHi = new Uint32Array(8), hLo = new Uint32Array(8);
  for (let i = 0; i < 8; i++) { hHi[i] = iv[i * 2]; hLo[i] = iv[i * 2 + 1]; }

  const data = padBE(msg, 128, 16);
  const dv = new DataView(data.buffer);
  const wHi = new Uint32Array(80), wLo = new Uint32Array(80);

  // 64 位右旋 / 右移，结果写进临时对，避免每步都构造数组
  let tHi = 0, tLo = 0;
  const rotr64 = (hi: number, lo: number, n: number): void => {
    if (n < 32) { tHi = (hi >>> n) | (lo << (32 - n)); tLo = (lo >>> n) | (hi << (32 - n)); }
    else if (n === 32) { tHi = lo; tLo = hi; }
    else { const m = n - 32; tHi = (lo >>> m) | (hi << (32 - m)); tLo = (hi >>> m) | (lo << (32 - m)); }
  };
  const shr64 = (hi: number, lo: number, n: number): void => {
    if (n < 32) { tHi = hi >>> n; tLo = (lo >>> n) | (hi << (32 - n)); }
    else { tHi = 0; tLo = hi >>> (n - 32); }
  };

  for (let off = 0; off < data.length; off += 128) {
    for (let i = 0; i < 16; i++) {
      wHi[i] = dv.getUint32(off + i * 8, false);
      wLo[i] = dv.getUint32(off + i * 8 + 4, false);
    }
    for (let i = 16; i < 80; i++) {
      // s0 = rotr(w[i-15],1) ^ rotr(w[i-15],8) ^ shr(w[i-15],7)
      rotr64(wHi[i - 15], wLo[i - 15], 1); let s0h = tHi, s0l = tLo;
      rotr64(wHi[i - 15], wLo[i - 15], 8); s0h ^= tHi; s0l ^= tLo;
      shr64(wHi[i - 15], wLo[i - 15], 7); s0h ^= tHi; s0l ^= tLo;
      rotr64(wHi[i - 2], wLo[i - 2], 19); let s1h = tHi, s1l = tLo;
      rotr64(wHi[i - 2], wLo[i - 2], 61); s1h ^= tHi; s1l ^= tLo;
      shr64(wHi[i - 2], wLo[i - 2], 6); s1h ^= tHi; s1l ^= tLo;

      const lo = (wLo[i - 16] >>> 0) + (s0l >>> 0) + (wLo[i - 7] >>> 0) + (s1l >>> 0);
      wLo[i] = lo >>> 0;
      wHi[i] = (wHi[i - 16] + s0h + wHi[i - 7] + s1h + Math.floor(lo / 0x100000000)) >>> 0;
    }

    let aH = hHi[0], aL = hLo[0], bH = hHi[1], bL = hLo[1];
    let cH = hHi[2], cL = hLo[2], dH = hHi[3], dL = hLo[3];
    let eH = hHi[4], eL = hLo[4], fH = hHi[5], fL = hLo[5];
    let gH = hHi[6], gL = hLo[6], hH = hHi[7], hL = hLo[7];

    for (let i = 0; i < 80; i++) {
      rotr64(eH, eL, 14); let S1h = tHi, S1l = tLo;
      rotr64(eH, eL, 18); S1h ^= tHi; S1l ^= tLo;
      rotr64(eH, eL, 41); S1h ^= tHi; S1l ^= tLo;
      const chH = (eH & fH) ^ (~eH & gH), chL = (eL & fL) ^ (~eL & gL);

      let lo = (hL >>> 0) + (S1l >>> 0) + (chL >>> 0) + K512_LO[i] + (wLo[i] >>> 0);
      const t1L = lo >>> 0;
      const t1H = (hH + S1h + chH + K512_HI[i] + wHi[i] + Math.floor(lo / 0x100000000)) >>> 0;

      rotr64(aH, aL, 28); let S0h = tHi, S0l = tLo;
      rotr64(aH, aL, 34); S0h ^= tHi; S0l ^= tLo;
      rotr64(aH, aL, 39); S0h ^= tHi; S0l ^= tLo;
      const mjH = (aH & bH) ^ (aH & cH) ^ (bH & cH), mjL = (aL & bL) ^ (aL & cL) ^ (bL & cL);
      lo = (S0l >>> 0) + (mjL >>> 0);
      const t2L = lo >>> 0;
      const t2H = (S0h + mjH + Math.floor(lo / 0x100000000)) >>> 0;

      hH = gH; hL = gL; gH = fH; gL = fL; fH = eH; fL = eL;
      lo = (dL >>> 0) + (t1L >>> 0);
      eL = lo >>> 0; eH = (dH + t1H + Math.floor(lo / 0x100000000)) >>> 0;
      dH = cH; dL = cL; cH = bH; cL = bL; bH = aH; bL = aL;
      lo = (t1L >>> 0) + (t2L >>> 0);
      aL = lo >>> 0; aH = (t1H + t2H + Math.floor(lo / 0x100000000)) >>> 0;
    }

    const addH = [aH, bH, cH, dH, eH, fH, gH, hH];
    const addL = [aL, bL, cL, dL, eL, fL, gL, hL];
    for (let i = 0; i < 8; i++) {
      const lo = (hLo[i] >>> 0) + (addL[i] >>> 0);
      hLo[i] = lo >>> 0;
      hHi[i] = (hHi[i] + addH[i] + Math.floor(lo / 0x100000000)) >>> 0;
    }
  }

  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) { odv.setUint32(i * 8, hHi[i], false); odv.setUint32(i * 8 + 4, hLo[i], false); }
  return out.subarray(0, outBytes);
}

export const sha512 = (m: Uint8Array): Uint8Array => sha512Core(m, IV512, 64);
export const sha384 = (m: Uint8Array): Uint8Array => sha512Core(m, IV384, 48);

export type HashFn = (m: Uint8Array) => Uint8Array;

/** agile 加密的 hashAlgorithm 属性 → 实现；认不出返回 null 而不是猜 */
export function hashByName(name: string): HashFn | null {
  switch (name.toUpperCase().replace(/[-_]/g, '')) {
    case 'SHA1': return sha1;
    case 'SHA256': return sha256;
    case 'SHA384': return sha384;
    case 'SHA512': return sha512;
    default: return null;
  }
}

// ---------------- AES 解密 ----------------

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]);

(function buildTables(): void {
  // GF(2^8) 上求逆再做仿射变换，标准 AES S 盒的构造法
  const exp = new Uint8Array(256), log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 256; i++) {
    exp[i] = x; log[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 0; i < 256; i++) {
    let inv = i ? exp[255 - log[i]] : 0;
    let r = inv;
    // 仿射变换：b ^ rotl(b,1) ^ rotl(b,2) ^ rotl(b,3) ^ rotl(b,4) ^ 0x63
    for (let k = 0; k < 4; k++) { inv = ((inv << 1) | (inv >>> 7)) & 0xff; r ^= inv; }
    SBOX[i] = r ^ 0x63;
  }
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();

function xtime(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}

function mul(a: number, b: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return r & 0xff;
}

function expandKey(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4;
  const nr = nk + 6;
  const w: number[][] = [];
  for (let i = 0; i < nk; i++) w.push([key[i * 4], key[i * 4 + 1], key[i * 4 + 2], key[i * 4 + 3]]);
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t = w[i - 1].slice();
    if (i % nk === 0) {
      t = [SBOX[t[1]] ^ RCON[i / nk - 1], SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
    } else if (nk > 6 && i % nk === 4) {
      t = t.map((v) => SBOX[v]);
    }
    w.push(t.map((v, j) => v ^ w[i - nk][j]));
  }
  const rounds: Uint8Array[] = [];
  for (let r = 0; r <= nr; r++) {
    const rk = new Uint8Array(16);
    for (let c = 0; c < 4; c++) for (let j = 0; j < 4; j++) rk[c * 4 + j] = w[r * 4 + c][j];
    rounds.push(rk);
  }
  return rounds;
}

/** 单块（16 字节）AES 解密，就地写回 out */
function decryptBlock(rk: Uint8Array[], input: Uint8Array, off: number, out: Uint8Array, outOff: number): void {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = input[off + i] ^ rk[rk.length - 1][i];

  for (let round = rk.length - 2; round >= 0; round--) {
    // InvShiftRows：第 r 行右移 r 格
    const t = s.slice();
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) s[((c + r) % 4) * 4 + r] = t[c * 4 + r];
    }
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    for (let i = 0; i < 16; i++) s[i] ^= rk[round][i];
    if (round > 0) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
        s[c * 4] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
        s[c * 4 + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
        s[c * 4 + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
        s[c * 4 + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
      }
    }
  }
  out.set(s, outOff);
}

/** AES-ECB 解密（标准加密用）。长度必须是 16 的倍数 */
export function aesDecryptEcb(key: Uint8Array, data: Uint8Array): Uint8Array {
  const rk = expandKey(key);
  const out = new Uint8Array(data.length - (data.length % 16));
  for (let i = 0; i + 16 <= data.length; i += 16) decryptBlock(rk, data, i, out, i);
  return out;
}

/**
 * AES-CBC 解密（agile 加密用）。不去填充——Office 的分段是补零的，
 * 按 PKCS#7 去填充会把真实数据削掉。
 */
export function aesDecryptCbc(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const rk = expandKey(key);
  const n = data.length - (data.length % 16);
  const out = new Uint8Array(n);
  let prev = iv.subarray(0, 16);
  for (let i = 0; i + 16 <= n; i += 16) {
    decryptBlock(rk, data, i, out, i);
    for (let j = 0; j < 16; j++) out[i + j] ^= prev[j];
    prev = data.subarray(i, i + 16);
  }
  return out;
}
