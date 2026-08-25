import { detectImageMime, MAX_REPLACE_IMAGE_BYTES } from '@web-ppt/edit-core';
import type { AddImageCommand, Editor, ElementId, SlideId } from '@web-ppt/edit-core';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const DEFAULT_MAX_BYTES = MAX_REPLACE_IMAGE_BYTES;

export interface ImageInsertOptions {
  readonly rect?: AddImageCommand['rect'];
  /** 默认 5MB：留足默认 8MB 历史预算所需的 Base64 开销，保证插入后仍可撤销。 */
  readonly maxBytes?: number;
}

export interface ImageReplaceOptions {
  /** 默认使用当前单选图片。 */
  readonly id?: ElementId;
  readonly maxBytes?: number;
}

interface InternalImageInsertOptions extends ImageInsertOptions {
  readonly placeholderId?: ElementId;
}

interface ImageInsertionControllerOptions {
  readonly editor: Editor;
  readonly root: HTMLElement;
  slideId(): SlideId;
  editable(): boolean;
}

function assertMaxBytes(value: number | undefined): number {
  const maximum = value ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maximum) || maximum <= 0) throw new Error('图片字节上限必须是正整数');
  return maximum;
}

function formatByteLimit(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

function fittedRect(
  width: number,
  height: number,
  slideWidth: number,
  slideHeight: number,
): AddImageCommand['rect'] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('浏览器无法读取图片尺寸');
  }
  const maxWidth = slideWidth * 0.8;
  const maxHeight = slideHeight * 0.8;
  const naturalScale = Math.max(width, height) < 96 ? 96 / Math.max(width, height) : 1;
  const scale = Math.min(naturalScale, maxWidth / width, maxHeight / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (slideWidth - w) / 2, y: (slideHeight - h) / 2, w, h };
}

