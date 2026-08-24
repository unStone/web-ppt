import type {
  ElementBase, GeomSpec, ImageElement, OpcPackage, Paragraph, Presentation, ShapeCreationDefaults, ShapeElement, Slide,
  SlideElement, SlideLayoutTemplate, TextBody, TextRun,
} from '@web-ppt/core';

export type ElementId = string;
export type SlideId = string;
export type FractionalIndex = string;
export type EditableKind = 'full' | 'frame' | 'none';

export interface TableCellAddress {
  readonly r: number;
  readonly c: number;
}

/** 来源行沿用坐标；新增行把稳定 rowId 编进 key，避免并发追加改变文字归属。 */
export type TableCellKey = `${number}:${number}` | `@${number}:${string}:${number}`;
export type TableCellRowRef = number | TableRowId;

export interface ElementInsertionSource {
  readonly markup: string;
  readonly namespaces: Readonly<Record<string, string>>;
  /** 来源 spid 字符串 → 目标 part 新 spid。 */
  readonly spids: Readonly<Record<string, number>>;
  readonly relationships?: readonly ElementInsertionRelationship[];
  readonly resources?: readonly ElementInsertionResource[];
}

export interface ElementInsertionRelationship {
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode?: 'External';
}

export interface ElementInsertionResource {
  readonly targetPart: string;
  readonly hash: string;
  readonly mime: string;
  readonly extension: string;
  readonly bytes: string;
  /** true 表示该 part 由本编辑会话生成，撤销后保存必须删除。 */
  readonly created: boolean;
}

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
  text?: TextOverride;
  /** 来源格按坐标、新增格按稳定行身份稀疏覆盖，避免结构 rebase 迁移文字。 */
  tableCells?: Record<TableCellKey, TableCellOverrides>;
  /** 表格行使用稳定身份稀疏追加；不复制整张 rows，未来可沿同一身份扩展中间插入。 */
  tableRows?: Record<TableRowId, TableRowInsertion>;
};

export interface TableCellOverrides {
  text?: TextOverride;
}

export type TableRowId = string;

export interface TableRowInsertion {
  readonly order: FractionalIndex;
}

export interface TextMark {
  readonly from: number;
  readonly to: number;
  readonly props: Omit<TextRun, 'text'>;
  /** 公式在编辑字符串里只占一个原子，线性文本另存用于投影与导出。 */
  readonly atomText?: string;
  /** 来源身份让保存层尽量复用原始 rPr / fld / 公式节点。 */
  readonly source?: { readonly paragraph: number; readonly run: number };
  /** 只有来源内容本身能克隆 fld/公式；新输入只借 source 继承 rPr。 */
  readonly preserveSource?: true;
  /** 用户对来源 rPr 的稀疏覆盖；null 表示删除直接格式、回到继承。 */
  readonly runOverrides?: RunPropertyOverrides;
  /** 删除直接格式后用于恢复继承所得的有效值；只含字符格式 P0 字段。 */
  readonly inheritedProps?: RunProperties;
  /** 继承字体可能分别含 latin/ea/cs，不能为面板的单字体值而丢掉回退栈。 */
  readonly inheritedFonts?: readonly string[];
}

export interface RunProperties {
  readonly font: string | null;
  readonly size: number;
  readonly b: boolean;
  readonly i: boolean;
  readonly u: boolean;
  readonly strike: boolean;
}

export interface RunPropertyOverrides {
  readonly font?: string | null;
  readonly size?: number | null;
  readonly b?: boolean | null;
  readonly i?: boolean | null;
  readonly u?: boolean | null;
  readonly strike?: boolean | null;
}

/** 外部富文本进入模型前的最小白名单；不允许携带 OOXML 来源或 DOM 身份。 */
export interface TextFragmentMark {
  readonly from: number;
  readonly to: number;
  readonly props: RunPropertyOverrides;
}

export interface TextFragmentParagraph {
  readonly text: string;
  readonly marks: readonly TextFragmentMark[];
}

