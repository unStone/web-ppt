import type { SnapGuide } from './snap';

const SVG_NS = 'http://www.w3.org/2000/svg';
type Axis = 'x' | 'y';

function alignmentSlot(document: Document, axis: Axis): SVGLineElement {
  const line = document.createElementNS(SVG_NS, 'line');
  line.dataset.editSnapSlot = axis;
  line.setAttribute('display', 'none');
  line.setAttribute('stroke', '#db2777');
  return line;
}

function spacingSlot(document: Document, axis: Axis): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.dataset.editSpacingSlot = axis;
  group.setAttribute('display', 'none');
  for (let interval = 0; interval < 2; interval++) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.dataset.editSpacingSegment = String(interval);
    line.setAttribute('stroke', '#db2777');
    group.append(line);
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      const arrow = document.createElementNS(SVG_NS, 'polyline');
      arrow.dataset.editSpacingArrow = `${interval}/${endpoint}`;
      arrow.setAttribute('fill', 'none');
      arrow.setAttribute('stroke', '#db2777');
      group.append(arrow);
    }
  }
  return group;
}

export function createSnapGuideLayer(document: Document): SVGGElement {
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.dataset.editSnapGuides = '';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.pointerEvents = 'none';
  for (const axis of ['x', 'y'] as const) {
    layer.append(alignmentSlot(document, axis), spacingSlot(document, axis));
  }
  return layer;
}

export function renderSnapGuides(layer: SVGGElement, guides: readonly SnapGuide[], zoom: number): void {
  for (const line of layer.querySelectorAll<SVGLineElement>('[data-edit-snap-slot]')) {
    line.setAttribute('display', 'none');
    line.removeAttribute('data-edit-snap-guide');
    line.removeAttribute('data-edit-snap-source');
  }
  for (const group of layer.querySelectorAll<SVGGElement>('[data-edit-spacing-slot]')) {
    group.setAttribute('display', 'none');
    group.removeAttribute('data-edit-spacing-guide');
    group.removeAttribute('data-edit-snap-source');
  }
  for (const guide of guides) {
    if (guide.kind === 'spacing') {
      const group = layer.querySelector<SVGGElement>(
        `[data-edit-spacing-slot="${guide.axis}"]`,
      )!;
      group.removeAttribute('display');
      group.dataset.editSpacingGuide = guide.axis;
      group.dataset.editSnapSource = guide.source;
      const arrowSize = 4 / zoom;
      const lines = group.querySelectorAll<SVGLineElement>('[data-edit-spacing-segment]');
      const arrows = group.querySelectorAll<SVGPolylineElement>('[data-edit-spacing-arrow]');
      guide.intervals.forEach((interval, intervalIndex) => {
        const line = lines[intervalIndex];
        line.setAttribute('stroke-width', String(1 / zoom));
        if (guide.axis === 'x') {
          line.setAttribute('x1', String(interval.start));
          line.setAttribute('x2', String(interval.end));
          line.setAttribute('y1', String(guide.cross));
          line.setAttribute('y2', String(guide.cross));
        } else {
          line.setAttribute('x1', String(guide.cross));
          line.setAttribute('x2', String(guide.cross));
          line.setAttribute('y1', String(interval.start));
          line.setAttribute('y2', String(interval.end));
        }
        [interval.start, interval.end].forEach((endpoint, endpointIndex) => {
          const arrow = arrows[intervalIndex * 2 + endpointIndex];
          arrow.setAttribute('stroke-width', String(1 / zoom));
          const direction = endpointIndex === 0 ? 1 : -1;
          arrow.setAttribute('points', guide.axis === 'x'
            ? `${endpoint + direction * arrowSize},${guide.cross - arrowSize} ${endpoint},${guide.cross} `
              + `${endpoint + direction * arrowSize},${guide.cross + arrowSize}`
            : `${guide.cross - arrowSize},${endpoint + direction * arrowSize} ${guide.cross},${endpoint} `
              + `${guide.cross + arrowSize},${endpoint + direction * arrowSize}`);
        });
      });
      continue;
    }
    const line = layer.querySelector<SVGLineElement>(`[data-edit-snap-slot="${guide.axis}"]`)!;
    line.removeAttribute('display');
    line.dataset.editSnapGuide = guide.axis;
    line.dataset.editSnapSource = guide.source;
    line.setAttribute('stroke-width', String(1 / zoom));
    line.setAttribute('stroke-dasharray', `${4 / zoom} ${3 / zoom}`);
    if (guide.axis === 'x') {
      line.setAttribute('x1', String(guide.position));
      line.setAttribute('x2', String(guide.position));
      line.setAttribute('y1', String(guide.start));
      line.setAttribute('y2', String(guide.end));
    } else {
      line.setAttribute('x1', String(guide.start));
      line.setAttribute('x2', String(guide.end));
      line.setAttribute('y1', String(guide.position));
      line.setAttribute('y2', String(guide.position));
    }
  }
}
