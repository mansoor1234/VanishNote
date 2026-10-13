import { NoteTooLargeError, publicKeyFingerprint, sealForRequest, utf8ByteLength } from '../lib/crypto';
import { MAX_NOTE_BYTES } from '../lib/limits';
import { initDropzone } from './app/create-note';
import { postForm } from './http-client';
import { $, cooldown, formatBytes, showState } from './ui';

export function initRespond(): void {
  const root = document.querySelector<HTMLElement>('#respond');
  const publicKey = root?.dataset['publicKey'];
  if (!root || !publicKey) return;
  const fingerprint = location.hash.slice(1);
  const form = $<HTMLFormElement>('form', root);
  const text = $<HTMLTextAreaElement>('#r-text');
  const size = $('[data-size]', root);
  const errorBox = $('[data-error]', root);
  const submit = $<HTMLButtonElement>('[data-submit]', root);
  const fail = (message: string, focus?: HTMLElement) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    focus?.focus();
  };

  // Check the link's fingerprint against the key we were given before the user types anything.
  void publicKeyFingerprint(publicKey).then((expected) => {
    if (expected !== fingerprint) showState(root, 'tampered');
  });

  const currentFile = initDropzone(root, Number(root.dataset['attachmentLimit']), (m) => fail(m));
  text.addEventListener('input', () => {
    size.textContent = formatBytes(utf8ByteLength(text.value));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const file = currentFile();
    if (text.value.trim() === '' && !file) return fail('Write a reply or attach a file first.', text);
    if (utf8ByteLength(text.value) > MAX_NOTE_BYTES) return fail(`Your reply is too long. The limit is ${MAX_NOTE_BYTES / 1024} KB.`, text);

    submit.disabled = true;
    submit.textContent = 'Encrypting…';
    let retryAfter = 0;
    try {
      const sealed = await sealForRequest(
        publicKey,
        fingerprint,
        text.value,
        file ? { bytes: new Uint8Array(await file.arrayBuffer()), meta: { name: file.name, type: file.type || 'application/octet-stream' } } : undefined,
      );
      const meta: Record<string, unknown> = { response: sealed.response, responseIv: sealed.responseIv, epk: sealed.epk };
      if (sealed.file) meta['file'] = { iv: sealed.file.iv, meta: sealed.file.meta, metaIv: sealed.file.metaIv };
      const body = new FormData();
      body.set('meta', JSON.stringify(meta));
      if (sealed.file) body.set('file', new Blob([sealed.file.bytes], { type: 'application/octet-stream' }), 'encrypted.bin');
      submit.textContent = sealed.file ? 'Uploading encrypted file…' : 'Sending…';
      const result = await postForm(`/api/requests/${encodeURIComponent(location.pathname.split('/').pop() ?? '')}/respond`, body);
      if (!result.ok) {
        retryAfter = result.retryAfter ?? 0;
        return fail(result.message);
      }
      form.reset();
      showState(root, 'sent');
    } catch (err) {
      if (err instanceof NoteTooLargeError) return fail('Your reply is too long.', text);
      showState(root, 'tampered');
    } finally {
      submit.textContent = 'Encrypt and send';
      if (retryAfter > 0) cooldown(submit, retryAfter);
      else submit.disabled = false;
    }
  });
}
