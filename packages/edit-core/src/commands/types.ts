import type { Effects, Fill, GeomSpec, SlideElement, Stroke } from '@web-ppt/core';
import type {
  EditableKind, ElementId, ElementImageReplacement, ElementInsertionResource, ElementRecord, ImageCrop, LinkOverride, LinkTarget, ParagraphPropertyOverrides, ProjectionInvalidation,
  RunPropertyOverrides, SlideId, TextFragment, TextOverride,
  SlideRecord, TableCellAddress, TextBodyPropertyOverrides,
} from '../types';
import type { AffineMatrix } from '../space';

export type NumericXfrmField = 'x' | 'y' | 'w' | 'h' | 'rot';
export type FlipField = 'flipH' | 'flipV';
export type XfrmField = NumericXfrmField | FlipField;
export interface XfrmValueByField {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}
export type ElementXfrmPath<F extends XfrmField = XfrmField> =
  readonly ['elements', ElementId, 'ovr', F];

export interface SetXfrmCommand {
  readonly type: 'SetXfrm';
  readonly id: ElementId;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly rot?: number;
}

export interface SetFlipCommand {
  readonly type: 'SetFlip';
  readonly id: ElementId;
  readonly h?: boolean;
  readonly v?: boolean;
}

export interface RemoveElementCommand {
  readonly type: 'RemoveElement';
  readonly id: ElementId;
}

export type ElementLayerTarget = 'front' | 'back' | 'forward' | 'backward';

export interface SetZCommand {
  readonly type: 'SetZ';
  readonly id: ElementId;
  readonly to: ElementLayerTarget;
}

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface AlignElementsCommand {
  readonly type: 'AlignElements';
  readonly ids: readonly ElementId[];
  readonly edge: AlignEdge;
}

export interface ElementClipboardRecordMeta {
  /** 同一次复制操作的来源证明；粘贴时用来拒绝拼接多个来源的伪造树。 */
  readonly copyBatchId: string;
  readonly editable: EditableKind;
  readonly anchored: boolean;
  readonly sourceSpid?: number;
  readonly geom?: GeomSpec;
  /** 复制时根元素的 frame → slide 视觉矩阵；后代不需要重复携带。 */
  readonly frameToSlide?: AffineMatrix;
  readonly link?: ClipboardPortableLink;
  readonly textLinks?: readonly ClipboardTextLink[];
}

export type ClipboardPortableLink = {
  readonly kind: 'external';
  readonly href: string;
} | {
  readonly kind: 'slide';
  readonly sourceSlideId: SlideId;
  readonly packageTarget?: { readonly rootHash: string; readonly closureHash: string };
} | {
  readonly kind: 'none';
} | {
  readonly kind: 'unsupported';
} | {
  readonly kind: 'relative';
  readonly action: 'next' | 'previous' | 'first' | 'last';
};

export interface ClipboardTextLink {
  readonly paragraph: number;
  readonly run: number;
  readonly cell?: TableCellAddress;
  readonly value: ClipboardPortableLink;
}

export interface ClipboardXmlRoot {
  readonly markup: string;
  readonly namespaces: Readonly<Record<string, string>>;
  readonly hostSpids: readonly string[];
  readonly relationships?: readonly ClipboardRelationship[];
}

export interface ClipboardRelationship {
  /** 宿主片段中原始的 r:id / r:embed / r:link 值。 */
  readonly sourceId: string;
  readonly type: string;
  readonly target?: string;
  readonly targetMode?: 'External';
  readonly resourceHash?: string;
  /** 复杂 OOXML 对象只在目标包拥有同一闭包时复用，不把未知格式静默扁平化。 */
  readonly packageTarget?: {
    /** 根内容与关系图都不包含 part 路径，目标包据此重新定位等价闭包。 */
    readonly rootHash: string;
    readonly closureHash: string;
  };
}

export interface ClipboardElementRecord {
  readonly id: string;
  readonly parent: string | null;
  readonly src: SlideElement;
  readonly meta: ElementClipboardRecordMeta;
  readonly children: readonly string[];
}

