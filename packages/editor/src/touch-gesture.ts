import type { ElementId, SlideViewport, SpacePoint } from '@web-ppt/edit-core';
import type { EditorContextRequest, TouchNavigationChange } from './slide-editor-types';

const LONG_PRESS_DELAY = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;

interface TouchGestureOptions {
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  zoom(): number;
  cancelObjectGestures(): void;
  applyZoom(zoom: number): void;
  navigate(change: TouchNavigationChange): void;
  context(request: EditorContextRequest): void;
}

interface NavigationBase {
  readonly viewport: SlideViewport;
  readonly center: SpacePoint;
  readonly distance: number | null;
}

interface NavigationState {
  base: NavigationBase;
  viewport: SlideViewport;
  frame: number | null;
}

interface LongPressState {
  readonly pointerId: number;
  readonly start: SpacePoint;
  readonly targetId: ElementId | null;
  timer: number | null;
  fired: boolean;
}

interface SuppressedClick {
  readonly until: number;
  readonly point: SpacePoint;
}

const point = (event: PointerEvent): SpacePoint => ({ x: event.clientX, y: event.clientY });
const pointerId = (event: PointerEvent): number => event.pointerId ?? 0;
const isTouch = (event: PointerEvent): boolean => event.pointerType === 'touch';
const centerOf = (points: readonly SpacePoint[]): SpacePoint => points.length === 1
  ? points[0]
  : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
const distanceOf = (points: readonly SpacePoint[]): number | null => points.length < 2
  ? null : Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);

/** 只管理视图局部触屏导航；模型、历史与宿主滚动位置都不进入这里。 */
export class TouchGestureController {
  private readonly options: TouchGestureOptions;
  private readonly pointers = new Map<number, SpacePoint>();
  private navigation: NavigationState | null = null;
  private longPress: LongPressState | null = null;
  private suppressedClick: SuppressedClick | null = null;

  constructor(options: TouchGestureOptions) { this.options = options; }

  get isActive(): boolean { return this.navigation !== null || this.longPress?.fired === true; }

  down(event: PointerEvent): boolean {
    if (this.suppressedClick && Date.now() > this.suppressedClick.until) this.suppressedClick = null;
    const capabilities = (event as PointerEvent & {
      readonly sourceCapabilities?: { readonly firesTouchEvents?: boolean };
    }).sourceCapabilities;
    // 兼容鼠标事件属于同一次长按；其它 pointerdown 已明确开始了下一次物理操作。
    if (this.suppressedClick && (isTouch(event)
      || event.pointerType !== 'mouse' || capabilities?.firesTouchEvents !== true)) {
      this.suppressedClick = null;
    }
    if (!isTouch(event)) return false;
    if (this.navigation) {
      this.flushFrame();
      this.pointers.set(pointerId(event), point(event));
      this.rebase();
      this.capture(pointerId(event));
      event.preventDefault();
      return true;
    }
    this.pointers.set(pointerId(event), point(event));
    if (this.pointers.size < 2) return false;
    this.clearLongPress();
    this.options.cancelObjectGestures();
    const viewport = this.currentViewport();
    this.navigation = { base: this.base(viewport), viewport, frame: null };
    this.options.root.dataset.touchNavigation = '';
    for (const id of this.pointers.keys()) this.capture(id);
    this.emit('start');
    event.preventDefault();
    return true;
  }

  move(event: PointerEvent): boolean {
    if (!isTouch(event) || !this.pointers.has(pointerId(event))) return false;
    this.pointers.set(pointerId(event), point(event));
    const pending = this.longPress;
    if (pending && pending.pointerId === pointerId(event) && !pending.fired
      && Math.hypot(event.clientX - pending.start.x, event.clientY - pending.start.y)
        > LONG_PRESS_MOVE_TOLERANCE) this.clearLongPress();
    if (!this.navigation) return false;
    event.preventDefault();
    this.scheduleFrame();
    return true;
  }

  up(event: PointerEvent): boolean {
    if (!isTouch(event) || !this.pointers.has(pointerId(event))) return false;
    if (!this.navigation) {
      const consumed = this.longPress?.pointerId === pointerId(event) && this.longPress.fired;
      this.clearLongPress();
      this.pointers.delete(pointerId(event));
      if (consumed) event.preventDefault();
      return consumed;
    }
    this.pointers.set(pointerId(event), point(event));
    this.flushFrame();
    this.pointers.delete(pointerId(event));
    if (this.pointers.size > 0) {
      this.rebase();
    } else {
      const viewport = this.navigation.viewport;
      this.clearNavigation();
      this.options.navigate({ phase: 'end', viewport, pointerCount: 0 });
    }
    event.preventDefault();
    return true;
  }

  cancelPointer(event: PointerEvent): boolean {
    if (!isTouch(event) || !this.pointers.has(pointerId(event))) return false;
    if (!this.navigation) {
      this.clearLongPress();
      this.pointers.delete(pointerId(event));
      return false;
    }
    if (event.type === 'lostpointercapture'
      && this.options.root.hasPointerCapture?.(pointerId(event))) return true;
    this.cancel();
    return true;
  }

  cancel(): void {
    const viewport = this.navigation?.viewport;
    const pointerCount = this.pointers.size;
    this.clearNavigation();
    this.clearLongPress();
    this.pointers.clear();
    if (viewport) this.options.navigate({ phase: 'cancel', viewport, pointerCount });
  }

