import type { Slide } from '@web-ppt/core';
import { own } from './data-validation';
import { effectiveElement } from './projection';
import type { EditDoc, MasterCatalogItem, MasterDesignState, MasterDesignTarget } from './types';
import { masterTextStyleStates } from './master-text-style-state';
import { resolvedMasterTemplate } from './layout-projection';

export function listMasters(doc: EditDoc): MasterCatalogItem[] {
  return doc.masterOrder.map((id) => {
    const master = doc.masters[id];
    return {
      id,
      name: master.name,
      ...(master.themeId ? { themeId: master.themeId } : {}),
      layoutIds: [...master.layoutIds],
      target: { kind: 'master', id },
    };
  });
}

export function queryMaster(doc: EditDoc, target: MasterDesignTarget): MasterDesignState {
  const master = doc.masters[target.id];
  if (!master) throw new Error(`找不到母版设计目标：${target.id}`);
  const resolved = resolvedMasterTemplate(doc, master.id);
  const catalog = listMasters(doc).find((item) => item.id === target.id)!;
  return {
    ...catalog,
    background: {
      value: structuredClone(own(master.ovr, 'background')
        ? master.ovr.background! : resolved?.background ?? master.background),
      source: structuredClone(master.background),
      direct: own(master.ovr, 'background'),
    },
    textStyles: masterTextStyleStates(doc, master.id, resolved),
  };
}

export function toMasterCanvas(doc: EditDoc, target: MasterDesignTarget): Slide {
  const master = doc.masters[target.id];
  if (!master) throw new Error(`找不到母版设计目标：${target.id}`);
  const resolved = resolvedMasterTemplate(doc, master.id);
  return {
    background: structuredClone(own(master.ovr, 'background')
      ? master.ovr.background! : resolved?.background ?? master.background),
    elements: master.children.map((id) => effectiveElement(doc, id)),
    layoutName: master.name,
  };
}
