import {
  ANIMATION_EFFECTS,
  SLIDE_TRANSITION_TYPES,
  animationEffectsForKind,
  querySlideBackground,
  querySlideHidden,
  transitionDirections,
  type EditAnimationStep,
  type EditorSession,
  type SlideEditor,
} from '@web-ppt/editor';

interface SlideInspectorContext {
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  readonly writable: boolean;
  showSlide(id: string): void;
}

export interface SlideInspector { sync(): void; }
type Notice = (message: string, tone?: 'normal' | 'success' | 'error') => void;
const $ = <T extends Element>(root: ParentNode, selector: string): T => root.querySelector<T>(selector)!;

function colorValue(value: string | undefined): string {
  const rgb = value && /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgb) return `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
  return /^#[0-9a-f]{6}$/i.test(value ?? '') ? value!.toLowerCase() : '#ffffff';
}

export function createSlideInspector(
  root: HTMLElement,
  context: () => SlideInspectorContext,
  notice: Notice,
): SlideInspector {
  const background = $<HTMLInputElement>(root, '#slideBackgroundColor');
  const hidden = $<HTMLInputElement>(root, '#slideHidden');
  const layout = $<HTMLSelectElement>(root, '#slideLayout');
  const duplicate = $<HTMLButtonElement>(root, '#duplicateSlide');
  const remove = $<HTMLButtonElement>(root, '#deleteSlide');
  const notes = $<HTMLTextAreaElement>(root, '#slideNotes');
  const applyNotes = $<HTMLButtonElement>(root, '#applyNotes');
  const transitionType = $<HTMLSelectElement>(root, '#transitionType');
  const transitionDirection = $<HTMLSelectElement>(root, '#transitionDirection');
  const transitionDuration = $<HTMLInputElement>(root, '#transitionDuration');
  const animationTarget = $<HTMLSelectElement>(root, '#animationTarget');
  const animationKind = $<HTMLSelectElement>(root, '#animationKind');
  const animationEffect = $<HTMLSelectElement>(root, '#animationEffect');
  const timeline = $<HTMLOListElement>(root, '#animationTimeline');
  const animationReadonly = $<HTMLElement>(root, '#animationReadonly');

  transitionType.replaceChildren(...SLIDE_TRANSITION_TYPES.map((type) => {
    const option = document.createElement('option'); option.value = type; option.textContent = type; return option;
  }));

  const act = async (action: () => void | Promise<void>): Promise<void> => {
    try { await action(); } catch (error) {
      notice(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const syncDirections = (): void => {
    const directions = transitionDirections(transitionType.value as Parameters<typeof transitionDirections>[0]);
    const previous = transitionDirection.value;
    transitionDirection.replaceChildren(...[
      ['', '默认'], ...directions.map((value) => [value, value] as const),
    ].map(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
    }));
    if (directions.includes(previous)) transitionDirection.value = previous;
    transitionDirection.disabled = !directions.length || !context().writable;
    transitionDuration.disabled = transitionType.value === 'none' || !context().writable;
  };

  const syncEffects = (): void => {
    const kind = animationKind.value as 'entrance' | 'exit' | 'emphasis';
    const effects = animationEffectsForKind(kind);
    const previous = animationEffect.value;
    animationEffect.replaceChildren(...effects.map((effect) => {
      const option = document.createElement('option'); option.value = effect; option.textContent = effect; return option;
    }));
    if (effects.includes(previous as typeof ANIMATION_EFFECTS[number])) animationEffect.value = previous;
  };

  const animationName = (step: EditAnimationStep, index: number): string => {
    const record = context().session?.editor.doc.elements[step.target];
    const effect = step.kind === 'motion' ? 'motion' : step.effect;
    return `${index + 1}. ${record?.ovr.name ?? record?.src.name ?? step.target} · ${step.kind}/${effect}`;
  };

  const setTimeline = (steps: readonly EditAnimationStep[]): void => {
    if (context().view?.setAnimations(steps)) {
      sync(); notice('动画时间线已更新', 'success');
    }
  };

  const renderTimeline = (steps: readonly EditAnimationStep[], editable: boolean): void => {
    timeline.replaceChildren(...steps.map((step, index) => {
      const item = document.createElement('li');
      item.dataset.animationIndex = String(index);
      const label = document.createElement('span'); label.textContent = animationName(step, index);
      const actions = document.createElement('span');
      for (const [text, action] of [
        ['↑', () => { if (index) setTimeline([...steps.slice(0, index - 1), step, steps[index - 1], ...steps.slice(index + 1)]); }],
        ['↓', () => { if (index < steps.length - 1) setTimeline([...steps.slice(0, index), steps[index + 1], step, ...steps.slice(index + 2)]); }],
        ['×', () => setTimeline(steps.filter((_, candidate) => candidate !== index))],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = text; button.disabled = !editable;
        button.addEventListener('click', action); actions.append(button);
      }
      item.append(label, actions); return item;
    }));
  };

  const sync = (): void => {
    const { session, view, writable } = context();
    if (!session || !view) return;
    const slideId = view.slideId;
    const fill = querySlideBackground(session.editor.doc, [slideId]).value;
    background.value = colorValue(fill?.type === 'solid' ? fill.color : undefined);
    hidden.checked = querySlideHidden(session.editor.doc, [slideId]).value;
    layout.replaceChildren(...session.editor.doc.layoutOrder.map((id, index) => {
      const option = document.createElement('option'); option.value = id;
      option.textContent = session.editor.doc.layouts[id]?.name || `版式 ${index + 1}`;
      return option;
    }));
    const layoutState = view.queryLayout();
    if (layoutState.value) layout.value = layoutState.value;
    notes.value = view.queryNotes().value;
    const transition = view.queryTransition().value;
    transitionType.value = transition?.type ?? 'none';
    transitionDuration.value = String(transition?.durationMs || 750);
    syncDirections();
    if (transition?.dir) transitionDirection.value = transition.dir;
    const slide = session.editor.doc.slides[slideId];
    const targets: string[] = [];
    const visit = (id: string): void => {
      const record = session.editor.doc.elements[id];
      if (!record) return;
      if (record.meta.editable !== 'none') targets.push(id);
      for (const child of record.children ?? []) visit(child);
    };
    for (const id of slide.children) visit(id);
    animationTarget.replaceChildren(...targets.map((id) => {
      const option = document.createElement('option'); option.value = id;
      const record = session.editor.doc.elements[id]; option.textContent = record.ovr.name ?? record.src.name ?? id;
      return option;
    }));
    const animationState = view.queryAnimations();
    const animationEditable = writable && !animationState.sourceReadonly;
    animationReadonly.hidden = !animationState.sourceReadonly;
    renderTimeline(animationState.value, animationEditable);
    for (const control of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      '#slideInspector button,#slideInspector input,#slideInspector select,#notesInspector button,#notesInspector textarea,#transitionInspector button,#transitionInspector input,#transitionInspector select,#animationInspector button,#animationInspector select',
    )) control.disabled = !writable;
    for (const control of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
      '#animationInspector button,#animationInspector select',
    )) control.disabled = !animationEditable;
    $<HTMLButtonElement>(root, '#previewTimeline').disabled = false;
    remove.disabled = !writable || session.editor.doc.slideOrder.length <= 1;
    syncDirections();
  };

  background.addEventListener('change', () => void act(() => {
    const { session, view } = context();
    if (session && view) session.editor.exec({ type: 'SetBackground', id: view.slideId, fill: { type: 'solid', color: background.value } });
  }));
  hidden.addEventListener('change', () => void act(() => {
    const { session, view } = context();
    if (session && view) session.editor.exec({ type: 'SetHidden', id: view.slideId, v: hidden.checked });
  }));
  layout.addEventListener('change', () => void act(() => { context().view?.setLayout(layout.value); }));
  duplicate.addEventListener('click', () => void act(() => {
    const { session, view } = context(); if (!session || !view) return;
    const result = session.editor.exec({ type: 'DuplicateSlide', id: view.slideId });
    const id = [...result.createdSlides][0]; if (id) context().showSlide(id);
  }));
  remove.addEventListener('click', () => void act(() => {
    const { session, view } = context(); if (!session || !view) return;
    const order = session.editor.doc.slideOrder; const index = order.indexOf(view.slideId);
    const next = order[index + 1] ?? order[index - 1];
    session.editor.exec({ type: 'RemoveSlide', id: view.slideId });
    if (next) context().showSlide(next);
  }));
  applyNotes.addEventListener('click', () => void act(() => {
    if (context().view?.setNotes(notes.value)) notice('备注已保存', 'success');
  }));
  transitionType.addEventListener('change', syncDirections);
  $<HTMLButtonElement>(root, '#applyTransition').addEventListener('click', () => void act(() => {
    const value = transitionType.value === 'none' ? { type: 'none' as const } : {
      type: transitionType.value as Exclude<Parameters<SlideEditor['setTransition']>[0], null>['type'],
      durationMs: Number(transitionDuration.value),
      ...(transitionDirection.value ? { dir: transitionDirection.value } : {}),
    };
    if (context().view?.setTransition(value)) { sync(); notice('页面切换已更新', 'success'); }
  }));
  $<HTMLButtonElement>(root, '#previewTransition').addEventListener('click', () => void act(async () => {
    await context().view?.previewTransition();
  }));
  animationKind.addEventListener('change', syncEffects);
  $<HTMLButtonElement>(root, '#addAnimation').addEventListener('click', () => void act(() => {
    const view = context().view; if (!view || !animationTarget.value) return;
    const kind = animationKind.value as 'entrance' | 'exit' | 'emphasis';
    const step = {
      target: animationTarget.value, kind, effect: animationEffect.value,
      trigger: 'click', delayMs: 0, durationMs: 600,
    } as EditAnimationStep;
    setTimeline([...view.queryAnimations().value, step]);
  }));
  $<HTMLButtonElement>(root, '#previewTimeline').addEventListener('click', () => void act(async () => {
    await context().view?.previewAnimations();
  }));

  syncEffects();
  return { sync };
}
