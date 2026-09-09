import type {FontEmbeddingRights, FontProblem, FontRequestOptions} from './types';

export function intersectRights(first: FontEmbeddingRights, second?: FontEmbeddingRights): FontEmbeddingRights {
  if (!second) return first;
  const usages: FontEmbeddingRights['usage'][] = ['installable','editable','view-print','restricted'];
  if (!usages.includes(second.usage) || typeof second.subsetAllowed !== 'boolean' || typeof second.outlineAllowed !== 'boolean') {
    throw new Error('invalid-font');
  }
  return {usage:usages[Math.max(usages.indexOf(first.usage),usages.indexOf(second.usage))],
    subsetAllowed:first.subsetAllowed && second.subsetAllowed,outlineAllowed:first.outlineAllowed && second.outlineAllowed};
}

export function embeddingRights(fsType: number, version: number): FontEmbeddingRights {
  const usage = fsType & 15;
  // OS/2 0–2 的混合使用标志取较宽权限，3 起必须互斥；0–1 不解释高位限制。
  if (version > 5 || (usage & 1) || (version >= 3 && ![0,2,4,8].includes(usage)) ||
      (version >= 2 && (fsType & 0xfcf0))) throw new Error('invalid-font');
  return {
    usage:usage & 8 ? 'editable' : usage & 4 ? 'view-print' : usage & 2 ? 'restricted' : 'installable',
    subsetAllowed:version < 2 || !(fsType & 0x100),
    outlineAllowed:version < 2 || !(fsType & 0x200),
  };
}

export function embeddingProblem(rights: FontEmbeddingRights, purpose: FontRequestOptions['purpose']): FontProblem | undefined {
  if (!rights.outlineAllowed) return 'bitmap-only';
  if (rights.usage === 'restricted') return 'embedding-restricted';
  if (rights.usage === 'view-print' && purpose !== 'view-print') return 'preview-print-only';
}
