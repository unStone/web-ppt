import { AgentToolError } from './errors';

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeBase64(value: string, commandIndex: number): Uint8Array {
  if (!BASE64.test(value)) {
    throw new AgentToolError('invalid-base64', `命令 ${commandIndex} 的图片字节不是规范 Base64`, commandIndex);
  }
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new AgentToolError('invalid-base64', `命令 ${commandIndex} 的图片字节无法解码`, commandIndex);
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
