import type { AnimStep, Fill, Paragraph, Presentation, ShapeElement, Slide, SlideElement, TextRun, Transition } from '../types';
import { metafileDataUrl } from '../metafile';
import { collectAutoNums } from './autonum';
import { Cfb } from './cfb';
import { getPptDecryptor } from '../crypto/hook';
import { isPptEncrypted } from '../crypto/ppt';
import { PasswordRequiredError } from '../crypto/ooxml';
import { ESCHER, Scheme, escherColor, extractBlips } from './escher';
import { ansi, findAll, findRec, Rec, records, RT, utf16 } from './records';
import { parseAnimations, parseSlideShowInfo } from './timing';
import { legacyPresentationTheme } from './theme';
import { MasterStyles, parseStyleTextProp, parseTxMasterStyle, StyledText, TX } from './text';
import { MASTER_TO_PX } from './units';
import { Ctx, drawingBackground, drawingElements } from './shapes';
import { collectHyperlinks, resolveLink } from './hyperlinks';

/**
 * .ppt（PowerPoint 97-2003）纯浏览器解析。
 * CFB 容器 → PowerPoint Document 流 → 幻灯片容器 → OfficeArt 图形树 → 统一 Schema。
 * 文本属性见 text.ts，图形树见 shapes.ts。
 */

const DEFAULT_SCHEME: Scheme = ['FFFFFF', '000000', '808080', '000000', 'CCFFFF', 'B2B2B2', '3333CC', '009999'];

// ---------------- 持久化目录（persistId → 记录） ----------------

/**
 * PersistDirectoryAtom：一串 (startId | count<<20) + count 个流内偏移。
 * 增量保存会追加新的目录，靠后的条目覆盖靠前的，正好等于「按文档顺序后写覆盖先写」。
 */
function persistOffsets(dv: DataView, docLen: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of records(dv, 0, docLen)) {
    if (r.type !== RT.PersistDirectoryAtom) continue;
    const end = r.start + r.len;
    let off = r.start;
    while (off + 4 <= end) {
      const head = dv.getUint32(off, true);
      off += 4;
      const startId = head & 0xfffff;
      const count = head >>> 20;
      for (let i = 0; i < count && off + 4 <= end; i++, off += 4) {
        map.set(startId + i, dv.getUint32(off, true));
      }
    }
  }
  return map;
}

interface PersistEntry {
  rec: Rec;
  /** SlidePersistAtom.slideId：SlideAtom 的 masterIdRef / notesIdRef 按它做关联 */
  slideId: number;
}

/**
 * 按 SlideListWithText 的顺序取出幻灯片 / 母版 / 备注容器。
 * 这是文件里权威的顺序来源；持久化目录解析不出来时由调用方退回文档顺序扫描。
 */
function persistList(
  dv: DataView,
  docRec: Rec,
  instance: number,
  offsets: Map<number, number>,
  byOffset: Map<number, Rec>,
  types: number[],
): PersistEntry[] {
  const out: PersistEntry[] = [];
  for (const list of findAll(dv, docRec.start, docRec.start + docRec.len, RT.SlideListWithText)) {
    if (list.instance !== instance) continue;
    for (const atom of findAll(dv, list.start, list.start + list.len, RT.SlidePersistAtom)) {
      if (atom.len < 16) continue;
      const offset = offsets.get(dv.getUint32(atom.start, true));
      const rec = offset !== undefined ? byOffset.get(offset) : undefined;
      if (rec && types.includes(rec.type)) out.push({ rec, slideId: dv.getUint32(atom.start + 12, true) });
    }
  }
  return out;
}

// ---------------- 母版 ----------------

interface MasterInfo {
  scheme: Scheme;
  styles: MasterStyles;
  background: Fill | null;
  elements: SlideElement[];
}