  armLongPress(event: PointerEvent, targetId: ElementId | null): void {
    if (!isTouch(event) || this.navigation) return;
    // 首次点选会同步发布 selection change，并收束旧手势；选择完成后以同一物理指针重新武装长按。
    if (this.pointers.size === 0) this.pointers.set(pointerId(event), point(event));
    if (this.pointers.size !== 1 || !this.pointers.has(pointerId(event))) return;
    this.clearLongPress();
    const state: LongPressState = {
      pointerId: pointerId(event), start: point(event), targetId, timer: null, fired: false,
    };
    const view = this.options.root.ownerDocument.defaultView;
    this.longPress = state;
    state.timer = view
      ? view.setTimeout(() => this.fireLongPress(state), LONG_PRESS_DELAY)
      : setTimeout(() => this.fireLongPress(state), LONG_PRESS_DELAY);
  }

  readonly click = (event: MouseEvent): void => {
    const suppressed = this.suppressedClick;
    if (!suppressed || Date.now() > suppressed.until) {
      this.suppressedClick = null;
      return;
    }
    if (Math.hypot(event.clientX - suppressed.point.x, event.clientY - suppressed.point.y)
      > LONG_PRESS_MOVE_TOLERANCE) return;
    this.suppressedClick = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private currentViewport(): SlideViewport {
    const rect = this.options.stage.getBoundingClientRect();
    return { left: rect.left, top: rect.top, zoom: this.options.zoom() };
  }

  private points(): SpacePoint[] { return [...this.pointers.values()].slice(0, 2); }

  private base(viewport: SlideViewport): NavigationBase {
    const points = this.points();
    return { viewport, center: centerOf(points), distance: distanceOf(points) };
  }

  private rebase(): void {
    if (!this.navigation) return;
    this.navigation.base = this.base(this.navigation.viewport);
  }

  private nextViewport(): SlideViewport {
    const navigation = this.navigation as NavigationState;
    const points = this.points();
    const center = centerOf(points);
    const distance = distanceOf(points);
    const base = navigation.base;
    const zoom = distance !== null && base.distance !== null && base.distance > 0
      ? base.viewport.zoom * distance / base.distance : base.viewport.zoom;
    const anchor = {
      x: (base.center.x - base.viewport.left) / base.viewport.zoom,
      y: (base.center.y - base.viewport.top) / base.viewport.zoom,
    };
    return { left: center.x - anchor.x * zoom, top: center.y - anchor.y * zoom, zoom };
  }

  private scheduleFrame(): void {
    const navigation = this.navigation;
    if (!navigation || navigation.frame !== null) return;
    const view = this.options.root.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) {
      this.updateFrame();
      return;
    }
    navigation.frame = view.requestAnimationFrame(() => {
      navigation.frame = null;
      if (this.navigation === navigation) this.updateFrame();
    });
  }

  private flushFrame(): void {
    const navigation = this.navigation;
    if (!navigation) return;
    const view = this.options.root.ownerDocument.defaultView;
    if (navigation.frame !== null && view?.cancelAnimationFrame) {
      view.cancelAnimationFrame(navigation.frame);
      navigation.frame = null;
    }
    this.updateFrame();
  }

  private updateFrame(): void {
    if (!this.navigation || this.pointers.size === 0) return;
    const viewport = this.nextViewport();
    if (![viewport.left, viewport.top, viewport.zoom].every(Number.isFinite) || viewport.zoom <= 0) return;
    this.navigation.viewport = viewport;
    this.options.applyZoom(viewport.zoom);
    this.emit('update');
  }

  private emit(phase: TouchNavigationChange['phase']): void {
    if (!this.navigation) return;
    this.options.navigate({
      phase, viewport: { ...this.navigation.viewport }, pointerCount: Math.min(2, this.pointers.size),
    });
  }

  private capture(id: number): void {
    try { this.options.root.setPointerCapture?.(id); } catch {
      /* 合成事件没有活动指针；真实触控仍必须走 capture。 */
    }
  }

  private fireLongPress(state: LongPressState): void {
    if (this.longPress !== state || this.navigation || this.pointers.size !== 1
      || !this.pointers.has(state.pointerId)) return;
    state.timer = null;
    state.fired = true;
    this.options.cancelObjectGestures();
    this.capture(state.pointerId);
    this.suppressedClick = { until: Date.now() + 1000, point: { ...state.start } };
    const viewport = this.currentViewport();
    this.options.context({
      source: 'touch', screen: { ...state.start },
      slide: {
        x: (state.start.x - viewport.left) / viewport.zoom,
        y: (state.start.y - viewport.top) / viewport.zoom,
      },
      targetId: state.targetId,
    });
  }

  private clearLongPress(): void {
    const state = this.longPress;
    this.longPress = null;
    if (state && state.timer !== null) {
      const view = this.options.root.ownerDocument.defaultView;
      if (view) view.clearTimeout(state.timer);
      else clearTimeout(state.timer);
    }
  }

  private clearNavigation(): void {
    const navigation = this.navigation;
    this.navigation = null;
    delete this.options.root.dataset.touchNavigation;
    const view = this.options.root.ownerDocument.defaultView;
    if (navigation && navigation.frame !== null && view?.cancelAnimationFrame) {
      view.cancelAnimationFrame(navigation.frame);
    }
    for (const id of this.pointers.keys()) {
      try {
        if (this.options.root.hasPointerCapture?.(id)) this.options.root.releasePointerCapture(id);
      } catch { /* pointerup / cancel 可能已由浏览器释放。 */ }
    }
  }
}
