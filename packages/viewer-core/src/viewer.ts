import type { Presentation, Slide } from '@web-ppt/core';
import { renderSlideToSvg, slideToPng, staticHidden } from '@web-ppt/core';
import { foreignObjectScalesCorrectly } from './foreign-object';
import { playGroup, playTransition, type PlayHandle } from './playback';
import { PresentationState, type PresentationStateOptions } from './state';

/**
 * 原生 DOM 查看器：`PresentationState` 之上最薄的一层绑定。
 *
 * 它做的全部事情只有三件——把 SVG 塞进容器、按状态设元素可见性、
 * 在状态机说「该播这一批」时调用播放层。所有决策都在状态机里，
 * 因此换成 React / Vue 只需重写这三件事。
 */

export interface ViewerOptions extends PresentationStateOptions {
  /**
   * 媒体呈现：'badge' 只画封面帧与播放标识，'player' 嵌入可播放的
   * <video>/<audio>。导出（exportPng）不受影响，始终走 badge。
   */
  media?: 'badge' | 'player';
  /**
   * 文本渲染方式。默认 'auto'：探测到引擎不给 foreignObject 应用 SVG 缩放
   * （WebKit bug 23113）时自动切到原生 <text>，否则用 foreignObject。
   * 传死值可绕过探测。
   */
  textMode?: 'auto' | 'html' | 'svg';
}

export class Viewer {
  readonly state: PresentationState;
  private svgCache = new Map<number, string>();
  private media: 'badge' | 'player';
  private textMode: 'html' | 'svg';
  private playing: PlayHandle | null = null;
  private cancelAuto: (() => void) | null = null;
  private unsubscribe: () => void;

  onChange: ((index: number) => void) | null = null;
  onAnimStep: ((done: number, total: number) => void) | null = null;
  /** 点击外部链接时回调；返回 true 表示宿主已处理，不再打开新窗口 */
  onLinkClick: ((href: string) => boolean | void) | null = null;

  constructor(
    private container: HTMLElement,
    readonly presentation: Presentation,
    options: ViewerOptions = {},
  ) {
    this.media = options.media ?? 'badge';
    const mode = options.textMode ?? 'auto';
    this.textMode = mode !== 'auto'
      ? mode
      : foreignObjectScalesCorrectly(container.ownerDocument) ? 'html' : 'svg';
    this.state = new PresentationState(presentation, options);
    this.unsubscribe = this.state.subscribe((change) => {
      if (change.type === 'slide') {
        this.paint(change.transition);
        this.onChange?.(change.index);
      } else if (change.type === 'animation') {
        if (change.group) this.play(change.group);
        else this.applyVisibility();
        this.onAnimStep?.(change.done, change.total);
      } else if (change.type === 'zoom') {
        this.applyZoom();
      }
    });
    this.container.addEventListener('click', this.handleClick);
    this.paint();
  }

  // ---------------- 转发给状态机 ----------------

  get index(): number { return this.state.index; }
  get count(): number { return this.state.count; }
  get slide(): Slide { return this.state.slide; }
  get zoomLevel(): number { return this.state.zoom; }
  get animationTotal(): number { return this.state.animationTotal; }
  get animationDone(): number { return this.state.animationDone; }
  get hasPendingAnimation(): boolean { return this.state.hasPendingAnimation; }

  goTo(i: number, direction: 'forward' | 'backward' = 'forward'): void { this.state.goTo(i, direction); }
  next(): void { this.state.next(); }
  prev(): void { this.state.prev(); }
  setZoom(z: number): void { this.state.setZoom(z); }
  finishAnimations(): void { this.state.finishAnimations(); }
  search(q: string): number[] { return this.state.search(q); }
  text(i: number): string { return this.state.text(i); }

  setAnimate(on: boolean): void {
    this.state.setAnimate(on);
    this.paint();
  }

  playNextAnimation(): boolean {
    return this.state.playNextAnimation() !== null;
  }

  // ---------------- 渲染 ----------------

  /** 带缓存的单页 SVG（主视图用） */
  slideSvg(i: number): string {
    let svg = this.svgCache.get(i);
    if (svg === undefined) {
      svg = renderSlideToSvg(this.presentation, this.presentation.slides[i], {
        media: this.media,
        textMode: this.textMode,
      });
      this.svgCache.set(i, svg);
    }
    return svg;
  }

