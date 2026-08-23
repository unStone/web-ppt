import type { OpcPackage } from '@web-ppt/core';
import type { OwnedOpcPackage } from '../opc-owner-protocol';

const EMPTY_BYTES = new Uint8Array();
const EMPTY_PARTS = Object.freeze(Object.create(null)) as Readonly<Record<string, Uint8Array>>;

/** 返回可释放、但仍能 structuredClone 的纯数据句柄。 */
export function createOwnedPackage(
  bytes: Uint8Array,
  parts: Readonly<Record<string, Uint8Array>>,
): OpcPackage {
  let currentBytes = bytes;
  let currentParts = parts;
  let disposed = false;
  const handle = {
    format: 'pptx' as const,
    get bytes(): Uint8Array { return currentBytes; },
    get parts(): Readonly<Record<string, Uint8Array>> { return currentParts; },
    get disposed(): boolean { return disposed; },
  } as OwnedOpcPackage;
  Object.defineProperty(handle, 'dispose', {
    value: () => {
      currentBytes = EMPTY_BYTES;
      currentParts = EMPTY_PARTS;
      disposed = true;
    },
  });
  return Object.freeze(handle);
}

export function releaseOwnedPackage(pkg: OpcPackage): void {
  (pkg as OwnedOpcPackage).dispose?.();
}
