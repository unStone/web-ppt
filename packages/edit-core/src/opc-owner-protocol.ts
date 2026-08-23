import type { OpcPackage } from '@web-ppt/core';

/** 仅供保存包所有者与 EditDoc 共享；dispose 必须保持非枚举，避免破坏 structuredClone。 */
export interface OwnedOpcPackage extends OpcPackage {
  dispose?: () => void;
}
