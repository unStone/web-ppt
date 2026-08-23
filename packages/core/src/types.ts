/**
 * 内部统一 Schema：所有格式（.pptx / .ppt）解析后归一到这里，渲染层只依赖本文件。
 * 长度单位一律为 CSS px（EMU / 9525），角度为度。
 * 注意：新增能力一律用可选字段，保证已有生产者（如图表模块）无需同步改动。
 */

import type { GeomSpec } from './geometry';

export interface Presentation {
  width: number;
  height: number;
  slides: Slide[];
  source: 'pptx' | 'ppt';
  /** 嵌入字体：字体名 → @font-face src（blob URL） */
  embeddedFonts?: EmbeddedFont[];
  /**
   * 释放本次解析创建的所有 blob URL。
   * 不再需要这份演示文稿时调用；大文件（数十 MB 图片）不释放会一直占着内存。
   * 调用后依赖这些 URL 的已渲染 SVG 将无法显示图片。
   */
  dispose?: () => void;
  /**
   * 原始 OOXML 包；仅 `parse(..., { keepPackage: true })` 时存在。
   * 编辑器保存需要原始 ZIP 字节与解压 part；调用 `dispose()` 后句柄会变为空并标记已释放。
   */
  package?: OpcPackage;
  /** 节（p14:sectionLst），供缩略图分组 */
  sections?: Section[];
}

/** 编辑写回使用的只读 OPC 包句柄。字节视为只读，修改它们属于未定义行为。 */
export interface OpcPackage {
  readonly format: 'pptx';
  /** 原始 ZIP 字节的零拷贝只读视图；`dispose()` 前调用方不得修改，释放后为空数组 */
  readonly bytes: Uint8Array;
  /** 解压后的包内 part，key 是不带前导 `/` 的 OPC 路径 */
  readonly parts: Readonly<Record<string, Uint8Array>>;
  readonly disposed: boolean;
}

/** 演示文稿的「节」 */
export interface Section {
  name: string;
  /** p:sldId@id 列表（与 presentation.xml 的 sldIdLst 对应） */
  slideIds: number[];
  /** 对应的页序号（0 基），缺失的 id 会被跳过 */
  slideIndexes?: number[];
}

export interface EmbeddedFont {
  family: string;
  src: string;
  bold: boolean;
  italic: boolean;
}

export interface Slide {
  background: Fill | null;
  elements: SlideElement[];
  /** 演讲者备注纯文本 */
  notes?: string;
  /** 幻灯片是否被隐藏 */
  hidden?: boolean;
  /** 版式名，用于调试与缩略图分组 */
  layoutName?: string;
  /** 切换效果 */
  transition?: Transition;
  /** 元素动画，按点击分组后由查看器逐步播放 */
  animations?: AnimStep[];
  /** 批注（ppt/comments/*.xml），默认不渲染，由 RenderOptions 开关控制 */
  comments?: SlideComment[];
  /** 仅 `parse(..., { edit: true })` 时存在，不参与渲染 */
  editInfo?: SlideEditInfo;
}

export interface SlideEditInfo {
  origin: { part: string };
}

/** 幻灯片批注 */
export interface SlideComment {
  author: string;
  /** 作者缩写 */
  initials?: string;
  /** 原始时间字符串（ISO 8601） */
  date?: string;
  text: string;
  /** 锚点坐标（px，幻灯片坐标系） */
  x: number;
  y: number;
  /** 批注序号（p:cm@idx） */
  idx?: number;
}

export type TransitionType =
  // ECMA-376 原生
  | 'none' | 'fade' | 'cut' | 'push' | 'pull' | 'cover' | 'wipe' | 'split' | 'zoom'
  | 'dissolve' | 'checker' | 'blinds' | 'comb' | 'wheel' | 'circle' | 'diamond'
  | 'plus' | 'wedge' | 'newsflash' | 'randomBar' | 'strips'
  // PowerPoint 2010+ 扩展（p14 命名空间，共 19 种）
  | 'vortex' | 'switch' | 'flip' | 'ripple' | 'honeycomb' | 'glitter' | 'warp'
  | 'flythrough' | 'flash' | 'shred' | 'reveal' | 'wheelReverse' | 'ferris'
  | 'gallery' | 'conveyor' | 'pan' | 'doors' | 'window' | 'prism'
  // PowerPoint 2016+ 平滑变体（p159 命名空间）
  | 'morph';