export interface ClipboardResource {
  readonly hash: string;
  readonly mime: string;
  readonly extension: string;
  readonly bytes: string;
}

export interface ElementClipboardPayload {
  readonly format: 'web-ppt-elements';
  readonly version: 1;
  readonly source: { readonly width: number; readonly height: number; readonly copyBatchId: string };
  readonly bounds: { readonly left: number; readonly top: number };
  readonly roots: readonly string[];
  readonly records: Readonly<Record<string, ClipboardElementRecord>>;
  readonly ooxml: { readonly roots: Readonly<Record<string, ClipboardXmlRoot>> };
  readonly resources: readonly ClipboardResource[];
}

export interface PasteElementsCommand {
  readonly type: 'PasteElements';
  readonly payload: ElementClipboardPayload;
  readonly at: { readonly parentId: SlideId | ElementId; readonly x: number; readonly y: number };
}

export interface AddShapeCommand {
  readonly type: 'AddShape';
  readonly slideId: SlideId;
  readonly preset: string;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface AddImageCommand {
  readonly type: 'AddImage';
  readonly slideId: SlideId;
  /** 空图片占位符可由同一历史单元原子替换。 */
  readonly placeholderId?: ElementId;
  readonly bytes: Uint8Array;
  readonly mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface ReplaceImageCommand {
  readonly type: 'ReplaceImage';
  readonly id: ElementId;
  readonly bytes: Uint8Array;
  readonly mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

export interface SetCropCommand {
  readonly type: 'SetCrop';
  readonly id: ElementId;
  /** null 恢复来源；全零对象明确写出不裁剪。 */
  readonly crop: ImageCrop | null;
}

export interface AddTableCommand {
  readonly type: 'AddTable';
  readonly slideId: SlideId;
  readonly rows: number;
  readonly cols: number;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 空内容占位符可由同一历史单元原子替换。 */
  readonly placeholderId?: ElementId;
}

export interface AddSlideCommand {
  readonly type: 'AddSlide';
  readonly layoutId: string;
  /** null 表示插入到第一位；稳定页身份比瞬时数组下标更适合框架与协同边界。 */
  readonly at: { readonly after: SlideId | null };
}

export interface MoveSlideCommand {
  readonly type: 'MoveSlide';
  readonly id: SlideId;
  /** null 表示置首；稳定身份锚点避免页下标在插入后漂移。 */
  readonly at: { readonly after: SlideId | null };
}

export interface RemoveSlideCommand {
  readonly type: 'RemoveSlide';
  readonly id: SlideId;
}

export interface DuplicateSlideCommand {
  readonly type: 'DuplicateSlide';
  readonly id: SlideId;
}

export interface SetFillCommand {
  readonly type: 'SetFill';
  readonly id: ElementId;
  /** null 删除直接覆盖；显式无填充使用 { type: 'none' }。 */
  readonly fill: Exclude<Fill, { type: 'image' }> | null;
}

export interface SetStrokeCommand {
  readonly type: 'SetStroke';
  readonly id: ElementId;
  /** null 恢复来源；{type:'none'} 形成显式无描边。 */
  readonly stroke: Stroke | { readonly type: 'none' } | null;
}

export interface SetEffectsCommand {
  readonly type: 'SetEffects';
  readonly id: ElementId;
  /** null 恢复继承；空对象明确写出无效果。 */
  readonly effects: Effects | null;
}

export interface SetLinkCommand {
  readonly type: 'SetLink';
  readonly id: ElementId;
  /** null 恢复来源；{kind:'none'} 明确移除当前元素链接。 */
  readonly target: LinkTarget | { readonly kind: 'none' } | null;
}

export type TextEditOp = {
  readonly type: 'replace';
  readonly from: TextPosition;
  readonly to: TextPosition;
  readonly text: string;
} | {
  readonly type: 'splitParagraph';
  readonly at: TextPosition;
} | {
  readonly type: 'insertLineBreak';
  readonly at: TextPosition;
} | {
  readonly type: 'replaceFragment';
  readonly from: TextPosition;
  readonly to: TextPosition;
  readonly fragment: TextFragment;
};

export interface EditTextCommand {
  readonly type: 'EditText';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  /** 操作按数组顺序作用于前一个操作的结果，便于 beforeinput 批量提交。 */
  readonly ops: readonly TextEditOp[];
}

export interface TextRange {
  readonly from: TextPosition;
  readonly to: TextPosition;
}

export interface SetRunPropsCommand {
  readonly type: 'SetRunProps';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
  readonly props: RunPropertyOverrides;
}

export interface SetParaPropsCommand {
  readonly type: 'SetParaProps';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
  readonly props: ParagraphPropertyOverrides;
}

export interface FitTextShapeCommand {
  readonly type: 'FitTextShape';
  readonly id: ElementId;
}

export interface SetBodyPropsCommand {
  readonly type: 'SetBodyProps';
  readonly id: ElementId;
  readonly props: TextBodyPropertyOverrides;
}

/** 当前公开语义是尾部追加；指定位置插行要先解决纵向合并与坐标重基。 */
export interface InsertRowCommand {
  readonly type: 'InsertRow';
  readonly id: ElementId;
}

export type Command = SetXfrmCommand | SetFlipCommand | RemoveElementCommand | SetZCommand
  | AlignElementsCommand | PasteElementsCommand | AddShapeCommand | AddImageCommand | ReplaceImageCommand | SetCropCommand | AddTableCommand | AddSlideCommand | MoveSlideCommand | RemoveSlideCommand | DuplicateSlideCommand | EditTextCommand | SetRunPropsCommand | SetParaPropsCommand
  | FitTextShapeCommand | SetBodyPropsCommand | InsertRowCommand | SetFillCommand | SetStrokeCommand
  | SetEffectsCommand | SetLinkCommand;

type SetXfrmPatch = { [F in XfrmField]: {
  readonly op: 'set';
  readonly path: ElementXfrmPath<F>;
  readonly value: XfrmValueByField[F];
  readonly origin: string;
} }[XfrmField];
type DeleteXfrmPatch = { [F in XfrmField]: {
  readonly op: 'del';
  readonly path: ElementXfrmPath<F>;
  readonly origin: string;
} }[XfrmField];
export type ElementTransformPatch = SetXfrmPatch | DeleteXfrmPatch;

export type ElementFillPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'fill'];
  readonly value: Exclude<Fill, { type: 'image' }>;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'fill'];
  readonly origin: string;
};

