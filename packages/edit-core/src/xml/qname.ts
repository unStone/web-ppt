export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
export const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PRESENTATIONML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
export const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const ASCII_NCNAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const UNICODE_NCNAME = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{N}\p{M}\p{Pc}_.\-\u00B7\u203F-\u2040]*$/u;
const isNcName = (name: string): boolean => ASCII_NCNAME.test(name) || UNICODE_NCNAME.test(name);

export function isXmlQName(name: string): boolean {
  const colon = name.indexOf(':');
  if (colon < 0) return isNcName(name);
  return colon === name.lastIndexOf(':') && isNcName(name.slice(0, colon)) && isNcName(name.slice(colon + 1));
}

export function assertXmlQName(name: string, kind: '元素' | '属性'): void {
  if (!isXmlQName(name)) throw new Error(`非法 XML ${kind}名：${name}`);
}

export const splitQName = (name: string): { prefix: string | null; localName: string } => {
  const colon = name.indexOf(':');
  return colon < 0
    ? { prefix: null, localName: name }
    : { prefix: name.slice(0, colon), localName: name.slice(colon + 1) };
};

export function namespaceForQName(
  name: string,
  namespaces: ReadonlyMap<string, string>,
  attribute: boolean,
): string | null {
  const parts = splitQName(name);
  if (attribute && (name === 'xmlns' || parts.prefix === 'xmlns')) return XMLNS_NS;
  if (parts.prefix === 'xml') return XML_NS;
  if (parts.prefix) return namespaces.get(parts.prefix) || null;
  return attribute ? null : namespaces.get('') || null;
}
