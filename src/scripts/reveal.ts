import { DecryptionError, decryptNote, isLinkKey } from '../lib/crypto';
import type { ReadNoteResponse } from '../lib/schema';
import { fragment, idFromPath, readNote } from './api-client';
import { $, cooldown, guardUnload, initCopyButtons, showState } from './ui';

function readsStatus(readsLeft: number): string {
  if (readsLeft === 0) return 'This note has now been destroyed. Copy anything you need before leaving this page.';
  return `This note can be opened ${readsLeft} more ${readsLeft === 1 ? 'time' : 'times'} before it's destroyed.`;
}

function passwordStatus(readsLeft: number): string {
  if (readsLeft === 0) {
    return "The note has been retrieved and removed from our servers. It's held only in this tab now, so don't close or reload it until you've unlocked it.";
  }
  return `Enter the password the sender gave you. This counted as one view: the note can be opened ${readsLeft} more ${readsLeft === 1 ? 'time' : 'times'}.`;
}

export function initReveal(): void {
  const root = $('#reveal');
  const linkKey = fragment();

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
  const display = (plaintext: string, readsLeft: number) => {
    content.textContent = plaintext; // text only — never parsed as HTML
    const status = $('[data-reads-status]');
    status.textContent = readsStatus(readsLeft);
    status.className = readsLeft === 0 ? 'notice-warn mt-4 font-medium' : 'mt-4 text-sm text-muted';
    release();
    if (readsLeft === 0) releaseGuard = guardUnload();
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
    showState(root, 'password');
    const form = $<HTMLFormElement>('#password-form');
    const input = $<HTMLInputElement>('#reveal-password');
    const error = $('#password-error');
    const button = $<HTMLButtonElement>('#unlock-button');
    // The ciphertext now exists only in this tab.
    releaseGuard = guardUnload();
    input.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      button.disabled = true;
      button.textContent = 'Unlocking…';
      try {
        const plaintext = await decryptNote(note, linkKey, input.value);
        input.value = '';
        display(plaintext, note.readsLeft);
      } catch {
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
    const result = await readNote(idFromPath());
    if (!result.ok) {
      if (result.status === 404) return showState(root, 'gone');
      // A 429 or network error never consumed the note, so retrying is safe.
      return showError(
        result.message,
        result.retryAfter === undefined ? {} : { retryAfter: result.retryAfter },
      );
    }
    const note = result.data;
    if (note.hasPassword) return promptForPassword(note);
    try {
      display(await decryptNote(note, linkKey), note.readsLeft);
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
