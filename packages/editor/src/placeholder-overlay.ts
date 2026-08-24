import {
  effectiveElement, elementFrameToSlidePoint,
} from '@web-ppt/edit-core';
import type { EditDoc, ElementId, SlideId, SpacePoint } from '@web-ppt/edit-core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LABELS: Readonly<Record<string, string>> = {
  title: '添加标题', ctrTitle: '添加标题', subTitle: '添加副标题',
  body: '添加正文', obj: '添加内容',
};
const TEXT_PLACEHOLDERS = new Set(Object.keys(LABELS));

const svg = <K extends keyof SVGElementTagNameMap>(document: Document, name: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG_NS, name);

function corners(doc: EditDoc, id: ElementId): [SpacePoint, SpacePoint, SpacePoint, SpacePoint] {
  const element = effectiveElement(doc, id);
  return [
    elementFrameToSlidePoint(doc, id, { x: 0, y: 0 }),
    elementFrameToSlidePoint(doc, id, { x: element.w, y: 0 }),
    elementFrameToSlidePoint(doc, id, { x: element.w, y: element.h }),
    elementFrameToSlidePoint(doc, id, { x: 0, y: element.h }),
  ];
}

interface PlaceholderEntry {
  readonly id: ElementId;
  readonly points: readonly [SpacePoint, SpacePoint, SpacePoint, SpacePoint];
}

function placeholders(doc: EditDoc, slideId: SlideId): PlaceholderEntry[] {
  const entries: PlaceholderEntry[] = [];
  const visit = (id: ElementId): void => {
    const record = doc.elements[id];
    if (!record) return;
    if (record.meta.ph && TEXT_PLACEHOLDERS.has(record.meta.ph.type)
      && record.meta.editable === 'full' && !record.meta.hiddenByUser) {
      const element = effectiveElement(doc, id);
      if (element.kind === 'shape' && element.text === null && element.w > 0 && element.h > 0) {
        entries.push({ id, points: corners(doc, id) });
      }
    }
    for (const child of record.children ?? []) visit(child);
  };
  for (const id of doc.slides[slideId]?.children ?? []) visit(id);
  return entries;
}

/** 空占位符本身没有可命中的静态 SVG；辅助框只存在于 edit interaction 层。 */
export function renderPlaceholderOverlay(
  layer: SVGSVGElement,
  doc: EditDoc,
  slideId: SlideId,
  zoom: number,
  enabled: boolean,
): void {
  const previous = layer.querySelector<SVGGElement>('[data-edit-placeholder-layer]');
  if (!enabled) {
    previous?.remove();
    return;
  }
  const entries = placeholders(doc, slideId);
  const signature = `${zoom}\0${entries.map(({ id, points }) =>
    `${id}:${points.map(({ x, y }) => `${x},${y}`).join(';')}`).join('\0')}`;
  if (previous?.dataset.editPlaceholderSignature === signature) return;
  previous?.remove();
  const document = layer.ownerDocument;
  const group = svg(document, 'g');
  group.dataset.editPlaceholderLayer = '';
  group.dataset.editPlaceholderSignature = signature;
  group.setAttribute('aria-hidden', 'true');
  group.style.pointerEvents = 'none';
  for (const { id, points } of entries) {
    const record = doc.elements[id];
    const hit = svg(document, 'polygon');
    hit.dataset.editPlaceholderId = id;
    hit.dataset.editId = id;
    hit.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
    hit.setAttribute('fill', 'rgba(37,99,235,0.025)');
    hit.setAttribute('stroke', '#94a3b8');
    hit.setAttribute('stroke-width', String(1.25 / zoom));
    hit.setAttribute('stroke-dasharray', `${5 / zoom} ${4 / zoom}`);
    hit.style.pointerEvents = 'all';
    hit.style.cursor = 'text';
    group.append(hit);

    const label = svg(document, 'text');
    const center = {
      x: (points[0].x + points[1].x + points[2].x + points[3].x) / 4,
      y: (points[0].y + points[1].y + points[2].y + points[3].y) / 4,
    };
    label.setAttribute('x', String(center.x));
    label.setAttribute('y', String(center.y));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('fill', '#64748b');
    label.setAttribute('font-family', 'system-ui, sans-serif');
    label.setAttribute('font-size', String(15 / zoom));
    label.textContent = LABELS[record.meta.ph!.type] ?? '添加内容';
    group.append(label);
  }
  layer.prepend(group);
}
