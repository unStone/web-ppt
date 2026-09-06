export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  try { Object.assign(document.createElement('a'), { href: url, download: name }).click(); }
  finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
