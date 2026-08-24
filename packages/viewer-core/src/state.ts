import type { AnimStep, Presentation, Slide, Transition } from '@web-ppt/core';
import { slideText } from '@web-ppt/core';
import { groupSteps, hiddenBefore, staticHidden } from '@web-ppt/core';
import { autoAdvanceMs } from './playback';

/**
 * 演示文稿的 headless 状态机：翻页、缩放、搜索、动画批次。
 *
 * 不碰任何 DOM，因此可以被原生 / React / Vue / Svelte 任意 UI 驱动，
 * 也能在 Node 里直接跑测试。UI 层只负责两件事：
 * 订阅变更 → 把 `renderSlideToSvg` 的结果放进容器。
 */

export interface PresentationStateOptions {
  /** 初始页 */
  index?: number;
  /** 翻页时跳过隐藏页 */
  skipHidden?: boolean;
  /** 启用切换与元素动画（演示模式建议开启） */
  animate?: boolean;
  /** 遵循文件里的自动换片设置 */
  autoAdvance?: boolean;
}

export type StateChange =
  /** 换页。`transition` 非空表示应播放切换效果 */
  | { type: 'slide'; index: number; previous: number; transition?: Transition }
  /** 动画批次推进。`group` 是本次应播放的这一批 */
  | { type: 'animation'; done: number; total: number; group: AnimStep[] | null }
  | { type: 'zoom'; zoom: number };

type Listener = (change: StateChange) => void;

export class PresentationState {
  private idx = 0;
  private zoomValue = 1;
  private groups: AnimStep[][] = [];
  private cursor = 0;
  private listeners = new Set<Listener>();
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  /** 每页渲染结果的缓存交给 UI 层，这里只缓存文本以便搜索 */
  private textCache = new Map<number, string>();

  constructor(
    readonly presentation: Presentation,
    private options: PresentationStateOptions = {},
  ) {
    this.idx = this.clamp(options.index ?? 0);
    this.loadAnimations();
  }

  // ---------------- 只读状态 ----------------

  get index(): number {
    return this.idx;
  }

  get count(): number {
    return this.presentation.slides.length;
  }

  get slide(): Slide {
    return this.presentation.slides[this.idx];
  }

  get zoom(): number {
    return this.zoomValue;
  }

  get animate(): boolean {
    return this.options.animate === true;
  }

  get animationTotal(): number {
    return this.groups.length;
  }

  get animationDone(): number {
    return this.cursor;
  }

  get hasPendingAnimation(): boolean {
    return this.animate && this.cursor < this.groups.length;
  }

  /**
   * 当前应当隐藏的元素 id —— UI 据此设置可见性。
   *
   * 不播动画时不是「全部可见」，而是动画终态：入场与退场的元素属于不同时刻，
   * 一起画出来就是几帧叠在一起（见 core 的 staticHidden）。
   */
  get hiddenElementIds(): ReadonlySet<number> {
    return this.animate ? hiddenBefore(this.groups, this.cursor) : staticHidden(this.slide);
  }

  /** 本页的自动换片延迟（毫秒），未配置则为 null */
  get autoAdvanceDelay(): number | null {
    return this.options.autoAdvance ? autoAdvanceMs(this.slide) : null;
  }

  // ---------------- 订阅 ----------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(change: StateChange): void {
    for (const fn of this.listeners) fn(change);
  }

  // ---------------- 导航 ----------------

  private clamp(i: number): number {
    return Math.max(0, Math.min(this.count - 1, i));
  }

  private visible(i: number): boolean {
    return !this.options.skipHidden || !this.presentation.slides[i]?.hidden;
  }

  /**
   * 跳转到指定页。返回是否真的换了页。
   * 前进时带上目标页的切换效果；回退不播切换，避免观感错乱。
   */
  goTo(i: number, direction: 'forward' | 'backward' = 'forward'): boolean {
    const next = this.clamp(i);
    if (next === this.idx) return false;
    const previous = this.idx;
    this.idx = next;
    this.loadAnimations();
    this.emit({
      type: 'slide',
      index: next,
      previous,
      transition: direction === 'forward' && this.animate ? this.slide.transition : undefined,
    });
    return true;
  }

  /** 有待播动画时先播动画，否则翻页 */
  next(): void {
    if (this.playNextAnimation()) return;
    let i = this.idx + 1;
    while (i < this.count && !this.visible(i)) i++;
    // 后面全是隐藏页时原地不动，否则会落在一张本该跳过的页上
    if (i < this.count) this.goTo(i);
  }

  prev(): void {
    let i = this.idx - 1;
    while (i >= 0 && !this.visible(i)) i--;
    if (i >= 0) this.goTo(i, 'backward');
  }

  setZoom(z: number): void {
    const v = Math.max(0.1, Math.min(8, z));
    if (v === this.zoomValue) return;
    this.zoomValue = v;
    this.emit({ type: 'zoom', zoom: v });
  }

  setAnimate(on: boolean): void {
    if (this.options.animate === on) return;
    this.options = { ...this.options, animate: on };
    this.loadAnimations();
    this.emit({ type: 'animation', done: this.cursor, total: this.groups.length, group: null });
  }

  // ---------------- 动画 ----------------

  private loadAnimations(): void {
    this.groups = this.animate ? groupSteps(this.slide.animations) : [];
    this.cursor = 0;
  }

  /**
   * 推进一批动画。返回应播放的这一批；没有待播批次时返回 null。
   * 真正的播放由 UI 层执行——状态机只负责「该播哪一批」。
   */
  playNextAnimation(): AnimStep[] | null {
    if (!this.hasPendingAnimation) return null;
    const group = this.groups[this.cursor];
    this.cursor++;
    this.emit({ type: 'animation', done: this.cursor, total: this.groups.length, group });
    return group;
  }

  /** 直接跳到本页动画终态 */
  finishAnimations(): void {
    if (this.cursor === this.groups.length) return;
    this.cursor = this.groups.length;
    this.emit({ type: 'animation', done: this.cursor, total: this.groups.length, group: null });
  }

  // ---------------- 自动换片 ----------------

  /** 启动自动换片计时；返回取消函数。由 UI 层在每次换页后调用。 */
  scheduleAutoAdvance(): () => void {
    this.cancelAutoAdvance();
    const ms = this.autoAdvanceDelay;
    if (ms === null) return () => undefined;
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      this.next();
    }, ms);
    return () => this.cancelAutoAdvance();
  }

  cancelAutoAdvance(): void {
    if (this.autoTimer !== null) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
  }

  // ---------------- 文本 / 搜索 ----------------

  text(i: number): string {
    let t = this.textCache.get(i);
    if (t === undefined) {
      t = slideText(this.presentation.slides[i]);
      this.textCache.set(i, t);
    }
    return t;
  }

  /** 全文搜索，返回命中的页索引 */
  search(query: string): number[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.text(i).toLowerCase().includes(q)) hits.push(i);
    }
    return hits;
  }

  /** 解析绝对或相对内部跳转；相对动作保留到点击时，页序变化后仍指向正确目标。 */
  resolveLink(href: string): number | null {
    if (!href.startsWith('slide:')) return null;
    const raw = href.slice(6);
    const n = raw === 'next' ? this.idx + 2
      : raw === 'previous' ? this.idx
      : raw === 'first' ? 1
      : raw === 'last' ? this.count
      : Number(raw);
    return Number.isFinite(n) ? this.clamp(n - 1) : null;
  }

  destroy(): void {
    this.cancelAutoAdvance();
    this.listeners.clear();
    this.textCache.clear();
  }
}
