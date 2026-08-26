export type WebPptSource = File | Blob | ArrayBuffer | Uint8Array;

export interface WebPptSourceIdentity {
  readonly fingerprint: `sha256:${string}`;
  readonly byteLength: number;
}

export async function sourceBytes(source: WebPptSource): Promise<Uint8Array<ArrayBuffer>> {
  // 指纹与解析必须消费同一份不可被调用方修改或 transfer 的快照。
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return copy;
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  throw new TypeError('PPT 来源必须是 File、Blob、ArrayBuffer 或 Uint8Array');
}

export async function fingerprintSourceBytes(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<WebPptSourceIdentity> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前环境不支持 Web Crypto，无法计算恢复源指纹');
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  const hex = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { fingerprint: `sha256:${hex}`, byteLength: bytes.byteLength };
}

/** 只按完整源字节识别恢复日志；文件名与时间戳都不是内容身份。 */
export async function fingerprintSource(source: WebPptSource): Promise<WebPptSourceIdentity> {
  return fingerprintSourceBytes(await sourceBytes(source));
}