  /** 不走缓存，用于缩略图等需要独立 defs id 的场景 */
  renderSlide(i: number): string {
    const slide = this.presentation.slides[i];
    return renderSlideToSvg(this.presentation, slide, {
      // 缩略图不嵌播放器：既没意义，还会为每个缩略图各建一个媒体元素
      textMode: this.textMode,
      // 缩略图是静态产物，没有后续的 applyVisibility，隐藏状态只能烘进 SVG
      hiddenElements: [...staticHidden(slide)],
    });
  }

  /**
   * 重渲当前页，页码与动画进度都不变。
   *
   * 给「渲染完之后世界才变」的情况用，最典型的是网络字体到货：原生 `<text>`
   * 路径的断行是渲染时拿 canvas 量出来烘进 SVG 的，字体换了就必须重量一遍；
   * `foreignObject` 路径由浏览器自己重排，重渲只是顺带把缓存换掉。
   */
  refresh(): void {
    this.svgCache.delete(this.index);
    this.paint();
  }

  exportPng(scale = 2, i = this.index): Promise<Blob> {
    return slideToPng(this.presentation, this.presentation.slides[i], scale);
  }

  private paint(transition?: Parameters<typeof playTransition>[2]): void {
    this.playing?.cancel();
    this.playing = null;
    this.cancelAuto?.();

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center';
    wrap.innerHTML = this.slideSvg(this.index);

    const previous = this.container.firstElementChild as HTMLElement | null;
    // 幻灯片以绝对定位叠放，容器必须是定位上下文。
    // 只在容器确实是 static 时才动它——看内联 style 会漏掉样式表里设的定位，
    // 从而用内联值把宿主的布局覆盖掉。
    // 走 ownerDocument.defaultView 而非裸全局：容器可能位于 iframe 或游离文档中。
    const view = this.container.ownerDocument.defaultView;
    if (!view || view.getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }

    if (transition && previous) {
      this.container.appendChild(wrap);
      void playTransition(previous, wrap, transition).then(() => this.startAutoAdvance());
    } else {
      this.container.innerHTML = '';
      this.container.appendChild(wrap);
      this.startAutoAdvance();
    }

    const svg = wrap.querySelector('svg');
    if (svg) {
      svg.style.display = 'block';
      svg.style.maxWidth = 'none';
    }
    this.applyZoom();
    this.applyVisibility();
    this.onAnimStep?.(this.state.animationDone, this.state.animationTotal);
  }

  private play(group: Parameters<typeof playGroup>[1]): void {
    this.playing?.cancel();
    this.playing = playGroup(this.container, group);
    this.applyVisibility();
  }

  /**
   * 按状态机给出的隐藏集合设置元素可见性。
   *
   * 不播动画时也要跑：静态画面取的是动画终态，退场元素同样得藏起来。
   */
  private applyVisibility(): void {
    const hidden = this.state.hiddenElementIds;
    this.container.querySelectorAll('[data-el]').forEach((node) => {
      const id = Number(node.getAttribute('data-el'));
      // 不在隐藏集里的必须**清空**这条声明，不能写成 'visible'。
      // visibility 虽然继承，但后代显式写 visible 会把祖先的 hidden 顶掉
      // （和 display:none 不一样）。动画目标是**组**时就会中招：组藏了，
      // 组里每个形状却各自写着 visible，整组白藏 —— swiss-grid-systems
      // 第 1 页的标题就是这么漏出来的。
      (node as HTMLElement).style.visibility = hidden.has(id) ? 'hidden' : '';
    });
  }

  private applyZoom(): void {
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    const z = this.state.zoom;
    if (z === 1) {
      svg.style.width = '100%';
      svg.style.height = '100%';
    } else {
      svg.style.width = `${this.presentation.width * z}px`;
      svg.style.height = `${this.presentation.height * z}px`;
    }
  }

  private startAutoAdvance(): void {
    this.cancelAuto = this.state.scheduleAutoAdvance();
  }

  private handleClick = (e: MouseEvent): void => {
    const el = e.target as Element | null;

    const jump = el?.closest('[data-slide]');
    if (jump) {
      e.preventDefault();
      const target = this.state.resolveLink(`slide:${jump.getAttribute('data-slide') ?? ''}`);
      if (target !== null) this.goTo(target);
      return;
    }

    const link = el?.closest('a[href]');
    const href = link?.getAttribute('href');
    if (href && this.onLinkClick) {
      if (this.onLinkClick(href) === true) e.preventDefault();
    }
  };

  destroy(): void {
    this.container.removeEventListener('click', this.handleClick);
    this.unsubscribe();
    this.playing?.cancel();
    this.cancelAuto?.();
    this.state.destroy();
    this.container.innerHTML = '';
    this.svgCache.clear();
  }
}
