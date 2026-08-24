import type { SpacePoint } from './space';

const GESTURE_THRESHOLD = 3;

export interface PointerGestureSnapshot {
  screen: SpacePoint;
  altKey: boolean;
  shiftKey: boolean;
}

export interface PointerGesture {
  cursor: string;
  dataset: { name: string; value: string };
  start(): void;
  frame(snapshot: PointerGestureSnapshot): void;
  finish(snapshot: PointerGestureSnapshot): (() => void) | null;
  clear(): void;
}

interface ActivePointerGesture {
  pointerId: number;
  startScreen: SpacePoint;
  snapshot: PointerGestureSnapshot;
  gesture: PointerGesture;
  started: boolean;
  frame: number | null;
  cursor: string;
}

const pointerId = (event: PointerEvent): number => event.pointerId ?? 0;

export class PointerGestureLifecycle {
  private readonly root: HTMLElement;
  private active: ActivePointerGesture | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  get isActive(): boolean { return this.active !== null; }

  begin(event: PointerEvent, gesture: PointerGesture): void {
    this.cancel();
    const screen = { x: event.clientX, y: event.clientY };
    this.active = {
      pointerId: pointerId(event), startScreen: screen,
      snapshot: { screen, altKey: event.altKey, shiftKey: event.shiftKey },
      gesture, started: false, frame: null, cursor: this.root.style.cursor,
    };
    try {
      this.root.setPointerCapture?.(pointerId(event));
    } catch { /* 合成事件没有活动指针；可信浏览器输入仍必须捕获成功。 */ }
  }

  move(event: PointerEvent): void {
    const active = this.active;
    if (!active || pointerId(event) !== active.pointerId) return;
    this.updateSnapshot(active, event);
    if (!active.started) {
      const distance = Math.hypot(
        active.snapshot.screen.x - active.startScreen.x,
        active.snapshot.screen.y - active.startScreen.y,
      );
      if (distance < GESTURE_THRESHOLD) return;
      active.started = true;
      try {
        active.gesture.start();
      } catch (error) {
        this.clear(active);
        throw error;
      }
      this.root.style.cursor = active.gesture.cursor;
      this.root.dataset[active.gesture.dataset.name] = active.gesture.dataset.value;
    }
    event.preventDefault();
    this.scheduleFrame(active);
  }

  finish(event: PointerEvent): void {
    const active = this.active;
    if (!active || pointerId(event) !== active.pointerId) return;
    this.updateSnapshot(active, event);
    let commit: (() => void) | null;
    try {
      commit = active.started ? active.gesture.finish(active.snapshot) : null;
    } catch (error) {
      this.clear(active);
      throw error;
    }
    this.clear(active);
    commit?.();
    if (commit) event.preventDefault();
  }

  modifier(event: KeyboardEvent): boolean {
    const active = this.active;
    if (!active || (event.key !== 'Shift' && event.key !== 'Alt')) return false;
    active.snapshot = {
      ...active.snapshot, altKey: event.altKey, shiftKey: event.shiftKey,
    };
    if (active.started) this.scheduleFrame(active);
    return true;
  }

  cancel(): void {
    if (this.active) this.clear(this.active);
  }

  cancelPointer(event: PointerEvent): void {
    if (this.active && pointerId(event) === this.active.pointerId) this.clear(this.active);
  }

  private updateSnapshot(active: ActivePointerGesture, event: PointerEvent): void {
    active.snapshot = {
      screen: { x: event.clientX, y: event.clientY },
      altKey: event.altKey, shiftKey: event.shiftKey,
    };
  }

  private scheduleFrame(active: ActivePointerGesture): void {
    if (active.frame !== null) return;
    const view = this.root.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) {
      try {
        active.gesture.frame(active.snapshot);
      } catch (error) {
        this.clear(active);
        throw error;
      }
      return;
    }
    active.frame = view.requestAnimationFrame(() => {
      active.frame = null;
      if (this.active !== active) return;
      try {
        active.gesture.frame(active.snapshot);
      } catch (error) {
        this.clear(active);
        throw error;
      }
    });
  }

  private clear(active: ActivePointerGesture): void {
    this.active = null;
    const view = this.root.ownerDocument.defaultView;
    if (active.frame !== null && view?.cancelAnimationFrame) view.cancelAnimationFrame(active.frame);
    try {
      if (active.started) active.gesture.clear();
    } finally {
      this.root.style.cursor = active.cursor;
      delete this.root.dataset[active.gesture.dataset.name];
      try {
        if (this.root.hasPointerCapture?.(active.pointerId)) this.root.releasePointerCapture(active.pointerId);
      } catch { /* cancel/lostcapture 时浏览器可能已释放指针。 */ }
    }
  }
}