export interface Transition {
  type: TransitionType;
  /** 方向：l/r/u/d/horz/vert/in/out，具体含义随 type 而定 */
  dir?: string;
  durationMs: number;
  /** 自动换片延迟（毫秒）；缺省表示需要手动触发 */
  advanceAfterMs?: number;
  /** morph 的粒度（p159:morph@option）；按字/词拆分我们不做，一律按对象处理 */
  morphBy?: 'byObject' | 'byWord' | 'byChar';
}

export type AnimEffect =
  | 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'split' | 'wheel' | 'blinds'
  | 'grow' | 'spin' | 'float' | 'bounce' | 'dissolve' | 'stretch' | 'swivel' | 'random';

export interface AnimStep {
  /** 目标元素 id（对应 SlideElement.id） */
  target: number;
  effect: AnimEffect;
  dir?: string;
  delayMs: number;
  durationMs: number;
  /** 与前一步的时序关系 */
  trigger: 'click' | 'withPrev' | 'afterPrev';
  /** 动画类别 */
  kind: 'entrance' | 'exit' | 'emphasis' | 'motion';
  /**
   * 运动路径采样点：相对元素起始位置的位移（px），首点恒为 (0,0)。
   * 在 core 里按弧长等距重采样，播放层直接当关键帧用——
   * 采样放在这边是因为它是纯数学，能在 Node 里测，也不必让播放层依赖 SVG 测长 API。
   */
  motionPath?: [number, number][];
  /** 由查看器计算：属于第几个点击批次 */
  clickGroup?: number;
}

export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; angle: number; stops: GradientStop[]; radial?: boolean }
  | { type: 'image'; src: string; tile?: ImageTile; alpha?: number; crop?: { l: number; t: number; r: number; b: number } }
  | { type: 'pattern'; fg: string; bg: string; preset: string }
  | { type: 'none' };

export interface ImageTile {
  sx: number;
  sy: number;
  flip: string;
}

export interface GradientStop {
  /** 0-1 */
  pos: number;
  color: string;
}

export type LineEndType = 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';

export interface LineEnd {
  type: LineEndType;
  /** 相对线宽的倍数 */
  w: number;
  h: number;
}

export interface Stroke {
  color: string;
  width: number;
  dash: number[] | null;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  head?: LineEnd;
  tail?: LineEnd;
  /** 复合线型（双线等）暂只用于标记 */
  compound?: string;
}

/** 立体效果（scene3d / sp3d）。做等轴测风格的近似，不做真实三维投影。 */
export interface Shape3D {
  /** 挤出深度 px */
  extrusion?: number;
  /** 挤出面颜色 */
  extrusionColor?: string;
  /** 顶部斜角高度 px */
  bevelTop?: number;
  /** 底部斜角高度 px */
  bevelBottom?: number;
  /** 轮廓线宽 px */
  contourWidth?: number;
  contourColor?: string;
  /** 材质预设名，用于选择高光强度 */
  material?: string;
  /** 场景绕 X / Y 轴的旋转角度（度），用于决定挤出方向 */
  rotX?: number;
  rotY?: number;
}

export interface Effects {
  shadow?: {
    dx: number;
    dy: number;
    blur: number;
    color: string;
    /** 内阴影 */
    inner?: boolean;
  };
  glow?: { radius: number; color: string };
  softEdge?: number;
  reflection?: { alpha: number; size: number; distance: number };
}

export interface ElementBase {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
  effects?: Effects;
  /** 超链接目标（外部 URL 或 slide:<index>） */
  link?: string;
  /** 无障碍/调试用名称 */
  name?: string;
  /** 形状 id（来自 cNvPr@id），动画以此定位目标 */
  id?: number;
  /** 仅 `parse(..., { edit: true })` 时存在，不参与渲染 */
  editInfo?: ElementEditInfo;
  /** 立体效果 */
  scene3d?: Shape3D;
}

