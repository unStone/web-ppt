import type { Slide } from '@web-ppt/core';
import { own } from './data-validation';
import { assertDesignTarget } from './design-target';
import { effectiveElement } from './projection';
import { resolvedLayoutTemplate } from './layout-projection';
import type {
  DesignTarget, EditDoc, LayoutCatalogItem, LayoutDesignState,
} from './types';

export function listLayouts(doc: EditDoc): LayoutCatalogItem[] {
  return doc.layoutOrder.map((id) => {
    const layout = doc.layouts[id];
    return {
      id, name: layout.name, masterId: layout.origin.masterPart,
      ...(layout.themeId ? { themeId: layout.themeId } : {}),
      target: { kind: 'layout', id },
    };
  });
}

export function queryLayout(doc: EditDoc, target: DesignTarget): LayoutDesignState {
  assertDesignTarget(doc, target);
  const layout = doc.layouts[target.id];
  const source = resolvedLayoutTemplate(doc, target.id) ?? layout;
  const catalog = listLayouts(doc).find((item) => item.id === target.id)!;
  return {
    ...catalog,
    background: {
      value: structuredClone(own(layout.ovr, 'background')
        ? layout.ovr.background! : source.background),
      source: structuredClone(source.background),
      direct: own(layout.ovr, 'background'),
    },
    transition: {
      value: structuredClone(own(layout.ovr, 'transition')
        ? layout.ovr.transition! : source.transition ?? null),
      source: structuredClone(source.transition ?? null),
      direct: own(layout.ovr, 'transition'),
    },
  };
}

export function toDesignCanvas(doc: EditDoc, target: DesignTarget): Slide {
  assertDesignTarget(doc, target);
  const layout = doc.layouts[target.id];
  const source = resolvedLayoutTemplate(doc, target.id) ?? layout;
  return {
    background: structuredClone(own(layout.ovr, 'background')
      ? layout.ovr.background! : source.background),
    elements: layout.children.map((id) => effectiveElement(doc, id)),
    layoutName: layout.name,
    ...(own(layout.ovr, 'transition')
      ? { transition: structuredClone(layout.ovr.transition!) }
      : source.transition ? { transition: structuredClone(source.transition) } : {}),
  };
}