export interface TextFragment {
  readonly paragraphs: readonly TextFragmentParagraph[];
}

export interface RunPropertyState<T> {
  readonly value: T | null;
  readonly mixed: boolean;
}

export interface RunPropertiesState {
  readonly font: RunPropertyState<string>;
  readonly size: RunPropertyState<number>;
  readonly b: RunPropertyState<boolean>;
  readonly i: RunPropertyState<boolean>;
  readonly u: RunPropertyState<boolean>;
  readonly strike: RunPropertyState<boolean>;
}

export interface ParagraphPropertyOverrides {
  readonly align?: Paragraph['align'] | null;
  readonly lineHeight?: number | null;
  readonly spaceBefore?: number | null;
  readonly spaceAfter?: number | null;
  readonly marginLeft?: number | null;
  readonly indent?: number | null;
}

export interface ParagraphProperties {
  readonly align: Paragraph['align'];
  readonly lineHeight: number | null;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  readonly marginLeft: number;
  readonly indent: number;
}

export interface ParagraphPropertiesState {
  readonly align: RunPropertyState<Paragraph['align']>;
  readonly lineHeight: RunPropertyState<number>;
  readonly spaceBefore: RunPropertyState<number>;
  readonly spaceAfter: RunPropertyState<number>;
  readonly marginLeft: RunPropertyState<number>;
  readonly indent: RunPropertyState<number>;
}

export type TextBodyAutoFit = 'none' | 'normal' | 'shape';

export interface TextBodyProperties {
  readonly anchor: TextBody['anchor'];
  readonly insets: readonly [number, number, number, number];
  readonly wrap: boolean;
  readonly vert: NonNullable<TextBody['vert']>;
  readonly anchorCtr: boolean;
  readonly columns: number;
  readonly columnGap: number;
  readonly autoFit: TextBodyAutoFit;
}

export interface TextBodyPropertyOverrides {
  readonly anchor?: TextBodyProperties['anchor'] | null;
  readonly insets?: TextBodyProperties['insets'] | null;
  readonly wrap?: boolean | null;
  readonly vert?: TextBodyProperties['vert'] | null;
  readonly anchorCtr?: boolean | null;
  readonly columns?: number | null;
  readonly columnGap?: number | null;
  readonly autoFit?: TextBodyAutoFit | null;
}

export interface FlatTextParagraph {
  readonly text: string;
  readonly props: Omit<Paragraph, 'runs'>;
  readonly marks: readonly TextMark[];
  readonly sourceParagraph?: number;
  /** 用户对来源 pPr 的稀疏覆盖；null 表示删除直接格式、回到继承。 */
  readonly paragraphOverrides?: ParagraphPropertyOverrides;
  /** 删除直接段落格式后恢复的继承有效值。 */
  readonly inheritedParagraphProps?: ParagraphProperties;
  /** 来源 pPr 的直接字段集合，用于区分“删除直设”与严格 no-op。 */
  readonly directParagraphProps?: Readonly<Partial<Record<keyof ParagraphProperties, true>>>;
}

export type TextBodyOverride = Omit<TextBody, 'paragraphs' | 'editInfo'>;

export type TextOverride = {
  readonly kind: 'empty';
  /** 清空文字后仍保留 bodyPr 的有效值，属性面板不能因此失去编辑入口。 */
  readonly body?: TextBodyOverride;
  readonly bodyOverrides?: TextBodyPropertyOverrides;
} | {
  readonly kind: 'flat';
  readonly body: TextBodyOverride;
  /** 只记录用户触碰过的 bodyPr 字段；null 表示清除本层直设。 */
  readonly bodyOverrides?: TextBodyPropertyOverrides;
  readonly paragraphs: readonly FlatTextParagraph[];
};

