import { encryptNote, utf8ByteLength } from '../lib/crypto';
import { MAX_NOTE_BYTES, type ExpiryOption } from '../lib/limits';
import { createNote } from './api-client';
import { initCipherPreview } from './cipher-preview';
import {
  $,
  cooldown,
  formatBytes,
  guardUnload,
  initCopyButtons,
  initPasswordToggles,
  initShareButtons,
  showState,
} from './ui';

export function initCreateForm(): void {
  const root = $('#composer');
  const form = $<HTMLFormElement>('#create-form');
  const text = $<HTMLTextAreaElement>('#note-text');
  const size = $('[data-size]');
  const password = $<HTMLInputElement>('#note-password');
  const notifyToggle = $<HTMLInputElement>('#notify-toggle');
  const notifyFields = $('#notify-fields');
  const notifyEmail = $<HTMLInputElement>('#notify-email');
  const errorBox = $('#create-error');
  const submit = $<HTMLButtonElement>('#create-submit');

  // The share link can't be shown again, so keep the sender from losing it by accident:
  // until it has been copied or shared, reload/close and "Write another note" ask first.
  let releaseGuard: (() => void) | undefined;
  const linkSaved = (targetId: string) => {
    if (targetId !== 'share-link') return;
    releaseGuard?.();
    releaseGuard = undefined;
  };

  initCopyButtons(root, linkSaved);
  initShareButtons(root, 'I sent you a private note. It can only be opened once:', linkSaved);
  initPasswordToggles(root);

  const showError = (message: string, focus?: HTMLElement) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    focus?.focus();
  };

  initCipherPreview(text, $('[data-cipher-output]', root));

  text.addEventListener('input', () => {
    const bytes = utf8ByteLength(text.value);
    size.textContent = formatBytes(bytes);
    size.classList.toggle('text-danger', bytes > MAX_NOTE_BYTES);
    text.setAttribute('aria-invalid', String(bytes > MAX_NOTE_BYTES));
  });

  notifyToggle.addEventListener('change', () => {
    notifyFields.hidden = !notifyToggle.checked;
    if (notifyToggle.checked) notifyEmail.focus();
  });

  // Seconds to keep the submit button disabled after a 429.
  let cooldownAfter = 0;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const plaintext = text.value;
    if (plaintext.trim() === '') return showError('Write something first.', text);
    if (utf8ByteLength(plaintext) > MAX_NOTE_BYTES) {
      return showError(`Your note is too long. The limit is ${MAX_NOTE_BYTES / 1024} KB.`, text);
    }
    const email = notifyToggle.checked ? notifyEmail.value.trim() : '';
    if (notifyToggle.checked && !notifyEmail.checkValidity()) {
      return showError('Enter a valid email address, or turn off read notifications.', notifyEmail);
    }
    if (notifyToggle.checked && email === '') {
      return showError('Enter your email address, or turn off read notifications.', notifyEmail);
    }

    submit.disabled = true;
    submit.textContent = password.value ? 'Encrypting (this takes a moment)…' : 'Encrypting…';
    try {
      const { payload, linkKey } = await encryptNote(plaintext, password.value || undefined);
      const data = new FormData(form);
      const result = await createNote(payload, {
        expiresIn: data.get('expiresIn') as ExpiryOption,
        maxReads: Number(data.get('maxReads')),
        ...(email ? { notifyEmail: email } : {}),
      });
      if (!result.ok) {
        showError(result.message);
        if (result.retryAfter) cooldownAfter = result.retryAfter;
        return;
      }

      const { id, deleteToken, expiresAt } = result.data;
      $<HTMLInputElement>('#share-link').value = `${location.origin}/n/${id}#${linkKey}`;
      $<HTMLInputElement>('#destroy-link').value = `${location.origin}/d/${id}#${deleteToken}`;
      $('[data-expiry]').textContent = `If nobody opens it, it will be deleted on ${new Date(expiresAt).toLocaleString()}.`;
      for (const tip of root.querySelectorAll<HTMLElement>('[data-password-tip]')) tip.hidden = !password.value;

      // Drop the plaintext and password from the page now that they're no longer needed.
      form.reset();
      size.textContent = formatBytes(0);
      notifyFields.hidden = true;
      releaseGuard = guardUnload();
      showState(root, 'result');
    } catch {
      showError('Encryption failed in this browser. Please try a current version of Chrome, Firefox, Safari or Edge.');
    } finally {
      submit.textContent = 'Create secure link';
      if (cooldownAfter > 0) cooldown(submit, cooldownAfter);
      else submit.disabled = false;
      cooldownAfter = 0;
    }
  });

  $('#create-another').addEventListener('click', () => {
    if (
      releaseGuard &&
      !window.confirm("You haven't copied the link yet. It can't be shown again. Leave anyway?")
    ) {
      return;
    }
    releaseGuard?.();
    releaseGuard = undefined;
    $<HTMLInputElement>('#share-link').value = '';
    $<HTMLInputElement>('#destroy-link').value = '';
    showState(root, 'form');
    text.focus();
  });
}
