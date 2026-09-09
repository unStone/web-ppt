import type { Register } from '../state';
import type { CollabExtensionOperation } from '../types';

// 版本仍由原寄存器持有；失败回滚恢复旧对象，证据随它恢复，废弃批次不会常驻。
export const evidence = new WeakMap<Register, CollabExtensionOperation>();