function themeFontIndex(
  master: MasterStyles | undefined,
  environment: MasterStyles,
  types: readonly number[],
  field: 'fontIdx' | 'asianFontIdx',
): number | undefined {
  const styles = [environment.get(TX.OTHER)?.[0], master?.get(TX.OTHER)?.[0]];
  for (const type of types) styles.push(master?.get(type)?.[0]);
  let result: number | undefined;
  for (const style of styles) if (style?.char[field] !== undefined) result = style.char[field];
  return result;
}

function themeFonts(master: MasterInfo | null, shared: Shared) {
  const name = (index: number | undefined): string => (index === undefined ? '' : (shared.fonts[index] ?? ''));
  return {
    majorLatin: name(themeFontIndex(master?.styles, shared.envStyles, [TX.TITLE, TX.CENTER_TITLE], 'fontIdx')),
    majorEa: name(themeFontIndex(master?.styles, shared.envStyles, [TX.TITLE, TX.CENTER_TITLE], 'asianFontIdx')),
    minorLatin: name(themeFontIndex(master?.styles, shared.envStyles, [TX.BODY, TX.CENTER_BODY], 'fontIdx')),
    minorEa: name(themeFontIndex(master?.styles, shared.envStyles, [TX.BODY, TX.CENTER_BODY], 'asianFontIdx')),
  };
}

