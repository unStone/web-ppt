/**
 * 认文件人话与映射。不碰 Zip，避免编辑器首开闭包再打一份 fflate。
 */
export const OPEN_KIND = {
  empty: '空文件，没有内容可打开。请拖入 .pptx 或 .ppt。',
  pdf: '这是 PDF，这里只打开 .pptx / .ppt。',
  image: '这是图片，这里只打开 .pptx / .ppt。',
  html: '这是网页，不是演示文稿。',
  word: '这是 Word 文档，这里只打开 .pptx / .ppt。',
  excel: '这是 Excel 表格，这里只打开 .pptx / .ppt。',
  odp: '这是 OpenDocument 演示文稿（.odp），这里只打开 .pptx / .ppt。',
  zip: '这是压缩包，但不是 PowerPoint 演示文稿。',
  ole: '这是 Office 旧格式文件，但不是演示文稿。',
  unknown: '无法识别的文件。请拖入 .pptx 或 .ppt。',
} as const;

export type OpenKindMessage = (typeof OPEN_KIND)[keyof typeof OPEN_KIND];

export type OpenKindResult =
  | { kind: 'presentation' }
  | { kind: 'reject'; message: OpenKindMessage };

/** 种类不对用专用错误，避免页面把人话再套一层「打开失败：」。 */
export class OpenKindError extends Error {
  readonly openMessage: OpenKindMessage;
  constructor(openMessage: OpenKindMessage) {
    super(openMessage);
    this.name = 'OpenKindError';
    this.openMessage = openMessage;
  }
}

/** 认文件没拦住时，把引擎旧句收成同一套人话。 */
export function mapOpenError(error: unknown): OpenKindMessage | null {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('既不是 .pptx') || raw.includes('无法识别的文件格式')) return OPEN_KIND.unknown;
  if (raw.includes('找不到 ppt/presentation.xml')) return OPEN_KIND.zip;
  if (raw.includes('找不到 PowerPoint Document')) return OPEN_KIND.ole;
  return null;
}
