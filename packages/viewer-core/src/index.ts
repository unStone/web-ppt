/**
 * @web-ppt/viewer-core —— 查看器的 headless 层。
 *
 * `PresentationState` 是纯状态机（零 DOM），`Viewer` 是它之上最薄的 DOM 绑定。
 * 想接 React / Vue / Svelte 就直接驱动 `PresentationState`，
 * 播放动画与切换用这里导出的 `playGroup` / `playTransition`。
 */
export { PresentationState } from './state';
export type { PresentationStateOptions, StateChange } from './state';
export { Viewer } from './viewer';
export { foreignObjectScalesCorrectly, resetForeignObjectProbe } from './foreign-object';
export type { ViewerOptions } from './viewer';
export {
  autoAdvanceMs, framesFor, groupSteps, hiddenBefore, playGroup, playTransition,
} from './playback';
export type { PlayHandle } from './playback';
