import type { EditDoc } from '../types';
import { extensionAddressPatches, readExtensionAddress } from '../extension-addresses';

/** 迁移后的数据沿用旧身份；否则迟到补丁中的新增身份和标量引用会失去含义。 */
export function sharedCacheIdentities(doc: EditDoc, part: string): Readonly<Record<string, string>> | undefined {
  for (const patch of extensionAddressPatches(doc, 'chart-shared')) {
    const address = readExtensionAddress(patch.op === 'set' ? patch.value : undefined);
    if (address.target.length === 5 && address.target[2] === 'chart-shared'
      && address.target[3] === part && address.target[4] === 'dataset') {
      // 多所有者采用与新共享数据相同的原生序号和新增前缀。
      if (address.remap?.prefix === 'n:' && Object.entries(address.identities).every(([key, id]) => key === id)) return;
      return address.identities;
    }
  }
}
