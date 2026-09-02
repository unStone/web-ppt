import type { SectionId, SlideId } from './identities';

export interface ElementAltTextOverrides {
  title?: string;
  descr?: string;
}

export interface ElementAltTextState {
  readonly title: string;
  readonly descr: string;
  readonly sourceTitle: string;
  readonly sourceDescr: string;
  readonly directTitle: boolean;
  readonly directDescr: boolean;
  readonly direct: boolean;
}

export interface SlideSizeState {
  readonly w: number;
  readonly h: number;
  readonly sourceW: number;
  readonly sourceH: number;
  readonly direct: boolean;
}

export interface SectionRecord {
  readonly id: SectionId;
  /** 写回 p14:section@id 的 GUID；与会话身份分开，避免格式身份渗入命令目标。 */
  readonly presentationId: string;
  name: string;
  slideIds: SlideId[];
}

export interface SectionState {
  records: Record<SectionId, SectionRecord>;
  order: SectionId[];
  /** 仅显式节命令置为 true；普通增删页仍走保留未知 XML 的增量写回。 */
  edited: boolean;
}
