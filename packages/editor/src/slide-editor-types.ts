import type {
  ElementId, LinkTarget, ParagraphPropertiesState, ParagraphPropertyOverrides, RunLinkState,
  RunPropertiesState, RunPropertyOverrides, SlideId, TextBodyProperties, TextBodyPropertyOverrides,
} from '@web-ppt/edit-core';
import type { ImageInsertOptions, ImageReplaceOptions } from './image-insertion';
import type { SnapMargins } from './snap';
import type { TableInsertOptions } from './table-insertion';

export type EditorMode = 'view' | 'edit';
export type LinkFollowSource = 'view' | 'edit' | 'api';

export interface LinkFollowContext {
  source: LinkFollowSource;
  event?: MouseEvent | KeyboardEvent;
}

/** 返回 true 表示宿主已经完成路由，编辑器不再执行默认跳转。 */
export type LinkFollowHandler = (target: LinkTarget, context: LinkFollowContext) => boolean | void;

export interface SlideEditorOptions {
  slideId?: SlideId;
  mode?: EditorMode;
  zoom?: number;
  /** 默认 auto；受 WebKit foreignObject 缩放缺陷影响时自动切到原生 SVG 文本。 */
  textMode?: 'auto' | 'html' | 'svg';
  /** 默认开启；false 使本视图的移动手势保留原始指针位移。 */
  snapping?: boolean;
  /** 文档没有通用形状页边距；需要时由宿主在幻灯片 px 中显式给出。 */
  snapMargins?: SnapMargins;
  /** React/Vue 等宿主可接管路由；返回 true 阻止内置页跳转或安全新窗口。 */
  onLinkFollow?: LinkFollowHandler;
}

export interface SlideEditor {
  readonly element: HTMLDivElement;
  readonly mode: EditorMode;
  readonly slideId: SlideId;
  readonly zoom: number;
  readonly snapping: boolean;
  readonly destroyed: boolean;
  setMode(mode: EditorMode): void;
  setSlide(slideId: SlideId): void;
  setZoom(zoom: number): void;
  setSnapping(enabled: boolean): void;
  /** 省略目标时跟随当前单一元素或文字选区；内部页始终使用稳定 SlideId。 */
  followLink(target?: LinkTarget): boolean;
  /** 注册外置工具栏，使其 pointer 交互不结束当前文字编辑。 */
  registerTextUi(element: HTMLElement): () => void;
  queryRunProps(): RunPropertiesState | null;
  queryRunLink(): RunLinkState | null;
  setRunProps(props: RunPropertyOverrides): boolean;
  queryParaProps(): ParagraphPropertiesState | null;
  setParaProps(props: ParagraphPropertyOverrides): boolean;
  queryBodyProps(): TextBodyProperties | null;
  setBodyProps(props: TextBodyPropertyOverrides): boolean;
  insertImage(file: Blob, options?: ImageInsertOptions): Promise<ElementId>;
  chooseImage(options?: ImageInsertOptions): Promise<ElementId | null>;
  replaceImage(file: Blob, options?: ImageReplaceOptions): Promise<ElementId>;
  chooseReplacementImage(options?: ImageReplaceOptions): Promise<ElementId | null>;
  insertTable(rows: number, cols: number, options?: TableInsertOptions): ElementId;
  /** 双击图片之外的框架无关入口；省略 id 时使用当前单选图片。 */
  startImageCrop(id?: ElementId): boolean;
  endImageCrop(): void;
  destroy(): void;
}
