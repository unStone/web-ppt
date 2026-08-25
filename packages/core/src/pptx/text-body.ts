import type {
  TextBodyLayoutProperties, TextVert,
} from '../types';
import { TEXT_BODY_PROPERTY_BITS } from '../text-body-edit';
import { attr, emu, kid, numAttr } from '../xml';

const VERT: Record<string, TextVert> = {
  horz: 'horz', vert: 'vert', vert270: 'vert270', wordArtVert: 'wordArtVert',
  eaVert: 'vert', mongolianVert: 'vert',
};

function attribute(sources: readonly (Element | null)[], name: string): string | null {
  for (const source of sources) {
    const value = attr(source, name);
    if (value !== null) return value;
  }
  return null;
}

/** noAutofit 也是显式互斥分支，必须截断版式/母版的 normAutofit 回退。 */
function autoFitElement(sources: readonly (Element | null)[]): Element | null {
  for (const source of sources) {
    if (!source) continue;
    const direct = kid(source, 'noAutofit') ?? kid(source, 'normAutofit') ?? kid(source, 'spAutoFit');
    if (direct) return direct;
  }
  return null;
}

export function parseTextBodyLayout(
  sources: readonly (Element | null)[],
): TextBodyLayoutProperties {
  const anchorRaw = attribute(sources, 'anchor') ?? 't';
  const ins = (name: string, fallback: number): number => {
    const value = attribute(sources, name);
    return value === null ? emu(fallback) : emu(Number(value));
  };
  const autoFit = autoFitElement(sources);
  const normal = autoFit?.localName === 'normAutofit';
  const shape = autoFit?.localName === 'spAutoFit';
  const explicitScale = normal ? numAttr(autoFit, 'fontScale') : null;
  const numCol = Number(attribute(sources, 'numCol') ?? '1');
  const spcCol = Number(attribute(sources, 'spcCol') ?? '0');
  const vert = VERT[attribute(sources, 'vert') ?? 'horz'];
  return {
    anchor: anchorRaw === 'ctr' ? 'middle' : anchorRaw === 'b' ? 'bottom' : 'top',
    insets: [ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720), ins('lIns', 91440)],
    wrap: attribute(sources, 'wrap') !== 'none',
    fontScale: explicitScale !== null && explicitScale !== undefined ? explicitScale / 100000 : 1,
    ...(normal ? { autoFitNormal: true } : {}),
    ...(normal && (explicitScale === null || explicitScale === undefined) ? { autoFitCompute: true } : {}),
    ...(normal && (numAttr(autoFit, 'lnSpcReduction') ?? 0)
      ? { lnSpcReduction: (numAttr(autoFit, 'lnSpcReduction') ?? 0) / 100000 } : {}),
    ...(shape ? { autoFitShape: true } : {}),
    ...(vert !== 'horz' ? { vert } : {}),
    ...(attribute(sources, 'anchorCtr') === '1' ? { anchorCtr: true } : {}),
    ...(numCol > 1 ? { columns: numCol } : {}),
    ...(Number.isFinite(spcCol) && spcCol !== 0 ? { columnGap: emu(spcCol) } : {}),
  };
}

export function directTextBodyProperties(
  bodyPr: Element | null,
): number {
  if (!bodyPr) return 0;
  let direct = 0;
  if (attr(bodyPr, 'anchor') !== null) direct |= TEXT_BODY_PROPERTY_BITS.anchor;
  if (['tIns', 'rIns', 'bIns', 'lIns'].some((name) => attr(bodyPr, name) !== null)) {
    direct |= TEXT_BODY_PROPERTY_BITS.insets;
  }
  if (attr(bodyPr, 'wrap') !== null) direct |= TEXT_BODY_PROPERTY_BITS.wrap;
  if (attr(bodyPr, 'vert') !== null) direct |= TEXT_BODY_PROPERTY_BITS.vert;
  if (attr(bodyPr, 'anchorCtr') !== null) direct |= TEXT_BODY_PROPERTY_BITS.anchorCtr;
  if (attr(bodyPr, 'numCol') !== null) direct |= TEXT_BODY_PROPERTY_BITS.columns;
  if (attr(bodyPr, 'spcCol') !== null) direct |= TEXT_BODY_PROPERTY_BITS.columnGap;
  if (kid(bodyPr, 'noAutofit') || kid(bodyPr, 'normAutofit') || kid(bodyPr, 'spAutoFit')) {
    direct |= TEXT_BODY_PROPERTY_BITS.autoFit;
  }
  return direct;
}
