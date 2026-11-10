/**
 * .ppt 图形树：PPDrawing → DgContainer → SpgrContainer / SpContainer → 统一 Schema 元素。
 * 组、表格还原、锚点换算与形状级超链接都在这一层完成。
 */
import type { ElementBase, Fill, GroupElement, ImageElement, ShapeElement, SlideElement } from '../types';
import { presetGeom } from '../geometry';
import type { AutoNum } from './autonum';
import {
  ESCHER,
  EscherProps,
  MSO_SHAPE,
  P,
  Scheme,
  SP_FLAG,
  complexString,
  isTableGroup,
  MSO_PICTURE_FRAME,
  parseOpt,
  readAnchor,
  readChildAnchor,
  readSp,
  readSpgr,
  shapeCrop,
  shapeFill,
  shapeShadow,
  shapeStroke,
  tableRowHeights,
} from './escher';
import { ansi, findAll, findRec, Rec, records, RT, utf16 } from './records';
import { customPath } from './custom-path';
import {
  buildTextBody,
  LevelStyle,
  LinkRange,
  MasterStyles,
  ParaProps,
  PH_TEXT_TYPE,
  parseStyleTextProp,
  StyledText,
  TextEnv,
  TextRunProps,
  TX,
} from './text';
import { buildTable, looksLikeGrid, mergeCellLayers } from './table';

// ---------------- 幻灯片解析 ----------------

/** 组内坐标 → 绝对坐标的映射基准 */
interface Origin {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

export interface Ctx {
  dv: DataView;
  scheme: Scheme;
  fonts: string[];
  blobs: (string | null)[];
  /** SlideListWithText 中按 lTxid 索引的文本 */
  listText: StyledText[];
  scale: number;
  /** 母版逐级文本样式（TextTypeEnum → 各级），以及全局环境兜底 */
  styles: MasterStyles;
  envStyles: MasterStyles;
  /** ExHyperlink id → 链接目标（已归一为 URL 或 slide:<n>） */
  links: Map<number, string>;
  /** 当前页序号（1 起）与总页数，用于解析「下一页 / 末页」这类跳转 */
  slideIndex: number;
  slideCount: number;
  /** 解析母版图形时为 true：跳过占位符形状，只保留装饰图形 */
  masterPass: boolean;
  levelCache: Map<string, LevelStyle>;
  /** ___PPT9 里的逐段自动编号，与游标一起按文本对象顺序认领 */
  autoNums: (AutoNum | null)[];
  autoNumCursor: number;
  /** 只在编辑入口保留格式无关的预设几何语义；旧格式没有 OOXML 回写锚点 */
  edit: boolean;
}

/**
 * ___PPT9 的自动编号块没写明属于哪个文本对象，只能按「段数吻合」认领：
 * 从游标处切出与本文本对象段数相同的一段，其中确实含编号才算命中并推进游标。
 * 认不出来就当没有，绝不硬套到别的文本上。
 */
function claimAutoNums(ctx: Ctx, paraCount: number): (AutoNum | null)[] | undefined {
  const from = ctx.autoNumCursor;
  if (paraCount <= 0 || from + paraCount > ctx.autoNums.length) return undefined;
  const slice = ctx.autoNums.slice(from, from + paraCount);
  if (!slice.some((a) => a !== null)) return undefined;
  ctx.autoNumCursor = from + paraCount;
  return slice;
}

/**
 * 母版文本样式解析：优先本类型，其次母版的 other，最后是 Environment 里的全局默认。
 * 越靠前的越具体，用对象展开做「后写覆盖」即可得到合并结果。
 */
function levelStyleOf(ctx: Ctx, textType: number, lvl: number): LevelStyle {
  const key = `${textType}:${lvl}`;
  const hit = ctx.levelCache.get(key);
  if (hit) return hit;
  const pick = (styles: MasterStyles, type: number): LevelStyle | undefined => {
    const list = styles.get(type);
    if (!list || !list.length) return undefined;
    return list[Math.min(lvl, list.length - 1)];
  };
  const chain = [pick(ctx.envStyles, TX.OTHER), pick(ctx.styles, TX.OTHER), pick(ctx.styles, textType)];
  const merged: LevelStyle = {
    para: Object.assign({}, ...chain.map((s) => s?.para ?? {})) as ParaProps,
    char: Object.assign({}, ...chain.map((s) => s?.char ?? {})) as TextRunProps,
  };
  ctx.levelCache.set(key, merged);
  return merged;
}

function textEnv(ctx: Ctx, textType: number): TextEnv {
  return {
    fonts: ctx.fonts,
    scheme: ctx.scheme,
    levelStyle: (lvl) => levelStyleOf(ctx, textType, lvl),
    claimAutoNums: (paraCount) => claimAutoNums(ctx, paraCount),
  };
}

function textFromClientTextbox(ctx: Ctx, rec: Rec): StyledText | null {
  const { dv } = ctx;
  let text: string | null = null;
  let styleRec: Rec | null = null;
  let textType: number | undefined;
  const links: LinkRange[] = [];
  let pendingLink: string | undefined;
  for (const r of records(dv, rec.start, rec.start + rec.len)) {
    if (r.type === RT.TextCharsAtom) text = utf16(dv, r.start, r.len);
    else if (r.type === RT.TextBytesAtom) text = ansi(dv, r.start, r.len);
    else if (r.type === RT.StyleTextPropAtom) styleRec = r;
    else if (r.type === RT.TextHeaderAtom && r.len >= 4) textType = dv.getUint32(r.start, true);
    else if (r.type === RT.InteractiveInfo) pendingLink = interactiveLink(ctx, r);
    else if (r.type === RT.TextInteractiveInfoAtom && r.len >= 8) {
      // 紧跟在 InteractiveInfo 之后，给出该链接覆盖的字符区间
      const begin = dv.getUint32(r.start, true);
      const end = dv.getUint32(r.start + 4, true);
      if (pendingLink && end > begin) links.push({ begin, end, link: pendingLink });
      pendingLink = undefined;
    }
  }
  if (text === null) return null;
  const styles = styleRec ? parseStyleTextProp(dv, styleRec, text.length) : { para: [], char: [] };
  return { text, paraProps: styles.para, charProps: styles.char, textType, links: links.length ? links : undefined };
}

/** ClientData / ClientTextbox 里的 OEPlaceholderAtom.placeholderId */
function placeholderId(ctx: Ctx, rec: Rec): number | null {
  const { dv } = ctx;
  const data = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientData);
  if (!data) return null;
  const ph = findRec(dv, data.start, data.start + data.len, RT.OEPlaceholderAtom);
  return ph && ph.len >= 6 ? dv.getUint8(ph.start + 4) : null;
}