/** 幻灯片 / 母版容器里的 ColorSchemeAtom → 8 色配色方案 */
function readScheme(dv: DataView, rec: Rec, instance: number): Scheme | null {
  for (const r of findAll(dv, rec.start, rec.start + rec.len, RT.ColorSchemeAtom)) {
    if (r.instance !== instance || r.len < 32) continue;
    const out: Scheme = [];
    for (let i = 0; i < 8; i++) {
      const v = dv.getUint32(r.start + i * 4, true);
      const parts = [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
      out.push(parts.map((c) => c.toString(16).padStart(2, '0')).join(''));
    }
    return out;
  }
  return null;
}

function parseMaster(dv: DataView, rec: Rec, shared: Shared): MasterInfo {
  const scheme = readScheme(dv, rec, 1) ?? readScheme(dv, rec, 6) ?? DEFAULT_SCHEME;
  const styles: MasterStyles = new Map();
  for (const r of findAll(dv, rec.start, rec.start + rec.len, RT.TxMasterStyleAtom)) {
    parseTxMasterStyle(dv, r, styles);
  }

  const drawing = findRec(dv, rec.start, rec.start + rec.len, RT.PPDrawing);
  const blipUrl = (idx: number): string | null => shared.blobs[idx - 1] ?? null;
  const background = drawing ? drawingBackground(dv, drawing, scheme, blipUrl) : null;

  const ctx: Ctx = {
    dv,
    scheme,
    fonts: shared.fonts,
    blobs: shared.blobs,
    listText: [],
    scale: shared.scale,
    styles,
    envStyles: shared.envStyles,
    links: new Map(),
    masterPass: true,
    levelCache: new Map(),
    slideIndex: 1,
    slideCount: 1,
    autoNums: collectAutoNums(dv, rec),
    autoNumCursor: 0,
    edit: shared.edit,
  };
  const elements = drawing ? drawingElements(ctx, drawing) : [];
  return { scheme, styles, background, elements };
}

// ---------------- 演讲者备注 ----------------

/** Notes 容器里 TextTypeEnum 为 notes 的文本即备注正文（页码 / 页脚域不算） */
function notesText(dv: DataView, rec: Rec): string {
  const lines: string[] = [];
  let type = -1;
  const walk = (start: number, end: number, depth: number): void => {
    for (const r of records(dv, start, end)) {
      if (r.type === RT.TextHeaderAtom && r.len >= 4) type = dv.getUint32(r.start, true);
      else if (r.type === RT.TextCharsAtom || r.type === RT.TextBytesAtom) {
        if (type === TX.NOTES) {
          const raw = r.type === RT.TextCharsAtom ? utf16(dv, r.start, r.len) : ansi(dv, r.start, r.len);
          const text = raw.replace(/\r\n?/g, '\n').replace(/\v/g, '\n').replace(/\0/g, '').trim();
          if (text) lines.push(text);
        }
        type = -1;
      } else if ((r.isContainer || r.type === ESCHER.ClientTextbox) && depth < 8) {
        walk(r.start, r.start + r.len, depth + 1);
      }
    }
  };
  walk(rec.start, rec.start + rec.len, 0);
  return lines.join('\n');
}

// ---------------- 入口 ----------------

interface Shared {
  fonts: string[];
  blobs: (string | null)[];
  scale: number;
  envStyles: MasterStyles;
  edit: boolean;
}

export function parsePpt(bytes: Uint8Array, password?: string, edit = false): Presentation {
  const cfb = new Cfb(bytes);

  // 加密的 .pptx 已在 parse() 里被 EncryptedPackage 流拦下并解密，走不到这里
  if (cfb.stream('EncryptedPackage') || cfb.stream('EncryptionInfo')) {
    throw new Error('该文件是加密的 OOXML 容器，请用 parse(input, { password })');
  }

  let doc = cfb.stream('PowerPoint Document');
  if (!doc) throw new Error('无效的 .ppt：找不到 PowerPoint Document 流');

  // 老式 .ppt 的 RC4 CryptoAPI 加密。判据在 Current User 流的 headerToken 上，
  // 不看这一处就只会得到「.ppt 中未找到幻灯片」——实测 POI 语料里 5 个加密文件
  // 全都被这样误诊过。
  const currentUser = cfb.stream('Current User');
  if (isPptEncrypted(currentUser) && currentUser) {
    const decrypt = getPptDecryptor();
    if (!decrypt) throw new Error('该 .ppt 已加密，但未注入解密器（setPptDecryptor）');
    if (password === undefined) throw new PasswordRequiredError();
    const plain = decrypt(doc, currentUser, password);
    if (!plain) throw new Error('该 .ppt 已加密，但加密结构无法识别');
    doc = plain;
  }
  const dv = new DataView(doc.buffer, doc.byteOffset, doc.byteLength);

  let width = 720 * (96 / 72);
  let height = 540 * (96 / 72);

  // 图片
  const pictures = cfb.stream('Pictures');
  const blips = pictures ? extractBlips(pictures) : [];
  const blobs = blips.map((b) => {
    try {
      // 图元文件浏览器无法直接解码，转成 SVG data URI。
      // PICT 是 Mac 版存的，同样要走解码器——直接丢给 <img> 只会是裂图
      if (b.mime === 'image/emf' || b.mime === 'image/wmf' || b.mime === 'image/pict') {
        return metafileDataUrl(b.data);
      }
      return URL.createObjectURL(new Blob([b.data.slice().buffer], { type: b.mime }));
    } catch {
      return null;
    }
  });

  // 顶层记录索引：持久化目录里的偏移是记录头的位置
  const byOffset = new Map<number, Rec>();
  const topLevel: Rec[] = [];
  for (const r of records(dv, 0, doc.length)) {
    byOffset.set(r.start - 8, r);
    topLevel.push(r);
  }

  // 字体表与 Environment 的全局默认文本样式
  const fonts: string[] = [];
  const envStyles: MasterStyles = new Map();
  const docRec = findRec(dv, 0, doc.length, RT.Document);
  const scan = (start: number, end: number, depth: number): void => {
    for (const r of records(dv, start, end)) {
      if (r.type === RT.DocumentAtom && r.len >= 8) {
        width = dv.getInt32(r.start, true) * MASTER_TO_PX;
        height = dv.getInt32(r.start + 4, true) * MASTER_TO_PX;
      } else if (r.type === RT.FontEntityAtom) {
        const name = utf16(dv, r.start, Math.min(r.len, 64)).replace(/\0.*$/, '');
        // recInstance 即字体索引；异常时退回追加顺序
        if (name) fonts[r.instance < 512 ? r.instance : fonts.length] = name;
      } else if (r.type === RT.TxMasterStyleAtom) {
        parseTxMasterStyle(dv, r, envStyles);
      }
      if (r.isContainer && depth < 4) scan(r.start, r.start + r.len, depth + 1);
    }
  };
  if (docRec) scan(docRec.start, docRec.start + docRec.len, 0);

  const shared: Shared = { fonts, blobs, scale: MASTER_TO_PX, envStyles, edit };
  const offsets = persistOffsets(dv, doc.length);

  // 幻灯片 / 母版 / 备注：优先按持久化目录的顺序，缺失时退回文档顺序
  const byType = (type: number): Rec[] => topLevel.filter((r) => r.type === type);
  let slideEntries = docRec ? persistList(dv, docRec, 0, offsets, byOffset, [RT.Slide]) : [];
  if (!slideEntries.length) slideEntries = byType(RT.Slide).map((rec) => ({ rec, slideId: 0 }));
  const masterEntries = docRec ? persistList(dv, docRec, 1, offsets, byOffset, [RT.MainMaster, RT.Slide]) : [];
  const notesEntries = docRec ? persistList(dv, docRec, 2, offsets, byOffset, [RT.Notes]) : [];

  const masterCache = new Map<number, MasterInfo>();
  const masterById = new Map<number, Rec>();
  for (const m of masterEntries) masterById.set(m.slideId, m.rec);
  const fallbackMaster = masterEntries[0]?.rec ?? byType(RT.MainMaster)[0] ?? null;
  const masterFor = (id: number): MasterInfo | null => {
    const rec = masterById.get(id) ?? fallbackMaster;
    if (!rec) return null;
    const key = rec.start;
    let info = masterCache.get(key);
    if (!info) {
      info = parseMaster(dv, rec, shared);
      masterCache.set(key, info);
    }
    return info;
  };

  // 备注：先按 notesIdRef 关联，取不到时退回 NotesAtom.slideIdRef 反查
  const notesById = new Map<number, Rec>();
  for (const n of notesEntries) notesById.set(n.slideId, n.rec);
  const notesBySlideId = new Map<number, Rec>();
  for (const rec of byType(RT.Notes)) {
    const atom = findRec(dv, rec.start, rec.start + rec.len, RT.NotesAtom);
    if (atom && atom.len >= 4) notesBySlideId.set(dv.getUint32(atom.start, true), rec);
  }

  const hyperlinks = docRec ? collectHyperlinks(dv, docRec) : new Map<number, string>();

  const count = slideEntries.length;
  let primaryMaster: MasterInfo | null = null;
  let slides: Slide[] = slideEntries.map((entry, i) => {
    const atom = findRec(dv, entry.rec.start, entry.rec.start + entry.rec.len, RT.SlideAtom);
    const masterIdRef = atom && atom.len >= 24 ? dv.getUint32(atom.start + 12, true) : 0;
    const notesIdRef = atom && atom.len >= 24 ? dv.getUint32(atom.start + 16, true) : 0;
    // [MS-PPT] SlideFlags：bit0 = 跟随母版图形，bit2 = 跟随母版背景
    const flags = atom && atom.len >= 24 ? dv.getUint16(atom.start + 20, true) : 0x7;
    const notes = notesById.get(notesIdRef) ?? notesBySlideId.get(entry.slideId) ?? null;
    const master = masterFor(masterIdRef);
    primaryMaster ??= master;
    return parseSlide(dv, entry.rec, shared, {
      master,
      followMasterObjects: (flags & 0x1) !== 0,
      followMasterBackground: (flags & 0x4) !== 0,
      notes: notes ? notesText(dv, notes) : '',
      hyperlinks,
      index: i + 1,
      count,
    });
  });

  // 兜底：没有 Slide 容器（或图形树为空）时，退回 SlideListWithText 的纯文本
  if (!slides.length || slides.every((s) => !s.elements.length)) {
    const textOnly = slidesFromTextList(dv, doc.length, width, height);
    if (textOnly.length) slides = textOnly;
  }

  if (!slides.length) throw new Error('.ppt 中未找到幻灯片');
  const editAssets = edit
    ? blobs.flatMap((url, index) => {
        const blip = url?.startsWith('blob:') ? blips[index] : undefined;
        return url && blip ? [{ url, mime: blip.mime, bytes: blip.data.slice() }] : [];
      })
    : [];
  let disposed = false;
  return {
    width,
    height,
    slides,
    source: 'ppt',
    ...(edit
      ? {
          editInfo: {
            layouts: [],
            masters: [],
            themes: [
              legacyPresentationTheme(
                (primaryMaster as MasterInfo | null)?.scheme ?? DEFAULT_SCHEME,
                themeFonts(primaryMaster as MasterInfo | null, shared),
              ),
            ],
            assets: editAssets,
          },
        }
      : {}),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const url of blobs)
        if (url?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* data URI 与已释放 URL 无需处理。 */
          }
        }
    },
  };
}

