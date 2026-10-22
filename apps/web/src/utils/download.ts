/** Hands a fetched file to the browser's download UI. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled; the download keeps its own reference.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