async function decodedSize(blob: Blob, document: Document): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = document.createElement('img');
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('浏览器无法解码图片'));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class ImageInsertionController {
  private readonly options: ImageInsertionControllerOptions;
  private cancelChooser: (() => void) | null = null;
  private activeReads = 0;
  private destroyed = false;

  constructor(options: ImageInsertionControllerOptions) { this.options = options; }

  async insert(blob: Blob, options: InternalImageInsertOptions = {}): Promise<ElementId> {
    if (this.destroyed) throw new Error('不能通过已销毁视图插入图片');
    if (!this.options.editable()) throw new Error('查看模式不能插入图片');
    const slideId = this.options.slideId();
    let reading = false;
    try {
      if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size)) {
        throw new Error('插入图片必须提供 File 或 Blob');
      }
      const maximum = assertMaxBytes(options.maxBytes);
      if (blob.size <= 0) throw new Error('图片文件不能为空');
      if (blob.size > maximum) {
        throw new Error(`图片大小不能超过 ${formatByteLimit(maximum)}，以保证本地撤销可用`);
      }
      this.setReading(true);
      reading = true;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      this.assertContext(slideId, '读取');
      const mime = detectImageMime(bytes);
      if (!mime) throw new Error('只支持完整的 PNG、JPEG、GIF 或 WebP 图片');
      const size = await decodedSize(blob, this.options.root.ownerDocument);
      this.assertContext(slideId, '解码');
      let placement = options.rect;
      if (!placement) {
        placement = fittedRect(
          size.width, size.height, this.options.editor.doc.meta.width, this.options.editor.doc.meta.height,
        );
      }
      this.assertContext(slideId, '提交');
      const result = this.options.editor.exec({
        type: 'AddImage', slideId, bytes, mime, rect: placement,
        ...(options.placeholderId ? { placeholderId: options.placeholderId } : {}),
      });
      const id = result.forward.find((patch) =>
        patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2)?.path[1];
      if (!id || this.options.editor.doc.elements[id]?.src.kind !== 'image') {
        throw new Error('图片命令没有返回新元素身份');
      }
      return id;
    } catch (error) {
      this.report(error);
      throw error;
    } finally {
      if (reading) this.setReading(false);
    }
  }

  async replace(id: ElementId, blob: Blob, options: ImageReplaceOptions = {}): Promise<ElementId> {
    if (this.destroyed) throw new Error('不能通过已销毁视图替换图片');
    if (!this.options.editable()) throw new Error('查看模式不能替换图片');
    const slideId = this.options.slideId();
    let reading = false;
    try {
      if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size)) {
        throw new Error('替换图片必须提供 File 或 Blob');
      }
      const maximum = assertMaxBytes(options.maxBytes);
      if (blob.size <= 0) throw new Error('图片文件不能为空');
      if (blob.size > maximum) {
        throw new Error(`图片大小不能超过 ${formatByteLimit(maximum)}，以保证本地撤销可用`);
      }
      this.setReading(true);
      reading = true;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      this.assertContext(slideId, '读取');
      const mime = detectImageMime(bytes);
      if (!mime) throw new Error('只支持完整的 PNG、JPEG、GIF 或 WebP 图片');
      this.assertContext(slideId, '提交');
      this.options.editor.exec({ type: 'ReplaceImage', id, bytes, mime });
      return id;
    } catch (error) {
      this.report(error);
      throw error;
    } finally {
      if (reading) this.setReading(false);
    }
  }

  choose(options: InternalImageInsertOptions = {}): Promise<ElementId | null> {
    return this.chooseFile('选择要插入的图片', 'webPptImageInput', (file) => this.insert(file, options));
  }

  chooseReplacement(id: ElementId, options: ImageReplaceOptions = {}): Promise<ElementId | null> {
    return this.chooseFile(
      '选择替换图片', 'webPptImageReplacementInput', (file) => this.replace(id, file, options),
    );
  }

  private chooseFile(
    label: string,
    marker: 'webPptImageInput' | 'webPptImageReplacementInput',
    commit: (file: File) => Promise<ElementId>,
  ): Promise<ElementId | null> {
    if (this.destroyed) return Promise.reject(new Error('不能通过已销毁视图选择图片'));
    if (!this.options.editable()) return Promise.reject(new Error('查看模式不能选择图片'));
    if (this.cancelChooser) return Promise.reject(new Error('已有图片文件选择正在进行'));
    const input = this.options.root.ownerDocument.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.dataset[marker] = '';
    input.setAttribute('aria-label', label);
    input.tabIndex = -1;
    input.style.position = 'absolute';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    this.options.root.append(input);
    return new Promise<ElementId | null>((resolve, reject) => {
      let settled = false;
      const finish = (value: ElementId | null, error?: unknown): void => {
        if (settled) return;
        settled = true;
        this.cancelChooser = null;
        input.remove();
        if (error) reject(error); else resolve(value);
      };
      this.cancelChooser = () => finish(null);
      input.addEventListener('cancel', () => finish(null), { once: true });
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        input.remove();
        void commit(file).then((id) => finish(id), (error) => finish(null, error));
      }, { once: true });
      try { input.click(); } catch (error) { finish(null, error); }
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelChooser?.();
  }

  private setReading(active: boolean): void {
    this.activeReads += active ? 1 : -1;
    if (this.activeReads > 0) {
      this.options.root.dataset.imageInsertState = 'reading';
      this.options.root.setAttribute('aria-busy', 'true');
    } else {
      this.activeReads = 0;
      if (this.options.root.dataset.imageInsertState !== 'error') {
        this.options.root.dataset.imageInsertState = 'idle';
      }
      this.options.root.removeAttribute('aria-busy');
    }
  }

  private report(error: unknown): void {
    this.options.root.dataset.imageInsertState = 'error';
    const CustomEventCtor = this.options.root.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
    this.options.root.dispatchEvent(new CustomEventCtor('webpptimageerror', { detail: error }));
  }

  private assertContext(slideId: SlideId, phase: string): void {
    if (this.destroyed) throw new Error(`图片${phase}期间视图已销毁`);
    if (!this.options.editable()) throw new Error(`图片${phase}期间视图已切换为查看模式`);
    if (this.options.slideId() !== slideId) throw new Error(`图片${phase}期间视图已切换页面`);
  }
}
