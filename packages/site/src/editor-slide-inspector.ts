import {
  animationEffectsForKind,
  querySlideBackground,
  querySlideHidden,
  transitionDirections,
  type EditAnimationStep,
  type EditorSession,
  type SlideEditor,
} from '@web-ppt/editor';
import { message, type SiteNotice, type SiteMessage } from './i18n/message';
import { setMessage, setAttributeText } from './i18n/runtime';
import { colorInputValue } from './editor-color-input';

interface SlideInspectorContext {
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  readonly writable: boolean;
  showSlide(id: string): void;
}

export interface SlideInspector { sync(): void; }
const $ = <T extends Element>(root: ParentNode, selector: string): T => root.querySelector<T>(selector)!;

export function createSlideInspector(
  root: HTMLElement,
  context: () => SlideInspectorContext,
  notice: SiteNotice,
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
  const directionOptions = new Map([...transitionDirection.options].map((option) => [option.value, option]));
  const effectOptions = new Map([...animationEffect.options].map((option) => [option.value, option]));

  const act = async (action: () => void | Promise<void>): Promise<void> => {
    try { await action(); } catch (error) {
      notice(message('页面操作失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error');
    }
  };

  const syncDirections = (): void => {
    const directions = transitionDirections(transitionType.value as Parameters<typeof transitionDirections>[0]);
    const previous = transitionDirection.value;
    transitionDirection.replaceChildren(...['', ...directions].map((value) => directionOptions.get(value)!));
    transitionDirection.value = directions.includes(previous) ? previous : '';
    transitionDirection.disabled = !directions.length || !context().writable;
    transitionDuration.disabled = transitionType.value === 'none' || !context().writable;
  };

  const syncEffects = (): void => {
    const kind = animationKind.value as 'entrance' | 'exit' | 'emphasis';
    const effects = animationEffectsForKind(kind);
    const previous = animationEffect.value;
    animationEffect.replaceChildren(...effects.map((effect) => effectOptions.get(effect)!));
    animationEffect.value = effects.some((effect) => effect === previous) ? previous : effects[0];
  };

  const animationName = (step: EditAnimationStep, index: number): SiteMessage => {
    const record = context().session?.editor.doc.elements[step.target];
    const name = record?.ovr.name ?? record?.src.name ?? step.target;
    if (step.kind === 'motion') return message('{index}. {name} · 运动路径', { index: index + 1, name });
    return message('{index}. {name} · {kind}/{effect}', { index: index + 1, name,
      kind: message(({ entrance: '进入', exit: '退出', emphasis: '强调' } as const)[step.kind]),
      effect: message(({ appear: '出现', fade: '淡化', fly: '飞行', wipe: '擦除', zoom: '缩放',
        dissolve: '溶解', spin: '旋转', grow: '放大/缩小' } as const)[step.effect]),
    });
  };

  const setTimeline = (steps: readonly EditAnimationStep[]): void => {
    if (context().view?.setAnimations(steps)) {
      notice(message('动画时间线已更新'), 'success');
    }
  };

  const renderTimeline = (steps: readonly EditAnimationStep[], editable: boolean): void => {
    const move = (index: number, offset: number): void => {
      const target = index + offset;
      if (target < 0 || target >= steps.length) return;
      const next = [...steps];
      [next[index], next[target]] = [next[target], next[index]];
      setTimeline(next);
    };
    timeline.replaceChildren(...steps.map((step, index) => {
      const item = document.createElement('li');
      item.dataset.animationIndex = String(index);
      const name = animationName(step, index);
      const label = document.createElement('span'); setMessage(label, name);
      const actions = document.createElement('span');
      for (const [text, source, action] of [
        ['↑', '上移动画：{name}', () => move(index, -1)],
        ['↓', '下移动画：{name}', () => move(index, 1)],
        ['×', '删除动画：{name}', () => setTimeline(steps.filter((_, candidate) => candidate !== index))],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = text; button.disabled = !editable;
        setAttributeText(button, 'aria-label', source, { name });
        button.addEventListener('click', () => void act(action)); actions.append(button);
      }
      item.append(label, actions); return item;
    }));
  };

  const sync = (): void => {
    const { session, view, writable } = context();
    if (!session || !view) return;
    const slideId = view.slideId;
    const fill = querySlideBackground(session.editor.doc, [slideId]).value;
    background.value = colorInputValue(fill?.type === 'solid' ? fill.color : undefined, '#ffffff');
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
      ':is(#slideInspector,#notesInspector,#transitionInspector,#animationInspector) :is(button,input,select,textarea)',
    )) control.disabled = !writable;
    for (const control of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
      '#animationInspector button,#animationInspector select',
    )) control.disabled = !animationEditable;
    $<HTMLButtonElement>(root, '#previewTimeline').disabled = false;
    remove.disabled = !writable || session.editor.doc.slideOrder.length <= 1;
    syncDirections();
    if (transition?.dir) transitionDirection.value = transition.dir;
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
    if (context().view?.setNotes(notes.value)) notice(message('备注已保存'), 'success');
  }));
  transitionType.addEventListener('change', syncDirections);
  $<HTMLButtonElement>(root, '#applyTransition').addEventListener('click', () => void act(() => {
    const value = transitionType.value === 'none' ? { type: 'none' as const } : {
      type: transitionType.value as Exclude<Parameters<SlideEditor['setTransition']>[0], null>['type'],
      durationMs: Number(transitionDuration.value),
      ...(transitionDirection.value ? { dir: transitionDirection.value } : {}),
    };
    if (context().view?.setTransition(value)) notice(message('页面切换已更新'), 'success');
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
