import type { Transition } from '@web-ppt/core';
import { normalizeSlideTransition, type SlideTransitionInput } from '@web-ppt/edit-core';
import {
  playTransitionControlled, transitionFrames, type TransitionPlayHandle,
} from '@web-ppt/viewer-core';

interface TransitionPreviewOptions {
  readonly layer: HTMLElement;
  readonly chrome?: readonly (HTMLElement | SVGElement)[];
  current(): Transition | undefined;
  destroyed(): boolean;
}

/** 预览只拥有 Web Animations；模型、历史和产品面板状态都留在既有边界。 */
export class TransitionPreviewController {
  private generation = 0;
  private playback: TransitionPlayHandle | null = null;
  private outgoing: HTMLElement | null = null;
  private chromeVisibility: string[] | null = null;

  constructor(private readonly options: TransitionPreviewOptions) {}

  async preview(input?: SlideTransitionInput): Promise<boolean> {
    if (this.options.destroyed()) return false;
    const value = input === undefined
      ? this.options.current()
      : normalizeSlideTransition(input, 'previewTransition.t');
    this.cancel();
    if (!value || value.type === 'none') return false;
    const generation = ++this.generation;
    const outgoing = this.previewOutgoing(value);
    this.outgoing = outgoing;
    this.hideChrome();
    // 同页没有可供 morph 配对的真实前态；整层缩放比逐元素复制/配对更诚实且不随页复杂度退化。
    const playbackValue: Transition = value.type === 'morph'
      ? { type: 'zoom', dir: 'in', durationMs: value.durationMs }
      : value;
    this.playback = playTransitionControlled(outgoing, this.options.layer, playbackValue);
    await this.playback.finished;
    if (generation === this.generation) this.releaseAnimations();
    return true;
  }

  cancel(): void {
    this.generation++;
    this.releaseAnimations();
  }

  private releaseAnimations(): void {
    this.playback?.cancel();
    this.playback = null;
    this.outgoing?.remove();
    this.outgoing = null;
    this.restoreChrome();
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

  private previewOutgoing(value: Transition): HTMLElement {
    const outgoing = this.options.layer.ownerDocument.createElement('div');
    outgoing.dataset.pptTransitionPreview = '';
    outgoing.setAttribute('aria-hidden', 'true');
    outgoing.style.position = 'absolute';
    outgoing.style.inset = '0';
    outgoing.style.width = '100%';
    outgoing.style.height = '100%';
    outgoing.style.pointerEvents = 'none';
    // 中性“上一页”只承担切换参照，不复制整棵 SVG；复杂页面首次预览也保持 O(1)。
    outgoing.style.backgroundColor = '#596270';
    outgoing.style.backgroundImage =
      'linear-gradient(145deg, rgba(255,255,255,.18), transparent 55%),'
      + 'linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)';
    outgoing.style.backgroundSize = 'auto, 48px 100%';
    const changes = (frames: Keyframe[]): boolean =>
      JSON.stringify(frames[0] ?? {}) !== JSON.stringify(frames[frames.length - 1] ?? {});
    const incomingChanges = changes(transitionFrames(value, true));
    // 入场层静止而出场层变化（如 split-in/cut）时，出场副本必须位于上层才可见。
    if (!incomingChanges) this.options.layer.after(outgoing);
    else this.options.layer.before(outgoing);
    return outgoing;
  }
}
