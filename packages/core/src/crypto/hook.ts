/**
 * 文档解密的注入点。
 *
 * 与图元文件解码器同理：AES 与 SHA 实现体积不小，而绝大多数使用者不会遇到
 * 加密文件，做成 hook 就能整块 tree-shake 掉。未注入时遇到加密文件报错，
 * 不会静默给出空白文稿。
 */

export type Decryptor = (info: Uint8Array, pkg: Uint8Array, password: string) => Uint8Array;

let decryptor: Decryptor | null = null;

export function setDecryptor(fn: Decryptor): void {
  decryptor = fn;
}

export function hasDecryptor(): boolean {
  return decryptor !== null;
}

export function getDecryptor(): Decryptor | null {
  return decryptor;
}
