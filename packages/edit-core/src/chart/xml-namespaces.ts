export const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
export const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
export const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const STRICT_ROOT = 'http://purl.oclc.org/ooxml';
export const STRICT_CHART_NS = `${STRICT_ROOT}/drawingml/chart`;
export const STRICT_DRAWING_NS = `${STRICT_ROOT}/drawingml/main`;
export const STRICT_PRESENTATION_NS = `${STRICT_ROOT}/presentationml/main`;
export const STRICT_OFFICE_REL_NS = `${STRICT_ROOT}/officeDocument/relationships`;
export const STRICT_SPREADSHEET_NS = `${STRICT_ROOT}/spreadsheetml/main`;

const either = (value: string | null, transitional: string, strict: string): boolean =>
  value === transitional || value === strict;

export const isChartNamespace = (value: string | null): boolean =>
  either(value, CHART_NS, STRICT_CHART_NS);
export const isDrawingNamespace = (value: string | null): boolean =>
  either(value, DRAWING_NS, STRICT_DRAWING_NS);
export const isPresentationNamespace = (value: string | null): boolean =>
  either(value, PRESENTATION_NS, STRICT_PRESENTATION_NS);
export const isOfficeRelationshipNamespace = (value: string | null): boolean =>
  either(value, OFFICE_REL_NS, STRICT_OFFICE_REL_NS);
export const isSpreadsheetNamespace = (value: string | null): boolean =>
  either(value, SPREADSHEET_NS, STRICT_SPREADSHEET_NS);
