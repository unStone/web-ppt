import { detectImageMime, MAX_REPLACE_IMAGE_BYTES } from '@web-ppt/edit-core';
import type {
  AddImageCommand, Editor, ElementId, ReplaceImageCommand, SetBackgroundImageCommand, SlideId,
} from '@web-ppt/edit-core';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
type DetectedImageMime = NonNullable<ReturnType<typeof detectImageMime>>;
type ImageCommand = AddImageCommand | ReplaceImageCommand | SetBackgroundImageCommand;

export interface ImageInsertOptions {
  readonly signal?: AbortSignal;
  readonly rect?: AddImageCommand['rect'];
  /** 默认 5MB：留足默认 8MB 历史预算所需的 Base64 开销，保证插入后仍可撤销。 */
  readonly maxBytes?: number;
}

export interface ImageReplaceOptions {
  readonly signal?: AbortSignal;
  /** 默认使用当前单选图片。 */
  readonly id?: ElementId;
  readonly maxBytes?: number;
}

export interface ImageBackgroundOptions {
  readonly signal?: AbortSignal;
  readonly crop?: SetBackgroundImageCommand['crop'];
  readonly alpha?: SetBackgroundImageCommand['alpha'];
  readonly tile?: SetBackgroundImageCommand['tile'];
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

interface ImageReadRequest {
  readonly signal?: AbortSignal;
  readonly blob: Blob;
  readonly maxBytes?: number;
  readonly slideId: SlideId;
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
  const scale = Math.min(Math.max(1, 96 / Math.max(width, height)), slideWidth * .8 / width, slideHeight * .8 / height);
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
    image.src = url;
    await image.decode();
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