export interface ElementEditInfo {
  /** OOXML 回写锚点；畸形节点缺少 cNvPr@id 时可能不存在 */
  origin?: { part: string; spid: number };
  /** 占位符身份；type 是 ECMA-376 默认值展开后的语义值 */
  placeholder?: { type: string; idx?: string };
  /** 预设形状的可重算语义；继承自版式/母版时也保留，只在编辑解析中存在 */
  geom?: GeomSpec;
  /** 内部内容不可安全写回时只允许框架级变换；省略表示由元素类型推断为 full */
  editable?: 'full' | 'frame' | 'none';
}

export type SlideElement =
  | ShapeElement
  | ImageElement
  | GroupElement
  | TableElement
  | UnsupportedElement;

export interface ShapeElement extends ElementBase {
  kind: 'shape';
  /** SVG path d（局部坐标 0,0-w,h）；null 表示纯文本框，无可见几何 */
  path: string | null;
  fill: Fill | null;
  stroke: Stroke | null;
  text: TextBody | null;
  /** 开放路径：只描边不填充 */
  openGeom?: boolean;
}

/** 媒体对象（音频 / 视频）：封面帧走 ImageElement.src，本字段记录可播放的源 */
export interface MediaInfo {
  kind: 'audio' | 'video';
  /** 媒体地址：包内资源为 blob URL，外链为原始 URL；解析不到时为 null */
  src: string | null;
  /** 来自 r:link 的外部链接 */
  external?: boolean;
  /** 媒体 MIME，便于将来交给 <video>/<audio> */
  mime?: string;
}

export interface ImageElement extends ElementBase {
  kind: 'image';
  /** 图片地址；媒体对象无封面帧时可能为空串 */
  src: string;
  /** 裁剪比例 0-1，来自 srcRect */
  crop: { l: number; t: number; r: number; b: number } | null;
  /** 图片被裁剪进的形状轮廓（局部坐标 path） */
  clipPath?: string | null;
  /** 0-1，来自 alphaModFix */
  alpha?: number;
  /** CSS filter，用于 duotone / 灰度 / 亮度对比度 */
  filter?: string;
  stroke?: Stroke | null;
  /** 音视频对象：渲染封面帧 + 播放标识 */
  media?: MediaInfo;
}

export interface GroupElement extends ElementBase {
  kind: 'group';
  /** 子坐标系原点与缩放：child 坐标先减 (childX,childY) 再乘 scale */
  childX: number;
  childY: number;
  scaleX: number;
  scaleY: number;
  children: SlideElement[];
}

export interface TableElement extends ElementBase {
  kind: 'table';
  colWidths: number[];
  rows: TableRow[];
}

export interface TableRow {
  height: number;
  cells: TableCell[];
}

export interface CellBorders {
  l?: Stroke | null;
  r?: Stroke | null;
  t?: Stroke | null;
  b?: Stroke | null;
}

export interface TableCell {
  colSpan: number;
  rowSpan: number;
  /** 被合并覆盖的占位格，不渲染 */
  merged: boolean;
  fill: Fill | null;
  text: TextBody | null;
  borders?: CellBorders;
  /** [上,右,下,左] px */
  margins?: [number, number, number, number];
  vAlign?: 'top' | 'middle' | 'bottom';
  /** 竖排文字方向 */
  vert?: TextVert;
}

export interface UnsupportedElement extends ElementBase {
  kind: 'unsupported';
  label: string;
}

export type TextVert = 'horz' | 'vert' | 'vert270' | 'wordArtVert';

export interface TextBody {
  anchor: 'top' | 'middle' | 'bottom';
  /** [上, 右, 下, 左] */
  insets: [number, number, number, number];
  wrap: boolean;
  /** normAutofit 字号缩放，1 = 不缩放 */
  fontScale: number;
  /**
   * 有 normAutofit 但文件里没写 fontScale —— 缩放比例要由渲染器自己算。
   * PowerPoint 只在自己排过版后才写回该属性，实测真实文件里缺失的占多数。
   */
  autoFitCompute?: boolean;
  paragraphs: Paragraph[];
  /** normAutofit 行距压缩，0-1 */
  lnSpcReduction?: number;
  /** 竖排 */
  vert?: TextVert;
  /** 水平居中（anchorCtr） */
  anchorCtr?: boolean;
  /** spAutoFit：形状随文字增高（渲染时允许溢出） */
  autoFitShape?: boolean;
  /** 分栏 */
  columns?: number;
  columnGap?: number;
  /** 艺术字变形（bodyPr/prstTxWarp）；adj 为 avLst 里的 gd 名 → 数值 */
  warp?: TextWarp;
}

