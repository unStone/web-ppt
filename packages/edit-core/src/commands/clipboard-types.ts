import type { GeomSpec, SlideElement } from '@web-ppt/core';
import type { AffineMatrix } from '../space';
import type { EditableKind, SlideId, TableCellAddress } from '../types';

export interface ElementClipboardRecordMeta {
  /** 同一次复制操作的来源证明；粘贴时用来拒绝拼接多个来源的伪造树。 */
  readonly copyBatchId: string;
  readonly editable: EditableKind;
  readonly anchored: boolean;
  readonly sourceSpid?: number;
  readonly geom?: GeomSpec;
  /** 复制时根元素的 frame → slide 视觉矩阵；后代不需要重复携带。 */
  readonly frameToSlide?: AffineMatrix;
  readonly link?: ClipboardPortableLink;
  readonly textLinks?: readonly ClipboardTextLink[];
}

export type ClipboardPortableLink = {
  readonly kind: 'external';
  readonly href: string;
} | {
  readonly kind: 'slide';
  readonly sourceSlideId: SlideId;
  readonly packageTarget?: { readonly rootHash: string; readonly closureHash: string };
} | {
  readonly kind: 'none';
} | {
  readonly kind: 'unsupported';
} | {
  readonly kind: 'relative';
  readonly action: 'next' | 'previous' | 'first' | 'last';
};

export interface ClipboardTextLink {
  readonly paragraph: number;
  readonly run: number;
  readonly cell?: TableCellAddress;
  readonly value: ClipboardPortableLink;
}

export interface ClipboardXmlRoot {
  readonly markup: string;
  readonly namespaces: Readonly<Record<string, string>>;
  readonly hostSpids: readonly string[];
  readonly relationships?: readonly ClipboardRelationship[];
}

export interface ClipboardRelationship {
  /** 宿主片段中原始的 r:id / r:embed / r:link 值。 */
  readonly sourceId: string;
  readonly type: string;
  readonly target?: string;
  readonly targetMode?: 'External';
  readonly resourceHash?: string;
  /** 复杂 OOXML 对象只在目标包拥有同一闭包时复用，不把未知格式静默扁平化。 */
  readonly packageTarget?: {
    /** 根内容与关系图都不包含 part 路径，目标包据此重新定位等价闭包。 */
    readonly rootHash: string;
    readonly closureHash: string;
  };
}

export interface ClipboardElementRecord {
  readonly id: string;
  readonly parent: string | null;
  readonly src: SlideElement;
  readonly meta: ElementClipboardRecordMeta;
  readonly children: readonly string[];
}

export interface ClipboardResource {
  readonly hash: string;
  readonly mime: string;
  readonly extension: string;
  readonly bytes: string;
}

export interface ElementClipboardPayload {
  readonly format: 'web-ppt-elements';
  readonly version: 1;
  readonly source: { readonly width: number; readonly height: number; readonly copyBatchId: string };
  readonly bounds: { readonly left: number; readonly top: number };
  readonly roots: readonly string[];
  readonly records: Readonly<Record<string, ClipboardElementRecord>>;
  readonly ooxml: { readonly roots: Readonly<Record<string, ClipboardXmlRoot>> };
  readonly resources: readonly ClipboardResource[];
}