export interface ElementMeta {
  geom?: GeomSpec;
  ph?: { type: string; idx?: string };
  origin?: { part: string; spid: number };
  locked?: boolean;
  /** 来源文件只禁止移动；与宿主设置的通用 locked 分开，避免误伤其他编辑。 */
  moveLocked?: boolean;
  /** 空文字形状的编辑格式入口；首次输入后由 flat override 接管。 */
  textTemplate?: TextBody;
  /** 会话中新建的元素没有保存基线宿主；撤销时不能把它误记成来源删除。 */
  created?: boolean;
  /** 仅新建树根携带；保存从初始基线重建时据此重新插入宿主。 */
  insertion?: ElementInsertionSource;
  hiddenByUser?: boolean;
  editable: EditableKind;
}

export interface ElementRecord {
  id: ElementId;
  parent: SlideId | ElementId;
  /** 解析得到的来源绘制序；编辑命令不得修改 */
  z: FractionalIndex;
  /** 仅当用户改变层级时存在；删除后重新落回来源序可以释放这份稀疏状态 */
  order?: FractionalIndex;
  /** 解析得到的源值；编辑命令不得修改 */
  src: SlideElement;
  /** 仅保存用户明确改过的字段 */
  ovr: ElementOverrides;
  meta: ElementMeta;
  /** 只有 group 存在；顺序与 z 严格一致 */
  children?: ElementId[];
}

/** 已删除根只保留最小写回锚点；完整子树由历史 patch 持有，避免模型重复占用内存。 */
export interface RemovedElementRecord {
  id: ElementId;
  parent: SlideId | ElementId;
  meta: ElementMeta;
}

export interface SlideRecord {
  id: SlideId;
  src: SlideSource;
  ovr: SlideOverrides;
  children: ElementId[];
  /** 页序变化时只需失效这些动态字段及祖先，避免把页尾全部元素推给视图订阅者。 */
  dynamicSlideNumbers: ElementId[];
  /** 相对页序动作或稳定 part 跳转；插页后由投影层重新解析目标序号。 */
  dynamicSlideLinks: ElementId[];
  origin: { part: string } | null;
  layoutId?: string;
  /** 仅会话中新页存在；保存层据此物化 OPC part 与 presentation 引用。 */
  creation?: SlideCreation;
  /** 解析期已在当前页主题/颜色映射上求值，新增形状无需理解 OOXML 主题。 */
  defaultShape?: ShapeCreationDefaults;
}

export interface SlideCreation {
  readonly layoutPart: string;
  readonly layoutRelationshipId: string;
  readonly presentationSlideId: number;
  readonly presentationRelationshipId: string;
  /** 锚点页在 presentation.xml 中的数值 id；section 写回以它定位。 */
  readonly sectionAfterSlideId?: number;
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
  /** part 内 cNvPr@id 分配状态；首次新增时才从保留 XML 求最大值。 */
  nextSpid: Record<string, number>;
  /** 三项均惰性初始化，未使用新增页能力时不扫描任何保存期身份。 */
  nextSlidePart?: number;
  nextPresentationSlideId?: number;
  nextPresentationRelationship?: number;
}

/** 只保存首次触碰的 XML part；必须随文档 structuredClone 才能在 Worker 中正确撤销后保存。 */
export interface EditSaveState {
  baselines: Record<string, Uint8Array>;
  createdParts: string[];
}

export interface EditDoc {
  meta: EditDocMeta;
  identity: EditIdentity;
  slides: Record<SlideId, SlideRecord>;
  slideOrder: SlideId[];
  layouts: Record<string, SlideLayoutTemplate>;
  layoutOrder: string[];
  elements: Record<ElementId, ElementRecord>;
  removedElements: Record<ElementId, RemovedElementRecord>;
  readonly package: OpcPackage | null;
  saveState: EditSaveState;
}

export interface CreateDocOptions {
  /** 测试、协同或外部存储需要可预测身份时显式指定；省略时每份文档自动唯一 */
  idPrefix?: string;
}

export interface ProjectionInvalidation {
  dirtyElements: Set<ElementId>;
  dirtySlides: Set<SlideId>;
}