// ---------------- 超链接 ----------------

/** InteractiveInfoAtom.jump 枚举 → 目标页 */
const JUMP_SLIDE: Record<number, (i: number, n: number) => number> = {
  1: (i, n) => Math.min(i + 1, n),
  2: (i) => Math.max(i - 1, 1),
  3: () => 1,
  4: (_i, n) => n,
};

/**
 * InteractiveInfo 容器 → 链接串。
 * 优先用 ExHyperlink 的目标字符串，其次退回 InteractiveInfoAtom 自带的翻页动作。
 */
function interactiveLink(ctx: Ctx, rec: Rec): string | undefined {
  const { dv } = ctx;
  const atom = findRec(dv, rec.start, rec.start + rec.len, RT.InteractiveInfoAtom);
  if (!atom || atom.len < 16) return undefined;
  const idRef = dv.getUint32(atom.start + 4, true);
  const hit = ctx.links.get(idRef);
  if (hit) return hit;
  const jump = JUMP_SLIDE[dv.getUint8(atom.start + 10)];
  return jump ? `slide:${jump(ctx.slideIndex, ctx.slideCount)}` : undefined;
}

/** 整个形状的超链接：InteractiveInfo 挂在 ClientData 下 */
function clientDataLink(ctx: Ctx, rec: Rec): string | undefined {
  const { dv } = ctx;
  const data = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientData);
  if (!data) return undefined;
  const info = findRec(dv, data.start, data.start + data.len, RT.InteractiveInfo);
  return info ? interactiveLink(ctx, info) : undefined;
}

/** 解析形状的定位框：顶层用 ClientAnchor（主坐标），组内用 ChildAnchor（组坐标） */
function anchorBox(ctx: Ctx, rec: Rec, origin: Origin): { x: number; y: number; w: number; h: number } | null {
  const { dv } = ctx;
  const clientRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientAnchor);
  if (clientRec) {
    const a = readAnchor(dv, clientRec);
    if (a) return { x: a.x * ctx.scale, y: a.y * ctx.scale, w: a.w * ctx.scale, h: a.h * ctx.scale };
  }
  const childRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ChildAnchor);
  if (childRec) {
    const a = readChildAnchor(dv, childRec);
    if (a) return { x: origin.x + a.x * origin.sx, y: origin.y + a.y * origin.sy, w: a.w * origin.sx, h: a.h * origin.sy };
  }
  return null;
}

