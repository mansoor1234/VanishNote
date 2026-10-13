/** Fetch an encrypted attachment with its one-time token, and save decrypted bytes as a file. */

export async function fetchEncrypted(downloadToken: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(`/api/files/${encodeURIComponent(downloadToken)}`, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(res.status === 404 ? 'gone' : 'failed');
  return new Uint8Array(await res.arrayBuffer());
}

/** Strip path separators and control characters from a decrypted file name. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(0, 200) || 'attachment';
}

export function saveFile(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  // Always offered as a download, never opened inline: the type is octet-stream on purpose.
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
