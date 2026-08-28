import type {
  Effects, ElementBase, Fill, GeomSpec, ImageElement, OpcPackage, Paragraph, PlaceholderDirectFlags,
  Presentation, ShapeCreationDefaults, ShapeElement, Slide, Stroke, Transition,
  TableCreationDefaults,
  SlideElement, SlideLayoutTemplate, TextBody, TextRun,
} from '@web-ppt/core';
import type { EmphasisAnimationEffect, EntranceExitAnimationEffect } from './animation-catalog';

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
  /** false 表示宿主只是空容器，后代要按当前模型层级分别插入或从来源树移动。 */
  readonly containsDescendants?: false;
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

/** 图片替换与新增元素共用关系/媒体闭包，但不伪装成一棵新插入 XML 树。 */
export interface ElementImageReplacement {
  readonly src: string;
  readonly relationships: readonly ElementInsertionRelationship[];
  /** 大字节只在文档资源表存一份；历史 Patch 仅携带哈希引用。 */
  readonly resourceHash: string;
  /** 新建/粘贴图片的来源关系已被新 blip 取代；保存时不能继续把它当活跃引用。 */
  readonly suppressedRelationshipId?: string;
}

/** 页面背景会克隆未知扩展；因此除主图片外还要持有扩展引用的完整关系/资源闭包。 */
export interface SlideImageBackground extends ElementImageReplacement {
  readonly imageRelationshipId: string;
  readonly resourceHashes: readonly string[];
  /** 存在时必须能回证为当前页的真实 OPC 背景来源；是否保留 DPI 由此推导。 */
  readonly sourcePart?: string;
}

export type SlideSource = Omit<Slide, 'elements' | 'editInfo'>;
export type SlideOverrides = Omit<Partial<SlideSource>, 'animations'> & {
  /** 稳定元素身份只存在编辑模型；投影时才恢复易失的数值 spid。 */
  animations?: readonly EditAnimationStep[];
};

type BaseOverrideKey =
  | 'x' | 'y' | 'w' | 'h' | 'rot' | 'flipH' | 'flipV'
  | 'effects' | 'name' | 'scene3d';

export type LinkTarget = {
  readonly kind: 'external';
  readonly href: string;
} | {
  readonly kind: 'slide';
  readonly slideId: SlideId;
};

/** 相对放映动作没有稳定目标页；可展示和跟随，但不能冒充可编辑 LinkTarget。 */
export interface RelativeLinkSource {
  readonly kind: 'relative';
  readonly action: 'next' | 'previous' | 'first' | 'last';
}

export interface UnsupportedLinkSource {
  readonly kind: 'unsupported';
}

export type LinkSourceValue = LinkTarget | RelativeLinkSource | UnsupportedLinkSource;
export type LinkOverride = LinkTarget | { readonly kind: 'none' };

export interface ElementLinkState {
  readonly value: LinkSourceValue | null;
  readonly source: LinkSourceValue | null;
  readonly mixed: boolean;
  readonly sourceMixed: boolean;
  readonly direct: boolean;
  /** true 表示来源只能原样保留；设置新覆盖仍是显式、安全的替换。 */
  readonly sourceReadonly: boolean;
  readonly followable: boolean;
}

/**
 * 只允许覆盖可写字段。`path` / `clipPath` 是由 geom 与当前尺寸算出的派生值，
 * `id` / `editInfo` 则属于源文件身份，二者都不能进入覆盖层。
 */
