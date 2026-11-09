/**
 * .ppt 超链接目录：Document > ExObjList 下的 ExHyperlink，以及目标字符串到统一链接格式的归一。
 */
import { findAll, findRec, Rec, records, RT, utf16 } from './records';

/** Document > ExObjList 下的 ExHyperlink：id → 目标字符串（未归一） */
export function collectHyperlinks(dv: DataView, docRec: Rec): Map<number, string> {
  const out = new Map<number, string>();
  const list = findRec(dv, docRec.start, docRec.start + docRec.len, RT.ExObjList);
  if (!list) return out;
  for (const link of findAll(dv, list.start, list.start + list.len, RT.ExHyperlink)) {
    let id: number | null = null;
    let target: string | null = null;
    let friendly: string | null = null;
    for (const r of records(dv, link.start, link.start + link.len)) {
      if (r.type === RT.ExHyperlinkAtom && r.len >= 4) id = dv.getUint32(r.start, true);
      else if (r.type === RT.CString) {
        const s = utf16(dv, r.start, r.len).replace(/\0+$/, '');
        // recInstance：0 = 显示名，1 = 目标，3 = 目标内定位
        if (r.instance === 1) target = s;
        else if (r.instance === 0) friendly = s;
      }
    }
    const value = target ?? friendly;
    if (id !== null && value) out.set(id, value);
  }
  return out;
}

/**
 * 目标字符串 → 统一链接格式。
 * PowerPoint 用 `<id>,<页序>,<页名>` 表示跳页，LibreOffice 用 `#action?jump=…`。
 */
export function resolveLink(target: string, index: number, count: number): string | null {
  const raw = target.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const action = /^#?action\?jump=(.+)$/.exec(lower) ?? /^#action\?jump=(.+)$/.exec(lower);
  if (action) {
    const what = action[1];
    if (what === 'firstslide') return 'slide:1';
    if (what === 'lastslide') return `slide:${count}`;
    if (what === 'nextslide') return `slide:${Math.min(index + 1, count)}`;
    if (what === 'previousslide') return `slide:${Math.max(index - 1, 1)}`;
    const page = /(\d+)/.exec(what);
    return page ? `slide:${page[1]}` : null;
  }

  const pptJump = /^\s*\d+\s*,\s*(\d+)\s*,/.exec(raw);
  if (pptJump) return `slide:${pptJump[1]}`;

  if (raw.startsWith('#')) {
    const page = /(\d+)\s*$/.exec(raw);
    return page ? `slide:${page[1]}` : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(lower)) return raw;
  if (/^www\./.test(lower)) return `https://${raw}`;
  return raw;
}
