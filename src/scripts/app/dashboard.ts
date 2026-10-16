import {
  DecryptionError,
  openRequestFile,
  openRequestText,
  publicKeyFingerprint,
  responseKey,
  unlockRequestKey,
  type WrappedRequestKey,
} from '../../lib/crypto';
import { fetchEncrypted, formatFileSize, saveFile } from '../files';
import { del, getJson, postJson } from '../http-client';
import { $, initCopyButtons, showState } from '../ui';

const EVENT_LABELS: Record<string, string> = {
  created: 'Created',
  emailed: 'Link emailed',
  opened: 'Opened',
  wrong_password: 'Wrong password entered',
  downloaded: 'Attachment downloaded',
  shredded: 'Shredded',
  expired: 'Expired',
  destroyed: 'Destroyed',
  completed: 'Answered',
};

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' });
  } catch {
    return null;
  }
})();

export function localTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function initDashboard(): void {
  for (const el of document.querySelectorAll<HTMLTimeElement>('time[data-local-time]')) {
    el.textContent = localTime(Date.parse(el.dateTime));
  }
  // HTMLSelectElement clashes with the Workers types; closest('form') avoids it.
  for (const select of document.querySelectorAll<HTMLElement>('select[data-auto-submit]')) {
    select.addEventListener('change', () => select.closest('form')?.submit());
  }
  const status = document.querySelector<HTMLElement>('[data-list-status]');
  const say = (message: string) => {
    if (status) status.textContent = message;
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-activity]')) {
    button.addEventListener('click', async () => {
      const panel = document.getElementById(`activity-${button.dataset['activity']}`)!;
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (!open || panel.dataset['loaded']) return;
      panel.textContent = 'Loading…';
      const result = await getJson<{ events: { type: string; country: string | null; created_at: number }[] }>(
        `/api/account/records/${button.dataset['activity']}`,
      );
      panel.textContent = '';
      if (!result.ok) {
        panel.textContent = result.message;
        return;
      }
      panel.dataset['loaded'] = '1';
      if (result.data.events.length === 0) {
        panel.textContent = 'No activity history is kept for shredded notes on the Free plan.';
        return;
      }
      const list = document.createElement('ol');
      list.className = 'space-y-1.5';
      for (const event of result.data.events) {
        const li = document.createElement('li');
        li.className = 'flex flex-wrap justify-between gap-2';
        const what = document.createElement('span');
        what.className = event.type === 'wrong_password' ? 'font-medium text-danger' : 'font-medium';
        const where = event.country ? ` · ${regionNames?.of(event.country) ?? event.country}` : '';
        what.textContent = `${EVENT_LABELS[event.type] ?? event.type}${where}`;
        const when = document.createElement('time');
        when.className = 'text-muted';
        when.dateTime = new Date(event.created_at).toISOString();
        when.textContent = localTime(event.created_at);
        li.appendChild(what);
        li.appendChild(when);
        list.appendChild(li);
      }
      panel.appendChild(list);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-delete]')) {
    button.addEventListener('click', async () => {
      const row = button.closest<HTMLElement>('[data-record]')!;
      const live = button.dataset['live'] === '1';
      const question =
        row.dataset['kind'] === 'note'
          ? live
            ? 'Destroy this note now? Its link will stop working and its history will be deleted.'
            : 'Delete this note’s history?'
          : live
            ? 'Cancel this request? Its link will stop working, and any response will be shredded unread.'
            : 'Delete this request’s history?';
      if (!window.confirm(question)) return;
      button.disabled = true;
      const result = await del(`/api/account/records/${button.dataset['delete']}`);
      if (result.ok) {
        row.remove();
        say('Deleted.');
      } else {
        button.disabled = false;
        say(result.message);
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-request]')) {
    button.addEventListener('click', async () => {
      const id = button.dataset['copyRequest']!;
      const result = await getJson<WrappedRequestKey>(`/api/account/requests/${id}/key`);
      if (!result.ok) return say(result.message);
      const link = `${location.origin}/r/${id}#${await publicKeyFingerprint(result.data.publicKey)}`;
      try {
        await navigator.clipboard.writeText(link);
        say('Request link copied.');
        button.textContent = 'Copied';
      } catch {
        window.prompt('Copy the request link:', link);
      }
    });
  }

  initResponseDialog();
}

function initResponseDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#open-response');
  if (!dialog) return;
  const form = $<HTMLFormElement>('form', dialog);
  const input = $<HTMLInputElement>('#or-password', dialog);
  const errorBox = $('[data-error]', dialog);
  const submit = $<HTMLButtonElement>('[data-submit]', dialog);
  const hint = $('[data-response-hint]', dialog);
  const download = $<HTMLButtonElement>('[data-download]', dialog);
  const downloadStatus = $('[data-download-status]', dialog);
  initCopyButtons(dialog);

  let requestId = '';
  let keys: (WrappedRequestKey & { passwordHint?: string }) | null = null;
  let opened = false;

  dialog.addEventListener('close', () => {
    if (opened) location.reload();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-response]')) {
    button.addEventListener('click', async () => {
      requestId = button.dataset['openResponse']!;
      $('[data-response-title]', dialog).textContent = button.dataset['title'] ?? '';
      errorBox.hidden = true;
      input.value = '';
      showState(dialog, 'unlock');
      const result = await getJson<WrappedRequestKey & { passwordHint?: string }>(`/api/account/requests/${requestId}/key`);
      if (!result.ok) return;
      keys = result.data;
      hint.hidden = !keys.passwordHint;
      hint.textContent = keys.passwordHint ? `Your hint: ${keys.passwordHint}` : '';
      dialog.showModal();
      input.focus();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!keys) return;
    errorBox.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Checking…';
    try {
      // Step 1: the password must unlock the private key before we touch the response.
      let privateKey: CryptoKey;
      try {
        privateKey = await unlockRequestKey(keys, input.value);
      } catch {
        errorBox.textContent = 'That password doesn’t unlock this request. Nothing has been opened yet, so you can try again.';
        errorBox.hidden = false;
        input.select();
        return;
      }
      // Step 2: fetch and shred the response.
      const result = await postJson<{
        response: string;
        responseIv: string;
        epk: string;
        file?: { size: number; iv: string; meta: string; metaIv: string; downloadToken: string };
      }>(`/api/account/requests/${requestId}/open`, {});
      if (!result.ok) {
        errorBox.textContent = result.status === 404 ? 'This response is no longer available.' : result.message;
        errorBox.hidden = false;
        return;
      }
      opened = true;
      const key = await responseKey(privateKey, keys.publicKey, result.data.epk);
      $('#or-content', dialog).textContent = await openRequestText(key, result.data.response, result.data.responseIv);
      const file = result.data.file;
      download.hidden = !file;
      if (file) {
        download.textContent = `Download attachment (${formatFileSize(file.size)})`;
        download.onclick = async () => {
          download.disabled = true;
          downloadStatus.textContent = 'Downloading and decrypting…';
          try {
            const bytes = await fetchEncrypted(file.downloadToken);
            const opened = await openRequestFile(key, { bytes, iv: file.iv, meta: file.meta, metaIv: file.metaIv });
            saveFile(opened.bytes, opened.meta.name);
            downloadStatus.textContent = `Saved ${opened.meta.name}. The encrypted copy is being deleted from our servers.`;
          } catch (err) {
            download.disabled = false;
            downloadStatus.textContent =
              err instanceof Error && err.message === 'gone'
                ? 'The download link has expired (they last 10 minutes).'
                : 'The download failed. Try again.';
          }
        };
      }
      showState(dialog, 'shown');
    } catch (err) {
      errorBox.textContent = err instanceof DecryptionError ? 'The response couldn’t be decrypted.' : 'Something went wrong. Please try again.';
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Unlock';
    }
  });
}