export type ElementOverrides = Partial<Pick<ElementBase, BaseOverrideKey>> & {
  /** 缺少字段表示来源；none 表示明确移除，不能用 undefined 混淆二者。 */
  link?: LinkOverride;
  /** 显式无填充用 Fill.none；缺少该字段才表示恢复来源/主题。 */
  fill?: Exclude<Fill, { type: 'image' }>;
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

export interface ElementFillState {
  readonly value: Fill | null;
  readonly mixed: boolean;
  /** 任一目标存在直接覆盖时为 true；UI 可据此启用“恢复默认”。 */
  readonly direct: boolean;
}

export interface SlideBackgroundState {
  readonly value: Fill | null;
  readonly source: Fill | null;
  readonly mixed: boolean;
  readonly sourceMixed: boolean;
  readonly direct: boolean;
}

export interface SlideHiddenState {
  readonly value: boolean;
  readonly source: boolean;
  readonly mixed: boolean;
  readonly sourceMixed: boolean;
  readonly direct: boolean;
}

export interface SlideLayoutState {
  readonly value: string | null;
  readonly source: string | null;
  readonly mixed: boolean;
  readonly sourceMixed: boolean;
  readonly direct: boolean;
}

export interface SlideNotesState {
  readonly value: string;
  readonly source: string;
  readonly mixed: boolean;
  readonly sourceMixed: boolean;
  readonly direct: boolean;
}

export interface SlideTransitionState {
  readonly value: Transition | null;
  readonly source: Transition | null;
  readonly mixed: boolean;
  readonly sourceMixed: boolean;
  readonly direct: boolean;
}

interface EditAnimationBase {
  readonly target: ElementId;
  readonly trigger: 'click' | 'withPrev' | 'afterPrev';
  readonly delayMs: number;
  readonly durationMs: number;
}

export type EditAnimationStep = EditAnimationBase & ({
  readonly kind: 'entrance' | 'exit';
  readonly effect: Exclude<EntranceExitAnimationEffect, 'fly' | 'wipe' | 'zoom'>;
  readonly dir?: never;
  readonly motionPath?: never;
} | {
  readonly kind: 'entrance' | 'exit';
  readonly effect: 'fly' | 'wipe';
  readonly dir?: 'l' | 'r' | 'u' | 'd';
  readonly motionPath?: never;
} | {
  readonly kind: 'entrance' | 'exit';
  readonly effect: 'zoom';
  readonly dir?: 'in' | 'out';
  readonly motionPath?: never;
} | {
  readonly kind: 'emphasis';
  readonly effect: EmphasisAnimationEffect;
  readonly dir?: never;
  readonly motionPath?: never;
} | {
  readonly kind: 'motion';
  readonly effect?: never;
  readonly dir?: never;
  readonly motionPath: readonly (readonly [number, number])[];
});

export interface SlideAnimationState {
  readonly value: readonly EditAnimationStep[];
  readonly source: readonly EditAnimationStep[];
  readonly mixed: boolean;
  readonly sourceMixed: boolean;
  readonly direct: boolean;
  /** true 表示来源含不可稳定寻址或尚未开放的时间树节点；未触碰时仍会原样保留。 */
  readonly sourceReadonly: boolean;
}

export interface ElementStrokeState {
  readonly value: Stroke | null;
  readonly mixed: boolean;
  /** 任一目标存在直接覆盖时为 true；显式无描边同样属于直接覆盖。 */
  readonly direct: boolean;
}

export interface ElementEffectsState {
  readonly value: Effects;
  readonly mixed: boolean;
  /** 空对象也是直接效果：它用于屏蔽版式或主题继承。 */
  readonly direct: boolean;
}

export type ImageCrop = NonNullable<ImageElement['crop']>;

export interface ElementCropState {
  readonly value: ImageElement['crop'];
  readonly mixed: boolean;
  /** 全零裁剪仍是直接格式；只有 SetCrop(null) 才恢复来源。 */
  readonly direct: boolean;
}

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
  /** 只说明来源链接不可安全编辑，不携带原始 action 或危险 URL。 */
  readonly sourceLinkReadonly?: true;
}

export interface RunProperties {
  readonly font: string | null;
  readonly size: number;
  readonly color: string;
  readonly b: boolean;
  readonly i: boolean;
  readonly u: boolean;
  readonly strike: boolean;
}

export interface RunPropertyOverrides {
  readonly font?: string | null;
  readonly size?: number | null;
  readonly color?: string | null;
  readonly b?: boolean | null;
  readonly i?: boolean | null;
  readonly u?: boolean | null;
  readonly strike?: boolean | null;
  /** null 恢复来源；none 明确去掉选区链接。 */
  readonly link?: LinkOverride | null;
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
  readonly color: RunPropertyState<string>;
  readonly b: RunPropertyState<boolean>;
  readonly i: RunPropertyState<boolean>;
  readonly u: RunPropertyState<boolean>;
  readonly strike: RunPropertyState<boolean>;
}

