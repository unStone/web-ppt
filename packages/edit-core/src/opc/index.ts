/** ZIP 扫描与压缩只在保存时需要，独立入口避免增加常驻编辑模型体积。 */
export { disposeOpcPackage, patchOpcPackage } from './patch';
export type { OpcFallbackReason, OpcPartChanges, OpcPatchResult, OpcSaveMode } from './types';
