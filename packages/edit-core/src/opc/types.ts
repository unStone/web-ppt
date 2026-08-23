import type { OpcPackage } from '@web-ppt/core';

export type OpcPartChanges = Readonly<Record<string, Uint8Array | null>>;
export type OpcSaveMode = 'identity' | 'passthrough' | 'repacked';
export type OpcFallbackReason = 'archive-comment' | 'data-descriptor' | 'encrypted-entry'
  | 'legacy-filename' | 'multi-disk' | 'unsupported-compression' | 'zip64';

export interface OpcPatchResult {
  readonly bytes: Uint8Array;
  readonly package: OpcPackage;
  readonly mode: OpcSaveMode;
  readonly fallbackReason: OpcFallbackReason | null;
  readonly preservedEntries: number;
  readonly rewrittenEntries: number;
}