export type ElementStrokePatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'stroke'];
  readonly value: Stroke | null;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'stroke'];
  readonly origin: string;
};

export type ElementEffectsPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'effects'];
  readonly value: Effects;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'effects'];
  readonly origin: string;
};

export type ElementLinkPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'link'];
  readonly value: LinkOverride;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'link'];
  readonly origin: string;
};

export type ElementCropPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'crop'];
  readonly value: ImageCrop;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'crop'];
  readonly origin: string;
};

export type ElementImageReplacementPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'meta', 'imageReplacement'];
  readonly value: ElementImageReplacement;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'meta', 'imageReplacement'];
  readonly origin: string;
};

export type ImageResourcePatch = {
  readonly op: 'set';
  readonly path: readonly ['imageResources', string];
  readonly value: ElementInsertionResource;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['imageResources', string];
  readonly origin: string;
};

export type ElementTextPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'text'];
  readonly value: TextOverride;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'text'];
  readonly origin: string;
} | {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableCells', import('../types').TableCellRowRef, number, 'text'];
  readonly value: TextOverride;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableCells', import('../types').TableCellRowRef, number, 'text'];
  readonly origin: string;
};

export type ElementOrderPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'order'];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'order'];
  readonly origin: string;
};

export interface ElementTreeSnapshot {
  readonly root: ElementId;
  readonly parent: SlideId | ElementId;
  readonly records: Readonly<Record<ElementId, ElementRecord>>;
}

export type ElementTreePatch = {
  readonly op: 'remove' | 'insert';
  readonly path: readonly ['elements', ElementId];
  readonly value: ElementTreeSnapshot;
  readonly origin: string;
};

