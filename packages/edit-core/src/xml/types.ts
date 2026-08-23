export type XmlQuote = '"' | "'";

export interface XmlAttribute {
  readonly name: string;
  readonly prefix: string | null;
  readonly localName: string;
  readonly namespaceUri: string | null;
  readonly value: string;
  readonly quote: XmlQuote;
}

export interface XmlElement {
  readonly type: 'element';
  readonly name: string;
  readonly prefix: string | null;
  readonly localName: string;
  readonly namespaceUri: string | null;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
  readonly selfClosing: boolean;
}

export interface XmlText {
  readonly type: 'text';
  readonly value: string;
}

export interface XmlCdata {
  readonly type: 'cdata';
  readonly value: string;
}

export interface XmlComment {
  readonly type: 'comment';
  readonly value: string;
}

export interface XmlProcessingInstruction {
  readonly type: 'processing-instruction';
  readonly target: string;
  readonly value: string;
}

export interface XmlDeclaration {
  readonly type: 'declaration';
  readonly value: string;
}

export type XmlNode = XmlElement | XmlText | XmlCdata | XmlComment
  | XmlProcessingInstruction | XmlDeclaration;

export interface XmlDocument {
  readonly type: 'document';
  readonly children: readonly XmlNode[];
  readonly root: XmlElement;
}