export type RunLinkState = ElementLinkState;

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
  placeholderDirect?: PlaceholderDirectFlags;
  /** 旧版式解绑时需要固定的继承效果；普通未编辑投影仍沿用 core 既有语义。 */
  placeholderInheritedEffects?: Effects;
  origin?: { part: string; spid: number };
  locked?: boolean;
  /** 来源文件只禁止移动；与宿主设置的通用 locked 分开，避免误伤其他编辑。 */
  moveLocked?: boolean;
  /** 空文字形状的编辑格式入口；首次输入后由 flat override 接管。 */
  textTemplate?: TextBody;
  /** 会话中新建的元素没有保存基线宿主；撤销时不能把它误记成来源删除。 */
  created?: boolean;
  /** 新建普通形状的 p:style 使用主题引用；换母版时其有效默认值必须重新求值。 */
  themeDefaultShape?: true;
  /** 页眉页脚字段的内容属于页面，几何与空白格式仍来自当前版式。 */
  fieldPlaceholder?: true;
  /** 仅新建树根携带；保存从初始基线重建时据此重新插入宿主。 */
  insertion?: ElementInsertionSource;
  /** 只承载当前有效替换资源；历史中的旧闭包不会污染活跃 OPC 图。 */
  imageReplacement?: ElementImageReplacement;
  hiddenByUser?: boolean;
  editable: EditableKind;
  /** true 表示节点只来自母版/版式投影，不属于 slide XML 的可持久内容树。 */
  inherited?: true;
  /** 来源存在无法安全映射的链接；覆盖层缺失时查询为只读来源。 */
  sourceLinkReadonly?: true;
  /** 来源 XML 中的直属父级；结构编辑后保存层据此移动原宿主而不是克隆内容。 */
  sourceParent?: SlideId | ElementId;
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
  /** 删除树在来源 slide part 中占用的全部 spid；保存期用它清理 timing/build 悬空引用。 */
  sourceSpids?: readonly number[];
}

export interface SlideRecord {
  id: SlideId;
  src: SlideSource;
  ovr: SlideOverrides;
  /** 来源查询使用稳定元素身份；原始数值动画仍留在 src 供未触碰投影与字节直通。 */
  sourceAnimations?: readonly EditAnimationStep[];
  sourceAnimationsReadonly?: true;
  /** 大字节留在 imageResources；页面历史只持有这个关系闭包与哈希。 */
  backgroundImage?: SlideImageBackground;
  children: ElementId[];
  /** 页序变化时只需失效这些动态字段及祖先，避免把页尾全部元素推给视图订阅者。 */
  dynamicSlideNumbers: ElementId[];
  /** 相对页序动作或稳定 part 跳转；插页后由投影层重新解析目标序号。 */
  dynamicSlideLinks: ElementId[];
  origin: { part: string } | null;
  notes?: SlideNotesBinding;
  layoutId?: string;
  /** 首次打开或创建时的版式来源；layoutId 改变不应覆写这份查询/撤销基线。 */
  sourceLayoutId?: string;
  /** 解析期已确认背景来自 slide XML，而非旧版式的有效值。 */
  sourceDirectBackground?: true;
  /** 解析期已确认转场来自 slide XML。 */
  sourceDirectTransition?: true;
  /** 来源页面自身屏蔽母版图形；只换关系不能改变这一页级语义。 */
  sourceHideMasterShapes?: true;
  /** 仅会话中新页存在；保存层据此物化 OPC part 与 presentation 引用。 */
  creation?: SlideCreation;
  /** 解析期已在当前页主题/颜色映射上求值，新增形状无需理解 OOXML 主题。 */
  defaultShape?: ShapeCreationDefaults;
  /** 解析期已在当前页主题/默认表样式上求值，新增表格无需理解 OOXML 样式层。 */
  defaultTable?: TableCreationDefaults;
}

export interface SlideNotesBinding {
  readonly sourcePart?: string;
  readonly targetPart: string;
  readonly relationshipId: string;
}

export interface SlideCreation {
  readonly layoutPart: string;
  readonly layoutRelationshipId: string;
  /** 页面副本从该不可变来源 part 起步；副本链在命令期展平，避免保存依赖页序。 */
  readonly duplicateSourcePart?: string;
  /** 副本链展平到最初 notes 基线，目标 notes 因而不依赖中间副本是否已物化。 */
  readonly duplicateNotesSourcePart?: string;
  readonly duplicateNotesPart?: string;
  /** 来源基线中已在复制时删除的宿主；新增宿主仍由 insertion 的存活树决定。 */
  readonly duplicateRemovedSpids?: readonly number[];
  /** 结构删除只需根 spid；动画引用还可能指向已随组删除的后代。 */
  readonly duplicateRemovedAnimationSpids?: readonly number[];
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
  /** 四项均惰性初始化，未使用新增/复制页能力时不扫描任何保存期身份。 */
  nextSlidePart?: number;
  nextNotesPart?: number;
  nextPresentationSlideId?: number;
  nextPresentationRelationship?: number;
}

/** 只保存首次触碰的 XML part；必须随文档 structuredClone 才能在 Worker 中正确撤销后保存。 */
export interface EditSaveState {
  baselines: Record<string, Uint8Array>;
  createdParts: string[];
  /** 首次打开时的页 part 顺序；用 O(n) 纯数据比较识别页序编辑，不让普通保存解析 presentation.xml。 */
  sourceSlideParts: string[];
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
  /** 会话图片按内容寻址；未被当前元素引用的条目仍可供历史逆向 Patch 恢复。 */
  imageResources: Record<string, ElementInsertionResource>;
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
