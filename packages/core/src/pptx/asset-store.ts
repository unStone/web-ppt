import type { OpcPackageAsset } from '../types';

/** 资源产出方式：主线程直接建 blob URL；Worker 里只能发令牌，由主线程兑现。 */
export type AssetMode = 'blob' | 'defer';

export interface DeferredAsset {
  mime: string;
  data: Uint8Array;
}

/** 集中管理解析期资源地址、Worker 令牌与可编辑包的字节映射。 */
export class PackageAssetStore {
  mode: AssetMode = 'blob';
  /** defer 模式下按 asset:N 的 N 顺序收集。 */
  readonly deferred: DeferredAsset[] = [];
  private readonly deferredIndex = new Map<string, string>();
  private readonly urlCache = new Map<string, string | null>();
  private objectUrls: string[] = [];
  private packageAssets: Record<string, OpcPackageAsset> = Object.create(null);

  constructor(private readonly publishAssets: boolean) {}

  get published(): Readonly<Record<string, OpcPackageAsset>> {
    return this.packageAssets;
  }

  /** 把一段字节挂成可引用的地址：defer 下发令牌，否则建 blob URL。 */
  store(key: string, data: Uint8Array, mime: string): string {
    let result: string;
    if (this.mode === 'defer') {
      let token = this.deferredIndex.get(key);
      if (token === undefined) {
        token = `asset:${this.deferred.length}`;
        this.deferred.push({ mime, data });
        this.deferredIndex.set(key, token);
      }
      result = token;
    } else {
      let url = this.urlCache.get(key);
      if (url === undefined) {
        url = URL.createObjectURL(new Blob([data.slice().buffer], { type: mime }));
        this.objectUrls.push(url);
        this.urlCache.set(key, url);
      }
      result = url!;
    }
    if (this.publishAssets) this.packageAssets[result] = { mime, bytes: data };
    return result;
  }

  cached(key: string, create: () => string | null): string | null {
    if (!this.urlCache.has(key)) this.urlCache.set(key, create());
    return this.urlCache.get(key) ?? null;
  }

  /** 只撤销本模块创建的 blob URL；data URI 与 Worker 令牌无需释放。 */
  dispose(): void {
    for (const url of this.objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* 已释放 */
      }
    }
    this.objectUrls = [];
    this.urlCache.clear();
    this.packageAssets = Object.create(null);
  }
}
