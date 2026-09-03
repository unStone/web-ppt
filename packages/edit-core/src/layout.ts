import type { Slide } from '@web-ppt/core';
import { own } from './data-validation';
import { assertDesignTarget } from './design-target';
import { effectiveElement } from './projection';
import { layoutShowsMaster, resolvedLayoutTemplate } from './layout-projection';
import type {
  EditDoc, LayoutCatalogItem, LayoutDesignState, LayoutDesignTarget,
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

export function queryLayout(doc: EditDoc, target: LayoutDesignTarget): LayoutDesignState {
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

export function toLayoutCanvas(doc: EditDoc, target: LayoutDesignTarget): Slide {
  assertDesignTarget(doc, target);
  const layout = doc.layouts[target.id];
  const source = resolvedLayoutTemplate(doc, target.id) ?? layout;
  const master = doc.masters[layout.origin.masterPart];
  return {
    background: structuredClone(own(layout.ovr, 'background')
      ? layout.ovr.background! : source.background),
    elements: [
      ...(layoutShowsMaster(doc, layout.id) && master
        ? master.children.map((id) => effectiveElement(doc, id)) : []),
      ...layout.children.map((id) => effectiveElement(doc, id)),
    ],
    layoutName: layout.name,
    ...(own(layout.ovr, 'transition')
      ? { transition: structuredClone(layout.ovr.transition!) }
      : source.transition ? { transition: structuredClone(source.transition) } : {}),
  };
}