/** 定位框 + 旋转 / 翻转 / 阴影 / 形状 id：所有元素共用的基础字段 */
function elementBase(
  box: { x: number; y: number; w: number; h: number },
  sp: { id: number; flags: number },
  props: EscherProps,
  scheme: Scheme,
  dv?: DataView,
): ElementBase {
  const rotationRaw = props.simple.get(P.rotation);
  const base: ElementBase = {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rot: rotationRaw !== undefined ? (rotationRaw / 65536) % 360 : 0,
    // 翻转标志在 Sp 记录的 flags 里，不在属性表
    flipH: (sp.flags & SP_FLAG.FLIPH) !== 0,
    flipV: (sp.flags & SP_FLAG.FLIPV) !== 0,
    // 动画按 Escher 形状 id 定位目标
    id: sp.id,
  };
  if (dv) {
    const name = complexString(dv, props, P.wzName);
    if (name) base.name = name;
  }
  const shadow = shapeShadow(props, scheme);
  if (shadow) base.effects = { shadow };
  return base;
}

function parseSpContainer(ctx: Ctx, rec: Rec, origin: Origin): SlideElement | null {
  const { dv } = ctx;
  const spRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Sp);
  if (!spRec) return null;
  const sp = readSp(dv, spRec);
  if (sp.flags & SP_FLAG.DELETED) return null;
  // 组壳与图形树的根都只是坐标系载体，本身不画东西
  if (sp.flags & (SP_FLAG.PATRIARCH | SP_FLAG.GROUP)) return null;
  if (sp.flags & SP_FLAG.BACKGROUND) return null;

  const ph = placeholderId(ctx, rec);
  // 母版上的占位符只是「请在此键入…」的提示框，本身不该出现在幻灯片上
  if (ctx.masterPass && ph !== null && ph !== 0) return null;

  const shapeType = spRec.instance;
  const optRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Opt);
  const props: EscherProps = optRec ? parseOpt(dv, optRec) : { simple: new Map(), complex: new Map() };

  const box = anchorBox(ctx, rec, origin);
  if (!box || box.w <= 0 || box.h <= 0) return null;

  const base = elementBase(box, sp, props, ctx.scheme, dv);
  const shapeLink = clientDataLink(ctx, rec);
  if (shapeLink) base.link = shapeLink;

  const blipUrl = (idx: number): string | null => ctx.blobs[idx - 1] ?? null;

  // 图片
  const pib = props.simple.get(P.pib);
  const preview = pib === undefined ? null : blipUrl(pib);
  // 预览图不能代表可重建的嵌入对象；保留静态预览，但编辑能力必须降为框架级。
  if (sp.flags & SP_FLAG.OLE) {
    return {
      kind: 'unsupported',
      ...base,
      label: '不支持编辑的旧版 OLE 对象',
      ...(preview ? { preview } : {}),
    };
  }
  if (pib !== undefined && (shapeType === MSO_PICTURE_FRAME || pib > 0)) {
    if (preview) {
      const img: ImageElement = {
        kind: 'image',
        ...base,
        src: preview,
        crop: shapeCrop(props),
        stroke: shapeStroke(props, ctx.scheme),
      };
      return img;
    }
  }

  const fill = shapeFill(props, ctx.scheme, blipUrl);
  const stroke = shapeStroke(props, ctx.scheme);

  // 几何
  let path: string | null = null;
  let openGeom = false;
  if (shapeType === 0 && props.complex.has(P.pVertices)) {
    path = customPath(dv, props, box.w, box.h);
  }
  // LibreOffice 的 OOXML→PPT 转换会用 0xFFF 表示已有的边界框投影；保留历史矩形兼容语义。
  const preset = MSO_SHAPE[shapeType] ?? (shapeType === 0x0fff ? 'rect' : null);
  if (!path && !preset) {
    return {
      kind: 'unsupported',
      ...base,
      label: `不支持的旧版形状（MSOSPT ${shapeType}）`,
    };
  }
  if (!path) {
    const adj = msoAdjusts(props, shapeType);
    const g = presetGeom(preset!, box.w, box.h, adj);
    path = g.d;
    openGeom = g.open;
    if (ctx.edit) base.editInfo = { geom: { preset: preset!, adj } };
  }

  // 文本
  const tbRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientTextbox);
  let styled = tbRec ? textFromClientTextbox(ctx, tbRec) : null;
  if (!styled) {
    const txid = props.simple.get(P.lTxid);
    if (txid !== undefined && ctx.listText[txid]) styled = ctx.listText[txid];
  }
  // 文本类型决定继承哪一套母版样式：优先 TextHeaderAtom，其次由占位符类型推断
  const textType = styled?.textType ?? (ph !== null ? PH_TEXT_TYPE[ph] : undefined) ?? TX.OTHER;
  const text = styled ? buildTextBody(styled, textEnv(ctx, textType), props.simple.get(P.anchorText)) : null;

  if (!text && (!fill || fill.type === 'none') && !stroke) return null;

  const shape: ShapeElement = {
    kind: 'shape',
    ...base,
    path,
    fill: openGeom ? { type: 'none' } : fill,
    stroke,
    text,
    openGeom: openGeom || undefined,
  };
  return shape;
}

