import type { DesignCommand, DesignTarget, TransactionResult } from '@web-ppt/edit-core';

export interface DesignEditorOptions {
  readonly target: DesignTarget;
  readonly textMode?: 'auto' | 'html' | 'svg';
}

/** 版式 DOM 适配器只暴露设计目标命令，不混入页序、备注或动画入口。 */
export interface DesignEditor {
  readonly element: HTMLDivElement;
  readonly target: DesignTarget;
  readonly destroyed: boolean;
  setTarget(target: DesignTarget): void;
  exec(...commands: DesignCommand[]): TransactionResult;
  render(): void;
  destroy(): void;
}