/**
 * 兜底路径：只从 SlideListWithText 抽文本，按标题 / 正文两个文本框排版。
 * 用于图形树缺失或非常规结构的文件，保证至少能读到内容。
 */
function slidesFromTextList(dv: DataView, docLen: number, width: number, height: number): Slide[] {
  const listRec = (function find(start: number, end: number, depth: number): Rec | null {
    for (const r of records(dv, start, end)) {
      if (r.type === RT.SlideListWithText && r.instance === 0) return r;
      if (r.isContainer && depth < 4) {
        const hit = find(r.start, r.start + r.len, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  })(0, docLen, 0);
  if (!listRec) return [];

  const out: { titles: string[]; bodies: string[] }[] = [];
  let cur: { titles: string[]; bodies: string[] } | null = null;
  let txType = 4;
  for (const r of records(dv, listRec.start, listRec.start + listRec.len)) {
    if (r.type === RT.SlidePersistAtom) {
      cur = { titles: [], bodies: [] };
      out.push(cur);
    } else if (r.type === RT.TextHeaderAtom && r.len >= 4) {
      txType = dv.getUint32(r.start, true);
    } else if (cur && (r.type === RT.TextCharsAtom || r.type === RT.TextBytesAtom)) {
      const text = r.type === RT.TextCharsAtom ? utf16(dv, r.start, r.len) : ansi(dv, r.start, r.len);
      (txType === 0 || txType === 6 ? cur.titles : cur.bodies).push(text);
    }
  }

  const mkRun = (text: string, size: number, b: boolean, color: string): TextRun => ({
    text,
    b,
    i: false,
    u: false,
    strike: false,
    size,
    color,
    fonts: [],
  });
  const mkPara = (runs: TextRun[], bullet: string | null): Paragraph => ({
    align: 'left',
    lvl: 0,
    marL: bullet ? 24 : 0,
    indent: bullet ? -24 : 0,
    bullet,
    lineHeight: null,
    spaceBefore: 0,
    spaceAfter: 6,
    runs,
  });
  const splitLines = (t: string): string[] =>
    t
      .split(/[\r\n\v]/)
      .map((x) => x.trim())
      .filter(Boolean);

  return out
    .filter((s) => s.titles.length || s.bodies.length)
    .map((s): Slide => {
      const elements: ShapeElement[] = [];
      if (s.titles.length) {
        elements.push({
          kind: 'shape',
          x: width * 0.06,
          y: height * 0.05,
          w: width * 0.88,
          h: height * 0.16,
          rot: 0,
          flipH: false,
          flipV: false,
          path: null,
          fill: null,
          stroke: null,
          text: {
            anchor: 'middle',
            insets: [4, 8, 4, 8],
            wrap: true,
            fontScale: 1,
            paragraphs: s.titles.flatMap((t) => splitLines(t).map((l) => mkPara([mkRun(l, 34, true, 'rgb(30,30,30)')], null))),
          },
        });
      }
      if (s.bodies.length) {
        elements.push({
          kind: 'shape',
          x: width * 0.06,
          y: height * 0.24,
          w: width * 0.88,
          h: height * 0.68,
          rot: 0,
          flipH: false,
          flipV: false,
          path: null,
          fill: null,
          stroke: null,
          text: {
            anchor: 'top',
            insets: [4, 8, 4, 8],
            wrap: true,
            fontScale: 1,
            paragraphs: s.bodies.flatMap((t) => splitLines(t).map((l) => mkPara([mkRun(l, 20, false, 'rgb(50,50,50)')], '•'))),
          },
        });
      }
      return { background: { type: 'solid', color: 'rgb(255,255,255)' }, elements };
    });
}

/** 一页所继承的母版信息与关联内容 */
interface SlideEnv {
  master: MasterInfo | null;
  followMasterObjects: boolean;
  followMasterBackground: boolean;
  notes: string;
  hyperlinks: Map<number, string>;
  index: number;
  count: number;
}

function parseSlide(dv: DataView, slideRec: Rec, shared: Shared, env: SlideEnv): Slide {
  const end = slideRec.start + slideRec.len;
  const scheme = readScheme(dv, slideRec, 1) ?? env.master?.scheme ?? DEFAULT_SCHEME;

  // 幻灯片内的文本列表（占位符文本按 TextHeaderAtom 顺序）
  const listText: StyledText[] = [];
  let pendingStyle: Rec | null = null;
  let pendingText: string | null = null;
  let pendingType: number | undefined;
  const flush = (): void => {
    if (pendingText === null) return;
    const st = pendingStyle ? parseStyleTextProp(dv, pendingStyle, pendingText.length) : { para: [], char: [] };
    listText.push({ text: pendingText, paraProps: st.para, charProps: st.char, textType: pendingType });
    pendingText = null;
    pendingStyle = null;
    pendingType = undefined;
  };
  for (const r of records(dv, slideRec.start, end)) {
    if (r.type === RT.TextHeaderAtom) {
      flush();
      if (r.len >= 4) pendingType = dv.getUint32(r.start, true);
    } else if (r.type === RT.TextCharsAtom) pendingText = utf16(dv, r.start, r.len);
    else if (r.type === RT.TextBytesAtom) pendingText = ansi(dv, r.start, r.len);
    else if (r.type === RT.StyleTextPropAtom) pendingStyle = r;
  }
  flush();

  // 超链接目标按当前页序号归一（「下一页」「末页」这类跳转与页码相关）
  const links = new Map<number, string>();
  for (const [id, target] of env.hyperlinks) {
    const resolved = resolveLink(target, env.index, env.count);
    if (resolved) links.set(id, resolved);
  }

  const ctx: Ctx = {
    dv,
    scheme,
    fonts: shared.fonts,
    blobs: shared.blobs,
    listText,
    scale: shared.scale,
    styles: env.master?.styles ?? new Map(),
    envStyles: shared.envStyles,
    links,
    masterPass: false,
    levelCache: new Map(),
    slideIndex: env.index,
    slideCount: env.count,
    autoNums: collectAutoNums(dv, slideRec),
    autoNumCursor: 0,
    edit: shared.edit,
  };

  // 母版图形垫在最底层，其次才是本页自己的图形
  const elements: SlideElement[] = [];
  if (env.master && env.followMasterObjects) elements.push(...env.master.elements);
  const drawing = findRec(dv, slideRec.start, end, RT.PPDrawing);
  if (drawing) elements.push(...drawingElements(ctx, drawing));

  // 背景：本页自带的背景形状 → 母版背景 → 配色方案第 0 项
  const blipUrl = (idx: number): string | null => shared.blobs[idx - 1] ?? null;
  const own = drawing ? drawingBackground(dv, drawing, scheme, blipUrl) : null;
  const inherited = env.followMasterBackground ? (env.master?.background ?? null) : null;
  const background: Fill = inherited ?? own ?? { type: 'solid', color: escherColor(0x08000000, scheme) };

  // 放映信息：隐藏标记、切换效果、动画
  const show = parseSlideShowInfo(dv, slideRec);
  const transition: Transition | undefined = show?.transition;
  const animations: AnimStep[] | undefined = parseAnimations(dv, slideRec);

  return {
    background,
    elements,
    notes: env.notes || undefined,
    hidden: show?.hidden ? true : undefined,
    transition,
    animations,
  };
}