/** 以角度为调节值的 MSO 形状（值为 度×65536） */
const ANGLE_SHAPES = new Set([19, 98, 102, 103]);

/**
 * MSO 调节值 → 本项目预设几何期望的 OOXML 口径。
 * MSO 长度类调节值以 1/21600 为单位，OOXML 用 100000 制；
 * 角度类以 度×65536 存储，OOXML 用 1/60000 度。
 * 数值离谱时直接丢弃，让预设走自身默认值。
 */
function msoAdjusts(props: EscherProps, shapeType: number): Record<string, number> {
  const isAngle = ANGLE_SHAPES.has(shapeType);
  const out: Record<string, number> = {};
  const ids: [number, string][] = [
    [P.adjustValue, 'adj1'],
    [P.adjust2Value, 'adj2'],
    [P.adjust3Value, 'adj3'],
    [P.adjust4Value, 'adj4'],
  ];
  for (const [id, key] of ids) {
    const raw = props.simple.get(id);
    if (raw === undefined) continue;
    const signed = raw > 0x7fffffff ? raw - 0x100000000 : raw;
    if (isAngle) {
      out[key] = (signed / 65536) * 60000;
      continue;
    }
    // 超出几何盒 4 倍的值视为无效
    if (Math.abs(signed) > 21600 * 4) continue;
    out[key] = (signed / 21600) * 100000;
  }
  if (out.adj1 !== undefined) out.adj = out.adj1;
  return out;
}

/** 组自身：定位框、子坐标系，以及旋转 / 翻转所需的 Sp 与属性表 */
interface GroupSelf {
  rec: Rec;
  sp: { id: number; flags: number };
  props: EscherProps;
  box: { x: number; y: number; w: number; h: number };
  space: { x: number; y: number; w: number; h: number };
}

/**
 * 组内子元素的坐标基准：只把组单位换算成 px，不做组自身的缩放
 * ——缩放交给 GroupElement 的 scaleX/scaleY，这样组被拉伸时文字也跟着变，
 * 与 .pptx 侧 chOff/chExt 的口径一致。
 */
const groupOrigin = (ctx: Ctx): Origin => ({ x: 0, y: 0, sx: ctx.scale, sy: ctx.scale });

/**
 * 组容器。
 * 真正的组产出 GroupElement 保留层级：子元素坐标留在组坐标系里，
 * 由 childX/childY + scaleX/scaleY 描述到父坐标系的映射。
 * 表格组与最外层的 patriarch 例外——前者要还原成表格，后者只是图形树的根。
 */
