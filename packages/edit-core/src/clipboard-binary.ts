import { sha256 as sha256Bytes } from '@web-ppt/core';

/** ClipboardEvent 是同步 API，因此不能依赖异步 WebCrypto。 */
export function sha256(bytes: Uint8Array): string {
  return [...sha256Bytes(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