  private async applyImage(
    request: ImageReadRequest,
    command: (image: { bytes: Uint8Array; mime: DetectedImageMime }) => ImageCommand | Promise<ImageCommand>,
  ): Promise<ReturnType<Editor['exec']>> {
    let reading = false;
    try {
      const { blob, slideId } = request;
      this.assertContext(slideId, '读取', request.signal);
      if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size)) {
        throw new Error('图片文件必须提供 File 或 Blob');
      }
      const maximum = request.maxBytes ?? MAX_REPLACE_IMAGE_BYTES;
      if (!Number.isInteger(maximum) || maximum <= 0) throw new Error('图片字节上限必须是正整数');
      if (blob.size <= 0) throw new Error('图片文件不能为空');
      if (blob.size > maximum) {
        throw new Error(`图片大小不能超过 ${formatByteLimit(maximum)}，以保证本地撤销可用`);
      }
      this.setReading(true);
      reading = true;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      this.assertContext(slideId, '读取', request.signal);
      const mime = detectImageMime(bytes);
      if (!mime) throw new Error('只支持完整的 PNG、JPEG、GIF 或 WebP 图片');
      const value = await command({ bytes, mime });
      this.assertContext(slideId, '提交', request.signal);
      return this.options.editor.exec(value);
    } catch (error) {
      if (!request.signal?.aborted) {
        const root = this.options.root;
        root.dataset.imageInsertState = 'error';
        const Event = root.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
        root.dispatchEvent(new Event('webpptimageerror', { detail: error }));
      }
      throw error;
    } finally {
      if (reading) this.setReading(false);
    }
  }

  async insert(blob: Blob, options: InternalImageInsertOptions = {}): Promise<ElementId> {
    const slideId = this.options.slideId();
    const result = await this.applyImage({
      ...options, blob, slideId,
    }, async ({ bytes, mime }) => {
      const size = await decodedSize(blob, this.options.root.ownerDocument);
      const { width, height } = this.options.editor.doc.meta;
      const placement = options.rect || fittedRect(size.width, size.height, width, height);
      return {
        type: 'AddImage', slideId, bytes, mime, rect: placement,
        ...(options.placeholderId ? { placeholderId: options.placeholderId } : {}),
      };
    });
    const id = result.forward.find((patch) =>
      patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2)?.path[1];
    if (!id || this.options.editor.doc.elements[id]?.src.kind !== 'image') {
      throw new Error('图片命令没有返回新元素身份');
    }
    return id;
  }

  async replace(id: ElementId, blob: Blob, options: ImageReplaceOptions = {}): Promise<ElementId> {
    const slideId = this.options.slideId();
    await this.applyImage({
      ...options, blob, slideId,
    }, (image) => ({ type: 'ReplaceImage', id, ...image }));
    return id;
  }

  choose(options: InternalImageInsertOptions = {}): Promise<ElementId | null> {
    return this.chooseFile('选择要插入的图片', 'webPptImageInput', (file) => this.insert(file, options), options.signal);
  }

  chooseReplacement(id: ElementId, options: ImageReplaceOptions = {}): Promise<ElementId | null> {
    return this.chooseFile(
      '选择替换图片', 'webPptImageReplacementInput', (file) => this.replace(id, file, options), options.signal,
    );
  }

  async setBackground(blob: Blob, options: ImageBackgroundOptions = {}): Promise<SlideId> {
    const slideId = this.options.slideId();
    await this.applyImage({
      ...options, blob, slideId,
    }, (image) => ({
      type: 'SetBackgroundImage', id: slideId, ...image,
      ...(options.crop ? { crop: options.crop } : {}),
      ...(options.alpha !== undefined ? { alpha: options.alpha } : {}),
      ...(options.tile ? { tile: options.tile } : {}),
    }));
    return slideId;
  }

  chooseBackground(options: ImageBackgroundOptions = {}): Promise<SlideId | null> {
    return this.chooseFile(
      '选择页面背景图片', 'webPptBackgroundImageInput',
      (file) => this.setBackground(file, options), options.signal,
    );
  }

  private async chooseFile<T extends string>(
    label: string,
    marker: 'webPptImageInput' | 'webPptImageReplacementInput' | 'webPptBackgroundImageInput',
    commit: (file: File) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    if (signal?.aborted) return null;
    this.assertContext(this.options.slideId(), '选择', signal);
    if (this.cancelChooser) throw new Error('已有图片文件选择正在进行');
    const input = this.options.root.ownerDocument.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.dataset[marker] = '';
    input.setAttribute('aria-label', label);
    input.tabIndex = -1;
    input.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    this.options.root.append(input);
    return new Promise<T | null>((resolve, reject) => {
      let settled = false;
      const finish = (value: T | null, error?: unknown): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        this.cancelChooser = null;
        input.remove();
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(null);
      this.cancelChooser = cancel;
      signal?.addEventListener('abort', cancel, { once: true });
      input.addEventListener('cancel', cancel, { once: true });
      input.addEventListener('change', () => {
        if (settled) return;
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        input.remove();
        void commit(file).then((id) => finish(id), (error) => finish(null, error));
      }, { once: true });
      if (signal?.aborted || this.destroyed) { cancel(); return; }
      try { input.click(); } catch (error) { finish(null, error); }
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelChooser?.();
  }

  private setReading(active: boolean): void {
    const root = this.options.root;
    this.activeReads += active ? 1 : -1;
    if (this.activeReads > 0) {
      root.dataset.imageInsertState = 'reading';
      root.setAttribute('aria-busy', 'true');
    } else {
      this.activeReads = 0;
      if (root.dataset.imageInsertState !== 'error') {
        root.dataset.imageInsertState = 'idle';
      }
      root.removeAttribute('aria-busy');
    }
  }

  private assertContext(slideId: SlideId, phase: string, signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason ?? new Error('图片操作已取消');
    if (this.destroyed) throw new Error(`图片${phase}期间视图已销毁`);
    if (!this.options.editable()) throw new Error(`图片${phase}期间视图已切换为查看模式`);
    if (this.options.slideId() !== slideId) throw new Error(`图片${phase}期间视图已切换页面`);
  }
}