function parseSpgrContainer(ctx: Ctx, rec: Rec, parent: Origin, depth = 0): SlideElement[] {
  const { dv } = ctx;
  const out: SlideElement[] = [];
  const children = [...records(dv, rec.start, rec.start + rec.len)];
  const first = children.find((c) => c.type === ESCHER.SpContainer);
  const self = first ? readGroupSelf(ctx, first, parent) : null;
  const groupSelf = self?.rec ?? null;

  // 展平用的坐标映射：组框左上角 − 子坐标系原点 × 缩放
  let flat = parent;
  if (self) {
    const sx = self.box.w / self.space.w;
    const sy = self.box.h / self.space.h;
    flat = { x: self.box.x - self.space.x * sx, y: self.box.y - self.space.y * sy, sx, sy };
  }

  const childShapes = (origin: Origin): SlideElement[] => {
    const els: SlideElement[] = [];
    for (const child of children) {
      if (child === groupSelf || child.type !== ESCHER.SpContainer) continue;
      const el = parseSpContainer(ctx, child, origin);
      if (el) els.push(el);
    }
    return els;
  };

  // 表格组：子形状即单元格，按行高与列边界还原成表格元素
  if (self && isTableGroup(self.props)) {
    const cells = childShapes(flat);
    const table = buildTable(
      cells,
      tableRowHeights(dv, self.props).map((h) => h * ctx.scale),
    );
    if (table) return [table];
    return cells;
  }

  // 没有表格标记时用网格启发式：导出器常把表格拆成「底色矩形 + 文字框」两层
  if (self && children.filter((c) => c.type === ESCHER.SpContainer).length >= 4) {
    const merged = mergeCellLayers(childShapes(flat));
    if (looksLikeGrid(merged)) {
      const table = buildTable(merged, []);
      if (table) return [table];
    }
  }

  const collect = (origin: Origin, into: SlideElement[]): void => {
    for (const child of children) {
      if (child === groupSelf) continue;
      if (child.type === ESCHER.SpContainer) {
        const el = parseSpContainer(ctx, child, origin);
        if (el) into.push(el);
      } else if (child.type === ESCHER.SpgrContainer && depth < 8) {
        into.push(...parseSpgrContainer(ctx, child, origin, depth + 1));
      }
    }
  };

  if (self) {
    const kids: SlideElement[] = [];
    collect(groupOrigin(ctx), kids);
    if (!kids.length) return [];
    const spaceW = self.space.w * ctx.scale;
    const spaceH = self.space.h * ctx.scale;
    const group: GroupElement = {
      kind: 'group',
      ...elementBase(self.box, self.sp, self.props, ctx.scheme, ctx.dv),
      childX: self.space.x * ctx.scale,
      childY: self.space.y * ctx.scale,
      scaleX: self.box.w / spaceW,
      scaleY: self.box.h / spaceH,
      children: kids,
    };
    return [group];
  }

  collect(flat, out);
  return out;
}

/**
 * 组容器的首个 SpContainer 若带 GROUP 标志就是组自身。
 * patriarch（图形树的根）与退化成零尺寸的组不算，交给调用方按展平处理。
 */
function readGroupSelf(ctx: Ctx, rec: Rec, parent: Origin): GroupSelf | null {
  const { dv } = ctx;
  const spgr = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Spgr);
  const spRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Sp);
  if (!spgr || !spRec) return null;
  const sp = readSp(dv, spRec);
  if (!(sp.flags & SP_FLAG.GROUP) || sp.flags & SP_FLAG.PATRIARCH) return null;
  const space = readSpgr(dv, spgr);
  const box = anchorBox(ctx, rec, parent);
  if (!space || !box || space.w <= 0 || space.h <= 0 || box.w <= 0 || box.h <= 0) return null;
  const optRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Opt);
  const props: EscherProps = optRec ? parseOpt(dv, optRec) : { simple: new Map(), complex: new Map() };
  return { rec, sp, props, box, space };
}

/** PPDrawing → DgContainer 直属的背景形状（fBackground），其填充即整页底色 */
export function drawingBackground(dv: DataView, drawing: Rec, scheme: Scheme, blipUrl: (i: number) => string | null): Fill | null {
  const dg = findRec(dv, drawing.start, drawing.start + drawing.len, ESCHER.DgContainer);
  if (!dg) return null;
  for (const sp of findAll(dv, dg.start, dg.start + dg.len, ESCHER.SpContainer)) {
    const spRec = findRec(dv, sp.start, sp.start + sp.len, ESCHER.Sp);
    if (!spRec || !(readSp(dv, spRec).flags & SP_FLAG.BACKGROUND)) continue;
    const optRec = findRec(dv, sp.start, sp.start + sp.len, ESCHER.Opt);
    if (!optRec) continue;
    const props = parseOpt(dv, optRec);
    // 只有真的写了填充属性才算数：转换器常留一个「已填充但没给颜色」的空壳
    if (!props.simple.has(P.fillColor) && !props.simple.has(P.fillType) && !props.simple.has(P.fillBlip)) continue;
    const fill = shapeFill(props, scheme, blipUrl);
    if (fill && fill.type !== 'none') return fill;
  }
  return null;
}

/** 遍历 PPDrawing 的图形树 */
export function drawingElements(ctx: Ctx, drawing: Rec): SlideElement[] {
  const out: SlideElement[] = [];
  const dg = findRec(ctx.dv, drawing.start, drawing.start + drawing.len, ESCHER.DgContainer);
  if (!dg) return out;
  for (const spgr of findAll(ctx.dv, dg.start, dg.start + dg.len, ESCHER.SpgrContainer)) {
    out.push(...parseSpgrContainer(ctx, spgr, { x: 0, y: 0, sx: ctx.scale, sy: ctx.scale }));
  }
  return out;
}
