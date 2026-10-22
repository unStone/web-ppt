import { placeGroupChild } from '@web-ppt/core';
import type { Fill, SlideElement, TextBody } from '@web-ppt/core';
import { renderedElement, toSlide } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { readDescription } from '../describe/read';
import { LayoutLintError } from './types';

export interface TextUnit {
  body: TextBody; width: number; height: number; fill: Fill | null;
  cell: { row: number; column: number } | null;
}
export function textUnits(element: SlideElement): TextUnit[] {
  if (element.kind === 'shape') return element.text ? [{ body: element.text, width: element.w, height: element.h, fill: element.fill, cell: null }] : [];
  if (element.kind === 'group') return element.children.flatMap(child => textUnits(placeGroupChild(element, child)));
  if (element.kind !== 'table') return [];
  return element.rows.flatMap((row, r) => row.cells.flatMap((cell, c) => {
    if (cell.merged || !cell.text) return [];
    return [{ body: { ...cell.text, insets: cell.margins ?? cell.text.insets, anchor: cell.vAlign ?? cell.text.anchor, vert: cell.vert ?? cell.text.vert },
      width: element.colWidths.slice(c, c + cell.colSpan).reduce((s, n) => s + n, 0),
      height: element.rows.slice(r, r + cell.rowSpan).reduce((s, item) => s + item.height, 0),
      fill: cell.fill ?? null, cell: { row: r, column: c } }];
  }));
}
export function snapshot(doc: EditDoc) {
  const projected = new Map<string, SlideElement>();
  const description = readDescription(doc, (page, id, element) => projected.set(`${page}:${id}`, element));
  const visibleNodes = new Map<SlideElement, SlideElement>();
  const slides = doc.slideOrder.map((id, index) => {
    const hidden = new Set(description.slides[index].elements.filter(e => e.hidden).map(e => projected.get(`${index + 1}:${e.id}`)));
    const visible = (e: SlideElement): SlideElement[] => {
      if (hidden.has(e)) return [];
      const out = e.kind === 'group' ? { ...e, children: e.children.flatMap(visible) } : e;
      visibleNodes.set(e, out); return [out];
    };
    return { ...toSlide(doc, id), elements: toSlide(doc, id).elements.flatMap(visible) };
  });
  return { description, slides,
    elements: description.slides.map(slide => slide.elements.map(item => {
      const raw = projected.get(`${slide.number}:${item.id}`)!;
      let rendered = renderedElement(doc, item.id);
      // 设计画布的动态字段在页面投影上求值，组合里的字段也不能退回未代入页码的模板文字。
      const currentText = (frame: SlideElement, live: SlideElement | undefined): SlideElement => {
        if (!live || frame.kind !== live.kind) throw new LayoutLintError('invalid-document', '设计对象与页面投影不一致', slide.number, item.id);
        if (frame.kind === 'shape' && live.kind === 'shape') return { ...frame, text: live.text };
        if (frame.kind === 'group' && live.kind === 'group') return { ...frame, children: frame.children.map((c, i) => currentText(c, live.children[i])) };
        if (frame.kind === 'table' && live.kind === 'table') return { ...frame, rows: frame.rows.map((row, r) => ({ ...row,
          cells: row.cells.map((cell, c) => {
            const projectedCell = live.rows[r]?.cells[c];
            if (!projectedCell) throw new LayoutLintError('invalid-document', '表格投影单元格不一致', slide.number, item.id);
            return { ...cell, text: projectedCell.text };
          }) })) };
        return frame;
      };
      if (item.canvas.kind !== 'slide') rendered = currentText(rendered, raw);
      const logical = rendered.kind !== 'group' || item.editable === 'frame' || rendered.editInfo?.editable === 'frame';
      return { item, raw, visible: visibleNodes.get(raw) ?? raw, rendered, units: logical ? textUnits(rendered) : [] };
    })) };
}
