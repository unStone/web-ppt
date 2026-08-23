import type {
  ElementBase, GeomSpec, ImageElement, OpcPackage, Presentation, ShapeElement, Slide, SlideElement,
} from '@web-ppt/core';

export type ElementId = string;
export type SlideId = string;
export type FractionalIndex = string;
export type EditableKind = 'full' | 'frame' | 'none';

export type SlideSource = Omit<Slide, 'elements' | 'editInfo'>;
export type SlideOverrides = Partial<SlideSource>;

type BaseOverrideKey =
  | 'x' | 'y' | 'w' | 'h' | 'rot' | 'flipH' | 'flipV'
  | 'effects' | 'link' | 'name' | 'scene3d';

/**
 * 只允许覆盖可写字段。`path` / `clipPath` 是由 geom 与当前尺寸算出的派生值，
 * `id` / `editInfo` 则属于源文件身份，二者都不能进入覆盖层。
 */
export type ElementOverrides = Partial<Pick<ElementBase, BaseOverrideKey>> & {
  fill?: ShapeElement['fill'];
  stroke?: ShapeElement['stroke'] | ImageElement['stroke'];
  openGeom?: ShapeElement['openGeom'];
  src?: ImageElement['src'];
  crop?: ImageElement['crop'];
  alpha?: ImageElement['alpha'];
  filter?: ImageElement['filter'];
};

export interface ElementMeta {
  geom?: GeomSpec;
  ph?: { type: string; idx?: string };
  origin?: { part: string; spid: number };
  locked?: boolean;
  hiddenByUser?: boolean;
  editable: EditableKind;
}

export interface ElementRecord {
  id: ElementId;
  parent: SlideId | ElementId;
  z: FractionalIndex;
  /** 解析得到的源值；编辑命令不得修改 */
  src: SlideElement;
  /** 仅保存用户明确改过的字段 */
  ovr: ElementOverrides;
  meta: ElementMeta;
  /** 只有 group 存在；顺序与 z 严格一致 */
  children?: ElementId[];
}

export interface SlideRecord {
  id: SlideId;
  src: SlideSource;
  ovr: SlideOverrides;
  children: ElementId[];
  origin: { part: string } | null;
}

export interface EditDocMeta {
  width: number;
  height: number;
  source: Presentation['source'];
  /** true 表示缺少可靠写回上下文，只能安全查看 */
  readonly: boolean;
}

/** 会话内身份分配状态必须随文档持久化，否则恢复后会复用旧 id。 */
export interface EditIdentity {
  prefix: string;
  nextSlide: number;
  nextElement: number;
}

export interface EditDoc {
  meta: EditDocMeta;
  identity: EditIdentity;
  slides: Record<SlideId, SlideRecord>;
  slideOrder: SlideId[];
  elements: Record<ElementId, ElementRecord>;
  package: OpcPackage | null;
}

export interface CreateDocOptions {
  /** 测试、协同或外部存储需要可预测身份时显式指定；省略时每份文档自动唯一 */
  idPrefix?: string;
}

export interface ProjectionInvalidation {
  dirtyElements: Set<ElementId>;
  dirtySlides: Set<SlideId>;
}
