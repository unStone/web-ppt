import { metafileToSvg, setMetafileDecoder } from '@web-ppt/core';
import type { MetafileOptions } from './image/emf';
import { decodeEmfPlus } from './image/emf-plus/decode';
export { decodeEmfPlus };
export type { EmfPlusResult } from './image/emf-plus/decode';

/** 适配现有同步图元 hook；EMF+ Only 失败返回 null，由宿主展示占位诊断。 */
export function emfPlusToSvg(bytes: Uint8Array, options?: MetafileOptions): string | null {
  const result = decodeEmfPlus(bytes, options);
  return result.mode === 'absent' ? metafileToSvg(bytes, options) : result.svg;
}
export function enableEmfPlus(): void { setMetafileDecoder(emfPlusToSvg); }