export interface TextWarp {
  /** 预设名，如 textArchUp / textWave1 */
  preset: string;
  /** avLst：adj / adj1 / adj2 → 原始数值（角度为 1/60000 度，比例为 1/100000） */
  adj: Record<string, number>;
}

export interface Paragraph {
  align: 'left' | 'center' | 'right' | 'justify';
  lvl: number;
  marL: number;
  indent: number;
  bullet: string | null;
  /** 行高倍数；null 用默认 */
  lineHeight: number | null;
  spaceBefore: number;
  spaceAfter: number;
  runs: TextRun[];
  /** 项目符号独立样式 */
  bulletColor?: string | null;
  bulletFont?: string | null;
  /** 相对首个 run 字号的比例 */
  bulletSize?: number | null;
  /** 图片项目符号 */
  bulletImage?: string | null;
  /** 从右到左 */
  rtl?: boolean;
}

/**
 * 数学公式树 —— 与文件格式无关，OMML 与将来的 MathML 都归一到这里。
 * 渲染层据此做排版（需要文本测量，所以排版在渲染层而非解析层）。
 */
export type MathNode =
  /** 普通文本；sty 决定字形，变量默认斜体是数学排版的惯例 */
  | { kind: 'run'; text: string; sty?: 'p' | 'i' | 'b' | 'bi' }
  /** 分式；bar=带横线，lin=写成 a/b，noBar=上下堆叠无线，skw=斜杠 */
  | { kind: 'frac'; num: MathNode[]; den: MathNode[]; type?: 'bar' | 'noBar' | 'skw' | 'lin' }
  /** 根式；deg 为空表示平方根 */
  | { kind: 'rad'; deg: MathNode[]; base: MathNode[] }
  /** 上标 / 下标 / 上下标 */
  | { kind: 'script'; base: MathNode[]; sup?: MathNode[]; sub?: MathNode[] }
  /** 大算符（∑ ∏ ∫ …）；limLoc 决定上下限在正上下还是右侧 */
  | { kind: 'nary'; chr: string; sub: MathNode[]; sup: MathNode[]; base: MathNode[]; underOver: boolean }
  /** 括号组；sep 为多参数之间的分隔符 */
  | { kind: 'delim'; beg: string; end: string; sep: string; items: MathNode[][] }
  /** 矩阵 */
  | { kind: 'matrix'; rows: MathNode[][][] }
  /** 重音符（帽 / 波浪 / 矢量 …）与上下划线 */
  | { kind: 'acc'; chr: string; base: MathNode[]; below?: boolean }
  /** 上下限（lim / max 之类），pos 表示极限在下还是在上 */
  | { kind: 'lim'; base: MathNode[]; limit: MathNode[]; below: boolean }
  /** 多行公式组 */
  | { kind: 'stack'; rows: MathNode[][] };

export interface TextRun {
  text: string;
  b: boolean;
  i: boolean;
  u: boolean;
  strike: boolean;
  /** px */
  size: number;
  color: string;
  fonts: string[];
  /** 上下标：正数上标、负数下标（百分比） */
  baseline?: number;
  /** 字间距 px */
  spacing?: number;
  /** 全大写 / 小型大写 */
  caps?: 'none' | 'all' | 'small';
  /** 文字描边 */
  outline?: { color: string; width: number } | null;
  /** 渐变文字：CSS background-image 值 */
  gradient?: string | null;
  /** 超链接 */
  link?: string;
  /** 文字高亮底色 */
  highlight?: string | null;
  underlineColor?: string | null;
  /** 文字阴影（CSS text-shadow） */
  shadow?: string | null;
  /**
   * 数学公式。非空时本 run 是一个不可断行的公式块，`text` 退化为线性文本，
   * 仅用于搜索与导出纯文本，渲染一律走公式树。
   */
  math?: MathNode[];
}
