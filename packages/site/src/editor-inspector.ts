import {
  queryElementEffects,
  queryElementCrop,
  queryElementFill,
  queryElementLink,
  queryElementStroke,
  type EditorSession,
  type LinkTarget,
  type SlideEditor,
} from '@web-ppt/editor';

interface InspectorContext {
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  readonly writable: boolean;
}

export interface EditorInspector {
  readonly element: HTMLElement;
  sync(): void;
}

type Notice = (message: string, tone?: 'normal' | 'success' | 'error') => void;
const $ = <T extends Element>(root: ParentNode, selector: string): T => root.querySelector<T>(selector)!;

function colorInputValue(value: string | undefined, fallback = '#000000'): string {
  if (!value) return fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) return `#${hex.toLowerCase()}`;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) return fallback;
  return `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

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
  const textSize = $<HTMLInputElement>(element, '#textFontSize');
  const textColor = $<HTMLInputElement>(element, '#textColor');
  const textAlign = $<HTMLSelectElement>(element, '#textAlign');
  const fillType = $<HTMLSelectElement>(element, '#shapeFillType');
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

  const syncText = (): boolean => {
    const { view, writable } = context();
    const run = view?.queryRunProps() ?? null;
    textSection.hidden = !run;
    if (!run) return false;
    for (const [button, state] of [
      [textBold, run.b], [textItalic, run.i], [textUnderline, run.u],
    ] as const) {
      button.disabled = !writable;
      button.setAttribute('aria-pressed', String(!state.mixed && state.value === true));
      button.dataset.mixed = String(state.mixed);
    }
    textSize.disabled = !writable;
    textSize.value = run.size.value === null ? '' : String(run.size.value);
    textColor.disabled = !writable;
    textColor.value = colorInputValue(run.color.value ?? undefined);
    const paragraph = view?.queryParaProps();
    textAlign.disabled = !writable || !paragraph;
    if (paragraph?.align.value) textAlign.value = paragraph.align.value;
    return true;
  };

  const syncShape = (): boolean => {
    const { session, writable } = context();
    const id = selectedKind() === 'shape' ? selectedId() : null;
    shapeSection.hidden = !id;
    if (!session || !id) return false;
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
    const id = selectedKind() === 'image' ? selectedId() : null;
    const image = !!id;
    imageSection.hidden = !image;
    for (const control of imageSection.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) {
      control.disabled = !context().writable;
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

  const setRunBoolean = (field: 'b' | 'i' | 'u'): void => void act(() => {
    const { view } = context();
    const state = view?.queryRunProps()?.[field];
    if (state && view?.setRunProps({ [field]: state.mixed || !state.value })) sync();
  });
  textBold.addEventListener('click', () => setRunBoolean('b'));
  textItalic.addEventListener('click', () => setRunBoolean('i'));
  textUnderline.addEventListener('click', () => setRunBoolean('u'));
  textSize.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({ size: Number(textSize.value) })) sync();
  }));
  textColor.addEventListener('change', () => void act(() => {
    if (context().view?.setRunProps({ color: textColor.value })) sync();
  }));
  textAlign.addEventListener('change', () => void act(() => {
    if (context().view?.setParaProps({ align: textAlign.value as 'left' | 'center' | 'right' | 'justify' })) sync();
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
