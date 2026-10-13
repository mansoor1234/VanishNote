import { sealNote, utf8ByteLength } from '../../lib/crypto';
import { MAX_NOTE_BYTES } from '../../lib/limits';
import { postForm, postJson } from '../http-client';
import { $, cooldown, formatBytes, guardUnload, initCopyButtons, initShareButtons, showState } from '../ui';

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : formatBytes(bytes);
}

/** Attachment picker with drag and drop. Returns the currently selected file. */
export function initDropzone(root: HTMLElement, limit: number, onError: (message: string) => void): () => File | null {
  const input = $<HTMLInputElement>('[data-file-input]', root);
  const zone = $('[data-dropzone]', root);
  const name = $('[data-file-name]', root);
  const detail = $('[data-file-detail]', root);
  const clear = $<HTMLButtonElement>('[data-file-clear]', root);
  const defaults = { name: name.textContent ?? '', detail: detail.textContent ?? '' };
  let file: File | null = null;

  const set = (next: File | null) => {
    if (next && next.size > limit) {
      onError(`That file is ${formatSize(next.size)}. Your plan allows attachments up to ${formatSize(limit)}.`);
      next = null;
    }
    file = next;
    name.textContent = file ? file.name : defaults.name;
    detail.textContent = file ? `${formatSize(file.size)} · will be encrypted before upload` : defaults.detail;
    clear.hidden = !file;
    if (!file) input.value = '';
  };
  input.addEventListener('change', () => set(input.files?.[0] ?? null));
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('border-accent');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('border-accent'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('border-accent');
    set(e.dataTransfer?.files[0] ?? null);
  });
  clear.addEventListener('click', () => set(null));
  input.form?.addEventListener('reset', () => set(null));
  return () => file;
}

export function initCreateNoteDialog(): void {
  const dialog = $<HTMLDialogElement>('#create-note');
  const form = $<HTMLFormElement>('form', dialog);
  const errorBox = $('[data-error]', dialog);
  const submit = $<HTMLButtonElement>('[data-submit]', dialog);
  const text = $<HTMLTextAreaElement>('#cn-text');
  const password = $<HTMLInputElement>('#cn-password');
  const confirm = $<HTMLInputElement>('#cn-confirm');
  const hint = $<HTMLInputElement>('#cn-hint');
  const recipient = $<HTMLInputElement>('#cn-recipient');
  const size = $('[data-size]', dialog);
  const limit = Number(dialog.dataset['attachmentLimit']);

  const fail = (message: string, focus?: HTMLElement) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    focus?.focus();
  };
  const currentFile = initDropzone(dialog, limit, (m) => fail(m));

  let releaseGuard: (() => void) | undefined;
  const saved = (id: string) => {
    if (id !== 'cn-link') return;
    releaseGuard?.();
    releaseGuard = undefined;
  };
  initCopyButtons(dialog, saved);
  initShareButtons(dialog, 'I sent you a private note:', saved);

  text.addEventListener('input', () => {
    const bytes = utf8ByteLength(text.value);
    size.textContent = formatBytes(bytes);
    size.classList.toggle('text-danger', bytes > MAX_NOTE_BYTES);
  });
  password.addEventListener('input', () => {
    hint.disabled = password.value === '';
  });
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.addEventListener('change', () => {
      for (const panel of form.querySelectorAll<HTMLElement>('[data-mode-panel]')) {
        panel.hidden = panel.dataset['modePanel'] !== radio.value;
      }
    });
  }
  form.addEventListener('reset', () => {
    errorBox.hidden = true;
    hint.disabled = true;
    size.textContent = formatBytes(0);
    window.setTimeout(() => {
      for (const panel of form.querySelectorAll<HTMLElement>('[data-mode-panel]')) panel.hidden = panel.dataset['modePanel'] !== 'read';
    });
  });

  dialog.addEventListener('cancel', (event) => {
    if (releaseGuard && !window.confirm("You haven't copied the link yet. It can't be shown again. Close anyway?")) {
      event.preventDefault();
    }
  });
  dialog.addEventListener('close', () => {
    if (!dialog.querySelector<HTMLElement>('[data-state="result"]')!.hidden) location.reload();
  });
  $('[data-done]', dialog).addEventListener('click', () => {
    if (releaseGuard && !window.confirm("You haven't copied the link yet. It can't be shown again. Close anyway?")) return;
    releaseGuard?.();
    releaseGuard = undefined;
    dialog.close();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) return fail('Give the note a title so you can find it later.', $('#cn-title'));
    if (text.value.trim() === '') return fail('Write the note first.', text);
    if (utf8ByteLength(text.value) > MAX_NOTE_BYTES) return fail(`The note is too long. The limit is ${MAX_NOTE_BYTES / 1024} KB.`, text);
    if (password.value !== confirm.value) return fail('The passwords don’t match.', confirm);
    const email = recipient.value.trim();
    if (email && !recipient.checkValidity()) return fail('Enter a valid email address for the recipient.', recipient);
    if (email && !password.value) {
      return fail('Add a password to email the link. Then send the password a different way.', password);
    }

    submit.disabled = true;
    submit.textContent = password.value ? 'Encrypting (this takes a moment)…' : 'Encrypting…';
    let retryAfter = 0;
    try {
      const file = currentFile();
      const sealed = await sealNote(
        text.value,
        password.value || undefined,
        file ? { bytes: new Uint8Array(await file.arrayBuffer()), meta: { name: file.name, type: file.type || 'application/octet-stream' } } : undefined,
      );
      const meta: Record<string, unknown> = {
        ...sealed.payload,
        title,
        shred:
          data.get('mode') === 'time'
            ? { mode: 'time', expiresIn: data.get('expiresIn') }
            : { mode: 'read', maxReads: Number(data.get('maxReads')) },
      };
      const hintValue = String(data.get('passwordHint') ?? '').trim();
      if (password.value && hintValue) meta['passwordHint'] = hintValue;
      if (sealed.file) meta['file'] = { iv: sealed.file.iv, meta: sealed.file.meta, metaIv: sealed.file.metaIv };

      const body = new FormData();
      body.set('meta', JSON.stringify(meta));
      if (sealed.file) body.set('file', new Blob([sealed.file.bytes], { type: 'application/octet-stream' }), 'encrypted.bin');
      submit.textContent = sealed.file ? 'Uploading encrypted file…' : 'Saving…';
      const result = await postForm<{ id: string; path: string }>('/api/account/notes', body);
      if (!result.ok) {
        retryAfter = result.retryAfter ?? 0;
        return fail(result.message);
      }

      const link = `${location.origin}${result.data.path}#${sealed.linkKey}`;
      $<HTMLInputElement>('#cn-link').value = link;
      $('[data-password-tip]', dialog).hidden = !password.value;
      const emailed = $('[data-emailed]', dialog);
      emailed.hidden = true;
      if (email) {
        const sent = await postJson(`/api/account/notes/${result.data.id}/send`, { recipientEmail: email, linkKey: sealed.linkKey });
        emailed.hidden = false;
        emailed.className = sent.ok ? 'notice-success' : 'notice-danger';
        emailed.textContent = sent.ok ? `We emailed the link to ${email}.` : `The note was created, but the email failed: ${sent.message}`;
      }
      form.reset();
      releaseGuard = guardUnload();
      showState(dialog, 'result');
    } catch {
      fail('Encryption failed in this browser. Please try a current version of Chrome, Firefox, Safari or Edge.');
    } finally {
      submit.textContent = 'Create note';
      if (retryAfter > 0) cooldown(submit, retryAfter);
      else submit.disabled = false;
    }
  });
}
