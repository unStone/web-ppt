/**
 * 预览打开世代。
 *
 * 解析是异步的，人可以在中途点另一份。没有世代的话，先点的后解析完会盖住
 * 正在看的那一份；过期结果若不 dispose，blob URL 会漏。
 */
export function createOpenGeneration(): {
  begin(): number;
  /** 只有还没人打开时才占世代。内置示例晚到不能把人刚选的文件拆掉。 */
  tryIdleBegin(): number | null;
  current(): number;
  isCurrent(token: number): boolean;
} {
  let generation = 0;
  return {
    begin(): number { return ++generation; },
    tryIdleBegin(): number | null { return generation === 0 ? ++generation : null; },
    current(): number { return generation; },
    isCurrent(token: number): boolean { return token === generation; },
  };
}

/** 让「解析中」先画出来。后台标签页里 rAF 可能不来，所以加定时器兜底。 */
export function nextOpenPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = (): void => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(go);
    setTimeout(go, 50);
  });
}

export function abandonPresentation(pres: { dispose?: () => void } | null | undefined): void {
  pres?.dispose?.();
}
