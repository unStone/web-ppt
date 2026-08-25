let viewSerial = 0;

export function nextViewIdPrefix(documentPrefix: string): string {
  return `${documentPrefix}view-${++viewSerial}-`;
}

export function createEditorLayer(document: Document, name: string): HTMLDivElement {
  const element = document.createElement('div');
  element.dataset.pptLayer = name;
  element.style.position = 'absolute';
  element.style.inset = '0';
  return element;
}
