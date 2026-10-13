import { DecryptionError, decryptNote, decryptNoteFile, decryptNoteFileMeta, isLinkKey } from '../lib/crypto';
import type { ReadNoteResponse } from '../lib/schema';
import { fragment, idFromPath, readNote } from './api-client';
import { fetchEncrypted, formatFileSize, saveFile } from './files';
import { $, cooldown, guardUnload, initCopyButtons, showState } from './ui';

function readsStatus(note: ReadNoteResponse): string {
  if (note.readsLeft < 0) {
    const until = note.expiresAt ? new Date(note.expiresAt).toLocaleString() : 'it expires';
    return `This note stays available until ${until}.${note.file ? ' Downloading the attachment shreds it.' : ''}`;
  }
  if (note.readsLeft === 0) return 'This note has now been destroyed. Copy anything you need before leaving this page.';
  return `This note can be opened ${note.readsLeft} more ${note.readsLeft === 1 ? 'time' : 'times'} before it's destroyed.`;
}

function passwordStatus(readsLeft: number): string {
  if (readsLeft === 0) {
    return "The note has been retrieved and removed from our servers. It's held only in this tab now, so don't close or reload it until you've unlocked it.";
  }
  if (readsLeft < 0) return 'Enter the password the sender gave you.';
  return `Enter the password the sender gave you. This counted as one view: the note can be opened ${readsLeft} more ${readsLeft === 1 ? 'time' : 'times'}.`;
}

/** Tell the sender's activity log about a failed attempt. Best effort; the answer is always the same. */
function reportWrongPassword(id: string): void {
  void fetch(`/api/notes/${encodeURIComponent(id)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'wrong_password' }),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {});
}

export function initReveal(): void {
  const root = $('#reveal');
  const linkKey = fragment();
  const id = idFromPath();

  // On the final view, warn before leaving until the reader has copied the note.
  let releaseGuard: (() => void) | undefined;
  const release = () => {
    releaseGuard?.();
    releaseGuard = undefined;
  };
  initCopyButtons(root, release);

  // Without a valid key the note could never be decrypted: don't let a truncated link burn it.
  if (!isLinkKey(linkKey)) {
    showState(root, 'missing-key');
    return;
  }

  const content = $('#note-content');

  const showAttachment = async (note: ReadNoteResponse, password: string | undefined) => {
    const file = note.file;
    const box = $('[data-attachment]', root);
    if (!file) {
      box.hidden = true;
      return;
    }
    const meta = await decryptNoteFileMeta(note, linkKey, password, file.meta, file.metaIv);
    $('[data-attachment-name]', box).textContent = `${meta.name} · ${formatFileSize(Math.max(0, file.size - 16))}`;
    box.hidden = false;
    const button = $<HTMLButtonElement>('[data-attachment-download]', box);
    const status = $('[data-attachment-status]', box);
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Downloading and decrypting…';
      try {
        const bytes = await fetchEncrypted(file.downloadToken);
        const opened = await decryptNoteFile(note, linkKey, password, { bytes, iv: file.iv, meta: file.meta, metaIv: file.metaIv });
        saveFile(opened.bytes, opened.meta.name);
        status.textContent = `Saved ${opened.meta.name}. The encrypted copy has been removed from our servers.`;
        button.hidden = true;
      } catch (err) {
        status.textContent =
          err instanceof Error && err.message === 'gone'
            ? 'This download has already been used or has expired.'
            : 'The download failed. Try again.';
        button.disabled = !(err instanceof Error && err.message === 'failed');
      }
    });
  };

  const display = async (plaintext: string, note: ReadNoteResponse, password?: string) => {
    content.textContent = plaintext; // text only — never parsed as HTML
    const status = $('[data-reads-status]');
    status.textContent = readsStatus(note);
    status.className = note.readsLeft === 0 ? 'notice-warn mt-4 font-medium' : 'mt-4 text-sm text-muted';
    release();
    if (note.readsLeft === 0) releaseGuard = guardUnload();
    await showAttachment(note, password).catch(() => {
      $('[data-attachment]', root).hidden = true;
    });
    showState(root, 'shown');
  };

  const showError = (message: string, { retry = true, retryAfter }: { retry?: boolean; retryAfter?: number } = {}) => {
    $('[data-error-message]').textContent = message;
    const retryButton = $<HTMLButtonElement>('[data-retry]');
    retryButton.hidden = !retry;
    $('[data-write-link]').hidden = retry;
    showState(root, 'error');
    if (retry && retryAfter) cooldown(retryButton, retryAfter);
  };

  const promptForPassword = (note: ReadNoteResponse) => {
    $('[data-password-status]').textContent = passwordStatus(note.readsLeft);
    const hint = $('[data-password-hint]', root);
    hint.textContent = note.passwordHint ? `Hint from the sender: ${note.passwordHint}` : '';
    hint.hidden = !note.passwordHint;
    showState(root, 'password');
    const form = $<HTMLFormElement>('#password-form');
    const input = $<HTMLInputElement>('#reveal-password');
    const error = $('#password-error');
    const button = $<HTMLButtonElement>('#unlock-button');
    // This view has been used up and the ciphertext is now only in this tab.
    releaseGuard = guardUnload();
    input.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      button.disabled = true;
      button.textContent = 'Unlocking…';
      try {
        const password = input.value;
        const plaintext = await decryptNote(note, linkKey, password);
        input.value = '';
        await display(plaintext, note, password);
      } catch {
        reportWrongPassword(id);
        error.textContent = "That password didn't work. Check it and try again — you can retry as often as you need.";
        error.hidden = false;
        input.select();
      } finally {
        button.disabled = false;
        button.textContent = 'Unlock note';
      }
    });
  };

  const reveal = async () => {
    showState(root, 'loading');
    const result = await readNote(id);
    if (!result.ok) {
      if (result.status === 404) return showState(root, 'gone');
      // A 429 or network error never consumed the note, so retrying is safe.
      return showError(result.message, result.retryAfter === undefined ? {} : { retryAfter: result.retryAfter });
    }
    const note = result.data;
    if (note.hasPassword) return promptForPassword(note);
    try {
      await display(await decryptNote(note, linkKey), note);
    } catch (err) {
      showError(
        err instanceof DecryptionError
          ? "This note couldn't be decrypted. The link may have been altered. Ask the sender to create a new note."
          : 'Decryption failed in this browser. Try a current version of Chrome, Firefox, Safari or Edge.',
        { retry: false },
      );
    }
  };

  $('#reveal-button').addEventListener('click', reveal);
  $('[data-retry]').addEventListener('click', reveal);
}
