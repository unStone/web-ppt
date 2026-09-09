export interface FontSource {
  id: string;
  family?: string;
  bytes?: Uint8Array;
  origin: 'explicit' | 'embedded' | 'substitute';
  sourceLabel?: string;
  embeddingEvidence?: string;
  /** 上游容器或使用许可施加的额外限制，只能收紧 sfnt 自身权限。 */
  restrictions?: FontEmbeddingRights;
}

export interface FontRequestOptions {
  purpose: 'edit' | 'view-print';
  signal?: AbortSignal;
}

export interface FontRequest extends FontRequestOptions {
  family: string;
  weight: number;
  italic: boolean;
}

export interface FontFaceInfo {
  id: string;
  family: string;
  sourceFamily: string;
  weight: number;
  italic: boolean;
  format: 'ttf-glyf';
  unitsPerEm: number;
  glyphCount: number;
  bbox: readonly [number, number, number, number];
  fsType: number;
  os2Version: number;
  byteLength: number;
  origin: FontSource['origin'];
  sourceLabel?: string;
  embeddingEvidence?: string;
  embedding: FontEmbeddingRights;
}

export interface FontEmbeddingRights {
  usage: 'installable' | 'editable' | 'view-print' | 'restricted';
  subsetAllowed: boolean;
  outlineAllowed: boolean;
}

export interface FontEmbedding { bytes: Uint8Array; info: FontFaceInfo }

export type FontScript = 'Latn' | 'Hani';
export interface FontShapeOptions extends FontRequestOptions {
  script: FontScript;
  direction: 'ltr';
  language: string;
}
export interface PositionedGlyph {
  id: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}
export interface GlyphCluster {
  /** 原文 UTF-16 区间；字形编号与原文不可互相替代。 */
  start: number;
  end: number;
  text: string;
  glyphStart: number;
  glyphEnd: number;
}
export interface GlyphRun {
  faceId: string;
  text: string;
  script: FontScript;
  direction: 'ltr';
  language: string;
  unitsPerEm: number;
  xAdvance: number;
  yAdvance: number;
  glyphs: PositionedGlyph[];
  clusters: GlyphCluster[];
}

/** 适配器边界只使用设计单位和 UTF-16 簇，不暴露第三方字体对象。 */
export interface ShaperGlyph extends PositionedGlyph { cluster: number }
export interface FontShaperFace {
  shape(text: string, options: FontShapeOptions): Promise<ShaperGlyph[]>;
  outline(glyphId: number, options: FontRequestOptions): Promise<string>;
  dispose(): void;
}
export interface FontShaper {
  open(font: FontEmbedding, signal: AbortSignal): Promise<FontShaperFace>;
  dispose(): void;
}
export interface FontProviderOptions {
  loadShaper?: (signal: AbortSignal) => Promise<FontShaper>;
  limits?: Partial<FontProviderLimits>;
  decodeEot?: (bytes: Uint8Array, options: {signal: AbortSignal; maxOutputBytes: number}) => Promise<Uint8Array | null>;
}
export interface FontProviderLimits {
  maxFontBytes: number;
  maxTotalFontBytes: number;
  maxFaces: number;
  maxGlyphs: number;
  maxTextLength: number;
}

export type FontProblem = 'font-bytes-unavailable' | 'provider-disposed' | 'invalid-font' | 'aborted'
  | 'face-unavailable' | 'duplicate-face-id' | 'ambiguous-face' | 'resource-limit' | 'embedding-restricted'
  | 'preview-print-only' | 'bitmap-only' | 'cmap-not-supported' | 'missing-glyphs'
  | 'unsupported-script' | 'unsupported-direction' | 'script-mismatch' | 'invalid-text'
  | 'shaper-unavailable' | 'shaper-failed' | 'invalid-glyph-id' | 'invalid-request'
  | 'needs-container-decoder' | 'collection-not-supported' | 'variable-not-supported'
  | 'cff-not-supported' | 'color-font-not-supported' | 'decoder-unavailable' | 'decode-failed'
  | 'eot-root-restricted' | 'eot-feature-not-supported' | 'subset-not-permitted'
  | 'measurement-not-prepared' | 'unsupported-layout' | 'layout-failed' | 'face-style-mismatch' | 'font-install-failed';
export interface FontFailure {
  ok: false;
  reason: FontProblem;
  faceId?: string;
  missing?: Array<{start: number; end: number; text: string}>;
  range?: {start: number; end: number};
}
export type FontResult<T> = {ok: true; value: T} | FontFailure;