export interface SlideTreeSnapshot {
  readonly slide: SlideRecord;
  readonly after: SlideId | null;
  /** 删除视图优先切到原后继；插入 patch 不依赖它定位。 */
  readonly before: SlideId | null;
  readonly records: Readonly<Record<ElementId, ElementRecord>>;
}

export type SlideTreePatch = {
  readonly op: 'remove' | 'insert';
  readonly path: readonly ['slides', SlideId];
  readonly value: SlideTreeSnapshot;
  readonly origin: string;
};

export type SlideOrderPatch = {
  readonly op: 'move';
  readonly path: readonly ['slideOrder', SlideId];
  readonly value: { readonly after: SlideId | null };
  readonly origin: string;
};

export type TableRowPatch = {
  readonly op: 'insert' | 'remove';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableRows', string];
  readonly value: import('../types').TableRowInsertion;
  readonly origin: string;
};

export type Patch = ElementTransformPatch | ElementFillPatch | ElementStrokePatch | ElementEffectsPatch | ElementLinkPatch | ElementCropPatch | ElementImageReplacementPatch | ImageResourcePatch | ElementTextPatch | ElementOrderPatch
  | ElementTreePatch | SlideTreePatch | SlideOrderPatch | TableRowPatch;

export interface CommandPatches {
  readonly forward: Patch[];
  readonly inverse: Patch[];
}

export interface TextPosition {
  readonly p: number;
  readonly r: number;
  readonly off: number;
}

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'elements'; readonly ids: readonly ElementId[]; readonly enteredGroup: ElementId | null }
  | { readonly kind: 'text'; readonly id: ElementId; readonly cell?: TableCellAddress; readonly anchor: TextPosition; readonly focus: TextPosition }
  | { readonly kind: 'table'; readonly id: ElementId; readonly cells: readonly { r: number; c: number }[] };

export interface HistoryEntry extends CommandPatches {
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  readonly label: string;
  readonly time: number;
  readonly mergeKey?: string;
  readonly affectedSlides: readonly SlideId[];
}

export interface History {
  readonly undoCount: number;
  readonly redoCount: number;
  readonly byteSize: number;
  readonly undoEntries: readonly HistoryEntry[];
  readonly redoEntries: readonly HistoryEntry[];
  clear(): void;
}

export interface SlideChangeSets {
  readonly createdSlides: Set<SlideId>;
  readonly removedSlides: Set<SlideId>;
  readonly movedSlides: Set<SlideId>;
  readonly removedSlideFallbacks: Map<SlideId, SlideId>;
}

export interface TransactionResult extends ProjectionInvalidation, CommandPatches, SlideChangeSets {
  readonly selection: Selection;
}

export interface EditorChange extends ProjectionInvalidation, SlideChangeSets {
  readonly source: 'transaction' | 'undo' | 'redo' | 'selection';
  readonly selection: Selection;
  /** dirtyElements 含投影缓存祖先；DOM 增量分区必须以真正被 patch 的元素为准。 */
  readonly touchedElements: Set<ElementId>;
  /** 需要重新生成 markup/defs 的元素；纯层级 patch 不进入这里。 */
  readonly renderElements: Set<ElementId>;
  /** bodyPr 有效值变化；活动文字面必须同步刷新被延迟的静态分区。 */
  readonly bodyPropsElements: Set<ElementId>;
  /** 只需移动既有 DOM 分区的元素；可与 renderElements 重叠。 */
  readonly reorderedElements: Set<ElementId>;
}

export type EditorSubscriber = (change: EditorChange) => void;

export interface Transaction {
  exec(...commands: Command[]): void;
  select(selection: Selection): void;
}

export interface TransactionOptions {
  readonly origin?: string;
  readonly recordHistory?: boolean;
  readonly mergeKey?: string;
  readonly time?: number;
}

export interface EditorOptions {
  readonly origin?: string;
  readonly historyLimit?: number;
  readonly historyByteLimit?: number;
}
