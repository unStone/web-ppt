import { unzipSync } from 'fflate';
import { embeddedFontToSfnt } from '../font/eot';
import { readImageMetadata } from '../image-metadata';
import type { ImageMetadata } from '../image-metadata';
import { METAFILE_EXT, metafileDataUrl } from '../metafile';
import type { OpcPackage } from '../types';
import { attr, kids, parseXml } from '../xml';
import { PackageAssetStore } from './asset-store';
import type { AssetMode, DeferredAsset } from './asset-store';
import type { Rels } from './slide-inheritance';

const decoder = new TextDecoder();
const EMPTY_BYTES = new Uint8Array(0);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
};

const METAFILE_MIME: Record<string, string> = {
  emf: 'image/x-emf', wmf: 'image/x-wmf', pict: 'image/x-pict', pct: 'image/x-pict', pic: 'image/x-pict',
};

function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out: string[] = [];
  for (const seg of (baseDir + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

/** 常规解析与版式重解析共享同一份 OOXML 包读取器，并统一管理资源 URL 的生命周期。 */
export class Pkg {
  files: Record<string, Uint8Array>;
  private readonly assetStore: PackageAssetStore;
  private readonly existingAssetUrls = new Map<string, string>();
  private xmlCache = new Map<string, Element | null>();
  private relsCache = new Map<string, Rels>();
  private imageMetadataCache = new Map<string, ImageMetadata | null>();
  private cacheTrace: Set<string> | null = null;
  private sourceBytes: Uint8Array | null = null;
  private opcHandle: OpcPackage | undefined;
  private isDisposed = false;

  constructor(source: Uint8Array | OpcPackage, keepPackage = false) {
    const borrowed = !(source instanceof Uint8Array);
    this.files = borrowed
      ? source.parts as Record<string, Uint8Array>
      : unzipSync(source);
    this.assetStore = new PackageAssetStore(keepPackage, borrowed ? 'layout-asset:' : 'asset:');
    if (borrowed) {
      for (const [url, asset] of Object.entries(source.assets ?? {})) {
        if (asset.sourcePart) this.existingAssetUrls.set(asset.sourcePart, url);
      }
    } else if (keepPackage) {
      // 50MB 演示若再复制一份原包，会把编辑模式的内存预算直接吃掉；公开句柄只暴露只读视图。
      this.sourceBytes = source;
      const owner = this;
      this.opcHandle = Object.freeze({
        format: 'pptx' as const,
        get bytes(): Uint8Array { return owner.sourceBytes ?? EMPTY_BYTES; },
        get parts(): Readonly<Record<string, Uint8Array>> { return owner.files; },
        get assets(): Readonly<Record<string, { mime: string; bytes: Uint8Array }>> {
          return owner.assetStore.published;
        },
        get disposed(): boolean { return owner.isDisposed; },
      });
    }
  }

  set assetMode(value: AssetMode) { this.assetStore.mode = value; }
  get deferred(): DeferredAsset[] { return this.assetStore.deferred; }
  get opcPackage(): OpcPackage | undefined { return this.opcHandle; }

  xml(path: string): Element | null {
    this.cacheTrace?.add(path);
    if (!this.xmlCache.has(path)) {
      const data = this.files[path];
      let root: Element | null = null;
      if (data) {
        try {
          root = parseXml(decoder.decode(data));
        } catch {
          root = null;
        }
      }
      this.xmlCache.set(path, root);
    }
    return this.xmlCache.get(path) ?? null;
  }

  forgetXml(path: string): void {
    this.xmlCache.delete(path);
  }

  /** 页面级重解析结束后同时释放 part 与其关系表，避免浏览页数决定常驻内存。 */
  forgetPart(path: string): void {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    this.xmlCache.delete(path);
    this.relsCache.delete(path);
    this.xmlCache.delete(`${dir}_rels/${path.slice(dir.length)}.rels`);
    this.imageMetadataCache.delete(path);
  }

  beginCacheTrace(): Set<string> {
    if (this.cacheTrace) throw new Error('OPC 缓存访问作用域不能嵌套');
    this.cacheTrace = new Set();
    return this.cacheTrace;
  }

  endCacheTrace(trace: Set<string>): readonly string[] {
    if (this.cacheTrace !== trace) throw new Error('OPC 缓存访问作用域不匹配');
    this.cacheTrace = null;
    return [...trace];
  }

  rels(partPath: string): Rels {
    this.cacheTrace?.add(partPath);
    if (!this.relsCache.has(partPath)) {
      const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1);
      const out: Rels = {};
      const root = this.xml(`${dir}_rels/${partPath.slice(dir.length)}.rels`);
      for (const rel of kids(root, 'Relationship')) {
        const id = attr(rel, 'Id');
        const target = attr(rel, 'Target');
        if (!id || !target) continue;
        const external = attr(rel, 'TargetMode') === 'External';
        out[id] = {
          type: attr(rel, 'Type') ?? '',
          target: external ? target : resolvePath(dir, target),
        };
      }
      this.relsCache.set(partPath, out);
    }
    return this.relsCache.get(partPath)!;
  }

  blobUrl(path: string, mime: string): string | null {
    const existing = this.existingAssetUrls.get(path);
    if (existing) return existing;
    const data = this.files[path];
    return data ? this.assetStore.store(`${mime}|${path}`, data, mime, path) : null;
  }

  /** fntdata 是 EOT；必须先还原 sfnt，不能把浏览器必定拒绝的容器伪装成 TTF。 */
  fontUrl(path: string): string | null {
    const existing = this.existingAssetUrls.get(path);
    if (existing) return existing;
    const raw = this.files[path];
    if (!raw) return null;
    const font = embeddedFontToSfnt(raw);
    return font ? this.assetStore.store(`font|${path}`, font.data, font.mime, path) : null;
  }

  /** 释放全部 blob URL，并清空缓存以便 zip 数据被回收。 */
  dispose(): void {
    this.assetStore.dispose();
    this.xmlCache.clear();
    this.relsCache.clear();
    this.imageMetadataCache.clear();
    this.files = {};
    this.sourceBytes = null;
    this.isDisposed = true;
  }

  mediaUrl(path: string): string | null {
    const existing = this.existingAssetUrls.get(path);
    if (existing) return existing;
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (METAFILE_EXT.has(ext)) {
      const key = `mf|${path}`;
      const result = this.assetStore.cached(key, () => {
        const data = this.files[path];
        return data ? metafileDataUrl(data) : null;
      });
      const data = this.files[path];
      if (result && data) {
        this.assetStore.publish(result, data, METAFILE_MIME[ext] ?? 'application/octet-stream', path);
      }
      return result;
    }
    const mime = MIME[ext];
    return mime ? this.blobUrl(path, mime) : null;
  }

  imageMetadata(path: string): ImageMetadata | null {
    this.cacheTrace?.add(path);
    if (!this.imageMetadataCache.has(path)) {
      const bytes = this.files[path];
      this.imageMetadataCache.set(path, bytes ? readImageMetadata(bytes) : null);
    }
    return this.imageMetadataCache.get(path) ?? null;
  }
}
