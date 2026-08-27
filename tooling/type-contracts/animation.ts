import type { EditAnimationStep } from '@web-ppt/react';

const visualAnimationWithMotionPath = {
  target: 'type-contract-target', kind: 'entrance', effect: 'fade', trigger: 'click',
  delayMs: 0, durationMs: 500, motionPath: [[0, 0], [1, 1]],
} as const;

// @ts-expect-error 视觉动画与运动路径必须在公共判别联合上互斥，变量赋值也不能绕过。
const invalidVisualAnimation: EditAnimationStep = visualAnimationWithMotionPath;
void invalidVisualAnimation;
