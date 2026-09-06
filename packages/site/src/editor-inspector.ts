import {
  queryElementEffects,
  queryElementCrop,
  queryElementFill,
  queryElementLink,
  queryElementStroke,
  type EditorSession,
  type LinkTarget,
  type ParagraphPropertyInput,
  type SlideEditor,
} from '@web-ppt/editor';
import type { TextCapsStyle, TextStrikeStyle, TextUnderlineStyle } from '@web-ppt/core';
import { queryElementPresetGeometry } from '@web-ppt/edit-core';
import type { PresetAdjustmentEditor } from '@web-ppt/editor/adjustments';
import { colorInputValue } from './editor-color-input';

interface InspectorContext {
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  readonly writable: boolean;
  readonly adjustments: PresetAdjustmentEditor | null;
}

export interface EditorInspector {
  readonly element: HTMLElement;
  sync(): void;
}

type Notice = (message: string, tone?: 'normal' | 'success' | 'error') => void;
type BulletInput = NonNullable<ParagraphPropertyInput['bullet']>;
type AutoNumberBullet = Extract<BulletInput, { readonly kind: 'autoNum' }>;
const $ = <T extends Element>(root: ParentNode, selector: string): T => root.querySelector<T>(selector)!;

export function createEditorInspector(
  element: HTMLElement,
  context: () => InspectorContext,
  notice: Notice,
): EditorInspector {
  const textSection = $<HTMLElement>(element, '#textInspector');
  const shapeSection = $<HTMLElement>(element, '#shapeInspector');
  const imageSection = $<HTMLElement>(element, '#imageInspector');
  const linkSection = $<HTMLElement>(element, '#linkInspector');
  const empty = $<HTMLElement>(element, '#inspectorEmpty');
  const textBold = $<HTMLButtonElement>(element, '#textBold');
  const textItalic = $<HTMLButtonElement>(element, '#textItalic');
  const textUnderline = $<HTMLButtonElement>(element, '#textUnderline');
  const textStrike = $<HTMLButtonElement>(element, '#textStrike');
  const textClearFormat = $<HTMLButtonElement>(element, '#textClearFormat');
  const textSize = $<HTMLInputElement>(element, '#textFontSize');
  const textColor = $<HTMLInputElement>(element, '#textColor');
  const textUnderlineStyle = $<HTMLSelectElement>(element, '#textUnderlineStyle');
  const textStrikeStyle = $<HTMLSelectElement>(element, '#textStrikeStyle');
  const textHighlightEnabled = $<HTMLInputElement>(element, '#textHighlightEnabled');
  const textHighlight = $<HTMLInputElement>(element, '#textHighlight');
  const textSpacing = $<HTMLInputElement>(element, '#textSpacing');
  const textCaps = $<HTMLSelectElement>(element, '#textCaps');
  const textBaseline = $<HTMLInputElement>(element, '#textBaseline');
  const textAlign = $<HTMLSelectElement>(element, '#textAlign');
  const bulletKind = $<HTMLSelectElement>(element, '#textBulletKind');
  const bulletChar = $<HTMLInputElement>(element, '#textBulletChar');
  const bulletScheme = $<HTMLSelectElement>(element, '#textBulletScheme');
  const bulletStart = $<HTMLInputElement>(element, '#textBulletStart');
  const bulletFont = $<HTMLInputElement>(element, '#textBulletFont');
  const bulletColorEnabled = $<HTMLInputElement>(element, '#textBulletColorEnabled');
  const bulletColor = $<HTMLInputElement>(element, '#textBulletColor');
  const bulletSizeKind = $<HTMLSelectElement>(element, '#textBulletSizeKind');
  const bulletSize = $<HTMLInputElement>(element, '#textBulletSize');
  const bulletImage = $<HTMLInputElement>(element, '#textBulletImageInput');
  const fillType = $<HTMLSelectElement>(element, '#shapeFillType');
  const shapePreset = $<HTMLSelectElement>(element, '#shapePreset');
  const startShapeAdjustments = $<HTMLButtonElement>(element, '#startShapeAdjustments');
  const fillColor = $<HTMLInputElement>(element, '#shapeFillColor');
  const strokeType = $<HTMLSelectElement>(element, '#shapeStrokeType');
  const strokeColor = $<HTMLInputElement>(element, '#shapeStrokeColor');
  const strokeWidth = $<HTMLInputElement>(element, '#shapeStrokeWidth');
  const shadow = $<HTMLInputElement>(element, '#shapeShadow');
  const glow = $<HTMLInputElement>(element, '#shapeGlow');
  const softEdge = $<HTMLInputElement>(element, '#shapeSoftEdge');
  const replaceImage = $<HTMLInputElement>(element, '#replaceImageInput');
  const linkType = $<HTMLSelectElement>(element, '#linkType');
  const linkHref = $<HTMLInputElement>(element, '#linkHref');
  const linkSlide = $<HTMLSelectElement>(element, '#linkSlide');
  const linkHrefField = $<HTMLElement>(element, '#linkHrefField');
  const linkSlideField = $<HTMLElement>(element, '#linkSlideField');

  const act = async (action: () => void | Promise<void>): Promise<void> => {
    try { await action(); } catch (error) {
      notice(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const selectedId = (): string | null => {
    const selection = context().session?.editor.selection;
    return selection?.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
  };

  const selectedKind = (): string | null => {
    const { session } = context();
    const id = selectedId();
    return id && session ? session.editor.doc.elements[id]?.src.kind ?? null : null;
  };

  const syncBulletFields = (): void => {
    const kind = bulletKind.value;
    $<HTMLElement>(element, '#textBulletCharField').hidden = kind !== 'char';
    $<HTMLElement>(element, '#textBulletSchemeField').hidden = kind !== 'autoNum';
    $<HTMLElement>(element, '#textBulletStartField').hidden = kind !== 'autoNum';
    $<HTMLElement>(element, '#textBulletSizeField').hidden = bulletSizeKind.value === 'inherit';
    bulletColor.disabled = bulletKind.disabled || !bulletColorEnabled.checked;
  };

  const syncText = (): boolean => {
    const { view, writable } = context();
    const run = view?.queryRunProps() ?? null;
    textSection.hidden = !run;
    if (!run) return false;
    for (const [button, state] of [
      [textBold, run.b], [textItalic, run.i], [textUnderline, run.u], [textStrike, run.strike],
    ] as const) {
      button.disabled = !writable;
      button.setAttribute('aria-pressed', String(!state.mixed && state.value === true));
      button.dataset.mixed = String(state.mixed);
    }
    textSize.disabled = !writable;
    textSize.value = run.size.value === null ? '' : String(run.size.value);
    textColor.disabled = !writable;
    textColor.value = colorInputValue(run.color.value ?? undefined);
    textUnderlineStyle.dataset.mixed = String(run.underline.mixed);
    textUnderlineStyle.value = run.underline.mixed ? '' : run.underline.value ?? 'none';
    textStrikeStyle.dataset.mixed = String(run.strikeType.mixed);
    textStrikeStyle.value = run.strikeType.mixed ? '' : run.strikeType.value ?? 'noStrike';
    textHighlightEnabled.dataset.mixed = String(run.highlight.mixed);
    textHighlightEnabled.checked = !run.highlight.mixed && run.highlight.value !== null;
    textHighlight.value = colorInputValue(run.highlight.value ?? undefined, '#fff176');
    textSpacing.value = run.spacing.mixed ? '' : String(run.spacing.value ?? 0);
    textCaps.dataset.mixed = String(run.caps.mixed);
    textCaps.value = run.caps.mixed ? '' : run.caps.value ?? 'none';
    textBaseline.value = run.baseline.mixed ? '' : String(run.baseline.value ?? 0);
    for (const control of [
      textUnderlineStyle, textStrikeStyle, textHighlightEnabled, textSpacing, textCaps, textBaseline,
      textClearFormat,
    ]) control.disabled = !writable;
    textHighlight.disabled = !writable || !textHighlightEnabled.checked;
    const paragraph = view?.queryParaProps();
    textAlign.disabled = !writable || !paragraph;
    if (paragraph?.align.value) textAlign.value = paragraph.align.value;
    const bullet = paragraph?.bullet.value;
    bulletKind.dataset.mixed = String(!!paragraph?.bullet.mixed);
    bulletKind.value = paragraph?.bullet.mixed ? 'mixed'
      : bullet?.kind === 'blip' ? 'image' : bullet?.kind ?? 'none';
    if (bullet?.kind === 'char') bulletChar.value = bullet.char;
    if (bullet?.kind === 'autoNum') {
      if ([...bulletScheme.options].some((option) => option.value === bullet.type)) {
        bulletScheme.value = bullet.type;
      }
      bulletStart.value = String(bullet.startAt ?? 1);
    }
    const styled = bullet && bullet.kind !== 'none' ? bullet : null;
    bulletFont.value = styled?.font ?? '';
    bulletColorEnabled.checked = !!styled?.color;
    bulletColor.value = colorInputValue(styled?.color ?? undefined);
    bulletSizeKind.value = styled?.size?.kind ?? 'inherit';
    bulletSize.value = styled?.size
      ? String(styled.size.kind === 'percent' ? styled.size.value * 100 : styled.size.value)
      : '100';
    for (const control of [
      bulletKind, bulletChar, bulletScheme, bulletStart, bulletFont, bulletColorEnabled,
      bulletSizeKind, bulletSize, bulletImage,
    ]) control.disabled = !writable || !paragraph;
    syncBulletFields();
    return true;
  };

  const syncShape = (): boolean => {
    const { session, writable, adjustments } = context();
    const id = selectedKind() === 'shape' ? selectedId() : null;
    if (adjustments?.elementId && adjustments.elementId !== id) adjustments.end();
    shapeSection.hidden = !id;
    if (!session || !id) return false;
    const preset = queryElementPresetGeometry(session.editor.doc, [id]).value;
    if (preset) shapePreset.value = preset.preset;
    else shapePreset.selectedIndex = -1;
    shapePreset.disabled = !writable;
    startShapeAdjustments.disabled = !writable || !preset;
    const fill = queryElementFill(session.editor.doc, [id]).value;
    fillType.value = fill?.type === 'none' ? 'none' : fill?.type === 'solid' ? 'solid' : 'preserve';
    fillColor.value = colorInputValue(fill?.type === 'solid' ? fill.color : undefined);
    const stroke = queryElementStroke(session.editor.doc, [id]).value;
    strokeType.value = stroke ? 'solid' : 'none';
    strokeColor.value = colorInputValue(stroke?.color);
    strokeWidth.value = String(stroke?.width ?? 1);
    const effects = queryElementEffects(session.editor.doc, [id]).value;
    shadow.checked = !!effects.shadow;
    glow.checked = !!effects.glow;
    softEdge.value = String(effects.softEdge ?? 0);
    for (const control of [fillType, strokeType, strokeColor, strokeWidth, shadow, glow, softEdge]) {
      control.disabled = !writable;
    }
    fillColor.disabled = !writable || fillType.value === 'preserve';
    return true;
  };

  const syncImage = (): boolean => {
    const { session } = context();
    const selected = selectedId();
    const record = selected ? session?.editor.doc.elements[selected] : undefined;
    const id = record?.src.kind === 'image' && !record.src.media && record.meta.editable === 'full'
      ? record.id : null;
    const image = !!id;
    imageSection.hidden = !image;
    for (const control of imageSection.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) {
      control.disabled = !context().writable || !!record?.meta.locked;
    }
    if (session && id) {
      const crop = queryElementCrop(session.editor.doc, [id]).value;
      $<HTMLButtonElement>(element, '#cropImageTen').setAttribute('aria-pressed', String(
        !!crop && [crop.l, crop.t, crop.r, crop.b].every((value) => Math.abs(value - .1) < 1e-6),
      ));
    }
    return image;
  };

  const syncLinkFields = (): void => {
    linkHrefField.hidden = linkType.value !== 'external';
    linkSlideField.hidden = linkType.value !== 'slide';
  };

  const syncLink = (): boolean => {
    const { session, view, writable } = context();
    const selection = session?.editor.selection;
    const id = selectedId();
    let state = selection?.kind === 'text' ? view?.queryRunLink() ?? null : null;
    if (!state && session && id && ['shape', 'image', 'group'].includes(selectedKind() ?? '')) {
      state = queryElementLink(session.editor.doc, [id]);
    }
    linkSection.hidden = !state;
    if (!session || !state) return false;
    linkSlide.replaceChildren(...session.editor.doc.slideOrder.map((slideId, index) => {
      const option = document.createElement('option');
      option.value = slideId;
      option.textContent = `第 ${index + 1} 页`;
      return option;
    }));
    const value = state.value;
    linkType.value = value?.kind ?? 'none';
    linkHref.value = value?.kind === 'external' ? value.href : '';
    if (value?.kind === 'slide') linkSlide.value = value.slideId;
    for (const control of [linkType, linkHref, linkSlide, $<HTMLButtonElement>(element, '#applyLink')]) {
      control.disabled = !writable || state.sourceReadonly;
    }
    $<HTMLButtonElement>(element, '#followLink').disabled = !state.followable;
    syncLinkFields();
    return true;
  };

  const sync = (): void => {
    const contexts = [syncText(), syncShape(), syncImage(), syncLink()];
    empty.hidden = contexts.some(Boolean);
  };

  const setRunBoolean = (field: 'b' | 'i' | 'u' | 'strike'): void => void act(() => {
    const { view } = context();
    const state = view?.queryRunProps()?.[field];
    if (state && view?.setRunProps({ [field]: state.mixed || !state.value })) sync();
  });
  textBold.addEventListener('click', () => setRunBoolean('b'));
  textItalic.addEventListener('click', () => setRunBoolean('i'));
  textUnderline.addEventListener('click', () => setRunBoolean('u'));
  textStrike.addEventListener('click', () => setRunBoolean('strike'));
  textClearFormat.addEventListener('click', () => void act(() => {
    if (context().view?.clearFormat()) sync();
  }));
  textSize.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({ size: Number(textSize.value) })) sync();
  }));
  textColor.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({ color: textColor.value })) sync();
  }));
  textUnderlineStyle.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({
      underline: textUnderlineStyle.value as TextUnderlineStyle,
    })) sync();
  }));
  textStrikeStyle.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({
      strikeType: textStrikeStyle.value as TextStrikeStyle,
    })) sync();
  }));
  const setHighlight = (): void => void act(() => {
    textHighlight.disabled = !context().writable || !textHighlightEnabled.checked;
    if (context().view?.setRunProps({
      highlight: textHighlightEnabled.checked ? textHighlight.value : null,
    })) sync();
  });
  textHighlightEnabled.addEventListener('change', setHighlight);
  textHighlight.addEventListener('change', setHighlight);
  textSpacing.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({ spacing: Number(textSpacing.value) })) sync();
  }));
  textCaps.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({ caps: textCaps.value as TextCapsStyle })) sync();
  }));
  textBaseline.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({ baseline: Number(textBaseline.value) })) sync();
  }));
  textAlign.addEventListener('change', () => void act(() => {
    if (context().view?.setParaProps({ align: textAlign.value as 'left' | 'center' | 'right' | 'justify' })) sync();
  }));

  const bulletStyle = (): Pick<AutoNumberBullet, 'font' | 'color' | 'size'> => ({
    ...(bulletFont.value.trim() ? { font: bulletFont.value.trim() } : {}),
    ...(bulletColorEnabled.checked ? { color: bulletColor.value } : {}),
    ...(bulletSizeKind.value === 'percent'
      ? { size: { kind: 'percent', value: Number(bulletSize.value) / 100 } as const }
      : bulletSizeKind.value === 'points'
        ? { size: { kind: 'points', value: Number(bulletSize.value) } as const } : {}),
  });
  const setBullet = (): void => void act(() => {
    const { view } = context();
    if (!view || bulletKind.value === 'mixed') return;
    let bullet: ParagraphPropertyInput['bullet'];
    if (bulletKind.value === 'inherit') bullet = null;
    else if (bulletKind.value === 'none') bullet = { kind: 'none' };
    else if (bulletKind.value === 'char') {
      const char = Array.from(bulletChar.value);
      if (char.length !== 1) throw new Error('项目符号必须是一个字符');
      bullet = { kind: 'char', char: char[0], ...bulletStyle() };
    } else if (bulletKind.value === 'image') {
      const current = view.queryParaProps()?.bullet.value;
      if (current?.kind !== 'blip') return;
      bullet = { kind: 'blip', image: current.image, ...bulletStyle() };
    } else bullet = {
      kind: 'autoNum', type: bulletScheme.value as AutoNumberBullet['type'],
      startAt: Number(bulletStart.value), ...bulletStyle(),
    };
    if (view.setParaProps({ bullet })) sync();
  });
  for (const control of [
    bulletKind, bulletChar, bulletScheme, bulletStart, bulletFont,
    bulletColorEnabled, bulletColor, bulletSizeKind, bulletSize,
  ]) control.addEventListener('change', () => {
    syncBulletFields();
    setBullet();
  });
  bulletImage.addEventListener('change', () => void act(async () => {
    const file = bulletImage.files?.[0]; const { view } = context();
    if (!file || !view) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      throw new Error('图片项目符号仅支持 PNG、JPEG、GIF 或 WebP');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = { bytes, mime: file.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' };
    if (view.setParaProps({ bullet: { kind: 'blip', image, ...bulletStyle() } })) sync();
    bulletImage.value = '';
  }));

  const setFill = (): void => void act(() => {
    const { session } = context(); const id = selectedId();
    if (!session || !id || fillType.value === 'preserve') return;
    session.editor.exec({
      type: 'SetFill', id,
      fill: fillType.value === 'none' ? { type: 'none' } : { type: 'solid', color: fillColor.value },
    });
    sync(); notice('已更新形状填充', 'success');
  });
  fillType.addEventListener('change', setFill);
  fillColor.addEventListener('change', setFill);

  shapePreset.addEventListener('change', () => void act(() => {
    const { adjustments } = context();
    if (!adjustments?.setPreset(shapePreset.value)) return;
    sync(); notice('已切换形状类型；原有文字和格式保持不变', 'success');
  }));
  startShapeAdjustments.addEventListener('click', () => void act(() => {
    const { adjustments } = context();
    const id = selectedId();
    if (!adjustments || !id || !adjustments.start(id)) throw new Error('当前形状没有可用的预设调节柄');
    notice(adjustments.handles.length
      ? '拖动形状上的橙色圆点来调整外观'
      : '当前形状没有可调参数');
  }));

  const setStroke = (): void => void act(() => {
    const { session } = context(); const id = selectedId();
    if (!session || !id) return;
    const current = queryElementStroke(session.editor.doc, [id]).value;
    session.editor.exec({
      type: 'SetStroke', id,
      stroke: strokeType.value === 'none' ? { type: 'none' } : {
        ...(current ?? { dash: null }), color: strokeColor.value, width: Number(strokeWidth.value),
      },
    });
    sync(); notice('已更新形状描边', 'success');
  });
  strokeType.addEventListener('change', setStroke);
  strokeColor.addEventListener('change', setStroke);
  strokeWidth.addEventListener('change', setStroke);

  const setEffects = (): void => void act(() => {
    const { session } = context(); const id = selectedId();
    if (!session || !id) return;
    const current = queryElementEffects(session.editor.doc, [id]).value;
    const effects = { ...current };
    if (shadow.checked) effects.shadow ??= {
      dx: 4, dy: 4, blur: 6, color: 'rgba(0,0,0,0.35)', inner: false,
    };
    else delete effects.shadow;
    if (glow.checked) effects.glow ??= { radius: 5, color: '#2563eb' };
    else delete effects.glow;
    if (Number(softEdge.value) > 0) effects.softEdge = Number(softEdge.value);
    else delete effects.softEdge;
    session.editor.exec({ type: 'SetEffects', id, effects });
    sync(); notice('已更新形状效果', 'success');
  });
  shadow.addEventListener('change', setEffects);
  glow.addEventListener('change', setEffects);
  softEdge.addEventListener('change', setEffects);

  replaceImage.addEventListener('change', () => void act(async () => {
    const file = replaceImage.files?.[0];
    if (!file || !context().view) return;
    await context().view!.replaceImage(file);
    replaceImage.value = '';
    notice('图片已替换', 'success');
  }));
  $<HTMLButtonElement>(element, '#startImageCrop').addEventListener('click', () => {
    if (context().view?.startImageCrop()) notice('拖动图片内的裁剪框，完成后点击“完成裁剪”');
  });
  $<HTMLButtonElement>(element, '#finishImageCrop').addEventListener('click', () => context().view?.endImageCrop());
  $<HTMLButtonElement>(element, '#cropImageTen').addEventListener('click', () => void act(() => {
    const { session } = context(); const id = selectedId();
    if (session && id) session.editor.exec({ type: 'SetCrop', id, crop: { l: .1, t: .1, r: .1, b: .1 } });
  }));
  $<HTMLButtonElement>(element, '#resetImageCrop').addEventListener('click', () => void act(() => {
    const { session } = context(); const id = selectedId();
    if (session && id) session.editor.exec({ type: 'SetCrop', id, crop: null });
  }));

  linkType.addEventListener('change', syncLinkFields);
  $<HTMLButtonElement>(element, '#applyLink').addEventListener('click', () => void act(() => {
    const { session, view } = context(); const id = selectedId();
    if (!session || !view) return;
    const target: LinkTarget | { kind: 'none' } = linkType.value === 'external'
      ? { kind: 'external', href: linkHref.value }
      : linkType.value === 'slide' ? { kind: 'slide', slideId: linkSlide.value } : { kind: 'none' };
    if (session.editor.selection.kind === 'text') view.setRunProps({ link: target });
    else if (id) session.editor.exec({ type: 'SetLink', id, target });
    sync(); notice('超链接已更新', 'success');
  }));
  $<HTMLButtonElement>(element, '#followLink').addEventListener('click', () => context().view?.followLink());

  sync();
  return { element, sync };
}
