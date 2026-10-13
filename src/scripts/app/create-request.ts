import { createRequestKeys } from '../../lib/crypto';
import { postJson } from '../http-client';
import { $, cooldown, initCopyButtons, initShareButtons, showState } from '../ui';

export function initCreateRequestDialog(): void {
  const dialog = $<HTMLDialogElement>('#create-request');
  const form = $<HTMLFormElement>('form', dialog);
  const errorBox = $('[data-error]', dialog);
  const submit = $<HTMLButtonElement>('[data-submit]', dialog);
  const password = $<HTMLInputElement>('#cr-password');
  const confirm = $<HTMLInputElement>('#cr-confirm');
  const recipient = $<HTMLInputElement>('#cr-recipient');

  initCopyButtons(dialog);
  initShareButtons(dialog, 'Please send me this information securely:');

  const fail = (message: string, focus?: HTMLElement) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    focus?.focus();
  };
  form.addEventListener('reset', () => {
    errorBox.hidden = true;
  });
  dialog.addEventListener('close', () => {
    if (!dialog.querySelector<HTMLElement>('[data-state="result"]')!.hidden) location.reload();
  });
  $('[data-done]', dialog).addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) return fail('Give the request a title.', $('#cr-title'));
    if (password.value.length < 8) return fail('Choose a request password of at least 8 characters.', password);
    if (password.value !== confirm.value) return fail('The passwords don’t match.', confirm);
    const email = recipient.value.trim();
    if (email && !recipient.checkValidity()) return fail('Enter a valid email address.', recipient);

    submit.disabled = true;
    submit.textContent = 'Creating encryption keys…';
    let retryAfter = 0;
    try {
      const keys = await createRequestKeys(password.value);
      const body: Record<string, unknown> = {
        title,
        publicKey: keys.publicKey,
        wrappedKey: keys.wrappedKey,
        wrappedKeyIv: keys.wrappedKeyIv,
        wrappedKeySalt: keys.wrappedKeySalt,
      };
      const message = String(data.get('message') ?? '').trim();
      const hint = String(data.get('passwordHint') ?? '').trim();
      if (message) body['message'] = message;
      if (hint) body['passwordHint'] = hint;
      if (email) body['recipientEmail'] = email;

      const result = await postJson<{ id: string; path: string }>('/api/account/requests', body);
      if (!result.ok) {
        retryAfter = result.retryAfter ?? 0;
        return fail(result.message);
      }
      $<HTMLInputElement>('#cr-link').value = `${location.origin}${result.data.path}`;
      const emailed = $('[data-emailed]', dialog);
      emailed.hidden = !email;
      emailed.textContent = email ? `We emailed the request to ${email}.` : '';
      form.reset();
      showState(dialog, 'result');
    } catch {
      fail('Couldn’t create encryption keys in this browser. Please try a current browser.');
    } finally {
      submit.textContent = 'Create request';
      if (retryAfter > 0) cooldown(submit, retryAfter);
      else submit.disabled = false;
    }
  });
}
