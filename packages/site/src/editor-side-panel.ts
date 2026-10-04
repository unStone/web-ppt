import type { EditorSession, SlideEditor } from '@web-ppt/editor';

type Task = 'object' | 'slide' | 'present';

const tasks: readonly Task[] = ['object', 'slide', 'present'];

export function createEditorSidePanel(
  snapshot: () => { session: EditorSession | null; view: SlideEditor | null },
  signal: AbortSignal,
) {
  const panel = document.querySelector<HTMLElement>('#objectPanel')!;
  const list = document.querySelector<HTMLElement>('#objectList')!;
  const divider = document.querySelector<HTMLElement>('#objectDivider')!;
  const inspector = document.querySelector<HTMLElement>('#editorInspector')!;
  const tabs = Object.fromEntries(tasks.map((task) => [task,
    document.querySelector<HTMLButtonElement>(`#${task}TaskTab`)!])) as Record<Task, HTMLButtonElement>;
  const sections = Object.fromEntries(tasks.map((task) => [task,
    document.querySelector<HTMLElement>(`#${task}TaskPanel`)!])) as Record<Task, HTMLElement>;
  let active: Task = 'slide';
  let selectionKey = '';
  let pointer: { id: number; y: number; height: number } | null = null;

  const show = (task: Task, focus = false) => {
    active = task;
    for (const item of tasks) {
      tabs[item].setAttribute('aria-selected', String(item === task));
      tabs[item].tabIndex = item === task ? 0 : -1;
      sections[item].hidden = item !== task;
    }
    inspector.scrollTop = 0;
    if (focus) tabs[task].focus();
  };
  for (const task of tasks) {
    tabs[task].addEventListener('click', () => show(task), { signal });
    tabs[task].addEventListener('keydown', (event) => {
      const index = tasks.indexOf(task);
      const target = event.key === 'ArrowRight' ? tasks[(index + 1) % tasks.length]
        : event.key === 'ArrowLeft' ? tasks[(index + tasks.length - 1) % tasks.length]
          : event.key === 'Home' ? tasks[0] : event.key === 'End' ? tasks[tasks.length - 1] : null;
      if (!target) return;
      event.preventDefault(); show(target, true);
    }, { signal });
  }

  const bounds = () => {
    const reserved = [...panel.children].filter((child) => child !== list && child !== inspector && child !== divider)
      .reduce((height, child) => height + (child as HTMLElement).getBoundingClientRect().height, 0);
    return { min: 96, max: Math.max(96, panel.clientHeight - reserved - divider.offsetHeight - 180) };
  };
  const height = () => list.getBoundingClientRect().height;
  const setHeight = (wanted: number) => {
    const { min, max } = bounds();
    const next = Math.min(max, Math.max(min, wanted));
    list.style.flexBasis = `${next}px`;
    divider.setAttribute('aria-valuenow', String(Math.round(100 * (next - min) / Math.max(1, max - min))));
    divider.setAttribute('aria-valuetext', `对象列表高 ${Math.round(next)} 像素`);
  };
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, y: event.clientY, height: height() };
    divider.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, { signal });
  divider.addEventListener('pointermove', (event) => {
    if (pointer?.id === event.pointerId) setHeight(pointer.height + event.clientY - pointer.y);
  }, { signal });
  const endDrag = (event: PointerEvent) => {
    if (pointer?.id === event.pointerId) pointer = null;
  };
  divider.addEventListener('pointerup', endDrag, { signal });
  divider.addEventListener('pointercancel', endDrag, { signal });
  divider.addEventListener('keydown', (event) => {
    const { min, max } = bounds();
    const wanted = event.key === 'ArrowUp' ? height() - 20
      : event.key === 'ArrowDown' ? height() + 20
        : event.key === 'Home' ? min : event.key === 'End' ? max : null;
    if (wanted === null) return;
    event.preventDefault(); setHeight(wanted);
  }, { signal });
  window.addEventListener('resize', () => {
    if (list.style.flexBasis) setHeight(height());
  }, { signal });
  panel.querySelector('.object-help')!.addEventListener('toggle', () => setHeight(height()), { signal });
  setHeight(height());

  const sync = () => {
    const { session, view } = snapshot();
    if (!session || !view) { selectionKey = ''; show('slide'); return; }
    const selection = session.editor.selection;
    const ids = selection.kind === 'elements' ? selection.ids
      : selection.kind === 'text' || selection.kind === 'table' ? [selection.id] : [];
    const key = `${view.slideId}:${ids.join(',')}`;
    if (key !== selectionKey) {
      selectionKey = key;
      if (ids.length) show('object');
      else if (active === 'object') show('slide');
    }
  };
  return { sync, reset() { selectionKey = ''; show('slide'); } };
}
