import type { AnimStep } from '@web-ppt/core';
import { groupSteps, hiddenBefore, playGroup, type PlayHandle } from '@web-ppt/viewer-core';

interface AnimationPreviewOptions {
  readonly layer: HTMLElement;
  readonly chrome?: readonly (HTMLElement | SVGElement)[];
  current(): readonly AnimStep[] | undefined;
  destroyed(): boolean;
}

interface StyleSnapshot {
  readonly node: SVGElement;
  readonly value: string | null;
}

/** 一键预览自动跑完整条时间线，但只拥有自己创建的 WAAPI 与临时内联样式。 */
export class AnimationPreviewController {
  private generation = 0;
  private playback: PlayHandle | null = null;
  private styles: StyleSnapshot[] | null = null;
  private chromeVisibility: string[] | null = null;

  constructor(private readonly options: AnimationPreviewOptions) {}

  async preview(input?: readonly AnimStep[]): Promise<boolean> {
    if (this.options.destroyed()) return false;
    const groups = groupSteps(input === undefined ? this.options.current()?.slice() : input.slice());
    this.cancel();
    if (!groups.length) return false;
    const generation = ++this.generation;
    this.captureStyles();
    this.hideChrome();
    this.applyVisibility(groups, 0);
    for (let index = 0; index < groups.length; index++) {
      if (generation !== this.generation) return true;
      const playback = playGroup(this.options.layer, groups[index]);
      this.playback = playback;
      await playback.finished;
      // 播放层的退场终态也挂在 finished.then；多让一个微任务，避免它在快照恢复后补写 hidden。
      await Promise.resolve();
      if (generation !== this.generation) return true;
      this.releasePlayback();
      this.applyVisibility(groups, index + 1);
    }
    if (generation === this.generation) this.releasePreview();
    return true;
  }

  cancel(): void {
    this.generation++;
    this.releasePreview();
  }

  private releasePreview(): void {
    this.releasePlayback();
    this.restoreStyles();
    this.restoreChrome();
  }

  private releasePlayback(): void {
    // Viewer 的 cancel 语义是“跳到终态”；编辑预览要真正移除 effect，故只回收本句柄的动画。
    for (const animation of this.playback?.animations ?? []) {
      try { animation.cancel(); } catch { /* 浏览器已回收 */ }
    }
    this.playback = null;
  }

  private captureStyles(): void {
    this.styles = [...this.options.layer.querySelectorAll<SVGElement>('[data-el]')]
      .map((node) => ({ node, value: node.getAttribute('style') }));
  }

  private restoreStyles(): void {
    if (!this.styles) return;
    for (const { node, value } of this.styles) {
      // 编辑器允许挂在尚未接入 document 的框架 portal；只排除已被本层替换的旧节点。
      if (!this.options.layer.contains(node)) continue;
      if (value === null) node.removeAttribute('style');
      else node.setAttribute('style', value);
    }
    this.styles = null;
  }

  private applyVisibility(groups: AnimStep[][], upTo: number): void {
    const hidden = hiddenBefore(groups, upTo);
    for (const node of this.styles?.map((snapshot) => snapshot.node) ?? []) {
      const id = Number(node.dataset.el);
      // visibility 可被后代 visible 顶掉；显示必须清空声明，不能写 visible。
      node.style.visibility = hidden.has(id) ? 'hidden' : '';
    }
  }

  private hideChrome(): void {
    const chrome = this.options.chrome ?? [];
    this.chromeVisibility = chrome.map((layer) => layer.style.visibility);
    for (const layer of chrome) layer.style.visibility = 'hidden';
  }

  private restoreChrome(): void {
    if (!this.chromeVisibility) return;
    (this.options.chrome ?? []).forEach((layer, index) => {
      layer.style.visibility = this.chromeVisibility?.[index] ?? '';
    });
    this.chromeVisibility = null;
  }
}
