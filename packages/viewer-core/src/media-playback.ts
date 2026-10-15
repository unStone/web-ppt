import type { AnimStep } from '@web-ppt/core';

type MediaCommand = NonNullable<AnimStep['mediaCommand']>;

export interface ScheduledMediaCommand {
  finished: Promise<void>;
  cancel(): void;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** 媒体调用属于时间线行为；视觉动画结束不代表媒体已开始播放。 */
export function scheduleMediaCommand(
  target: Element,
  command: MediaCommand,
  startMs: number,
): ScheduledMediaCommand | null {
  const player = target.querySelector('audio,video') as HTMLMediaElement | null;
  if (!player) return null;
  if (!Number.isFinite(startMs) || startMs < 0) {
    throw new Error(`媒体调用的起始时间无效：${startMs}ms`);
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let remaining = startMs;
  let canceled = false;
  let started = false;
  let resolveFinished!: () => void;
  let rejectFinished!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const play = (): void => {
    started = true;
    Promise.resolve(player.play()).then(resolveFinished, rejectFinished);
  };
  const execute = (): void => {
    timer = null;
    if (canceled) return;
    try {
      switch (command.action) {
        case 'play':
          if (command.fromSeconds !== undefined) player.currentTime = command.fromSeconds;
          play();
          return;
        case 'resume':
          play();
          return;
        case 'pause':
          player.pause();
          break;
        case 'stop':
          player.pause();
          player.currentTime = 0;
          break;
        case 'togglePause':
          if (player.paused) {
            play();
            return;
          }
          player.pause();
          break;
      }
      resolveFinished();
    } catch (error) {
      rejectFinished(error);
    }
  };
  const schedule = (): void => {
    if (remaining === 0) {
      execute();
      return;
    }
    const chunk = Math.min(remaining, MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      remaining -= chunk;
      schedule();
    }, chunk);
  };
  schedule();

  return {
    finished,
    cancel: () => {
      canceled = true;
      if (timer !== null) clearTimeout(timer);
      if (started) player.pause();
      resolveFinished();
    },
  };
}
