import { DecryptionError, decryptNote, isLinkKey } from '../lib/crypto';
import type { ReadNoteResponse } from '../lib/schema';
import { fragment, idFromPath, readNote } from './api-client';
import { $, initCopyButtons, showState } from './ui';

function readsStatus(readsLeft: number): string {
  if (readsLeft === 0) return 'This note has now been destroyed. Copy anything you need before leaving this page.';
  return `This note can be opened ${readsLeft} more ${readsLeft === 1 ? 'time' : 'times'} before it's destroyed.`;
}

export function initReveal(): void {
  const root = $('#reveal');
  const linkKey = fragment();
  initCopyButtons(root);

  // Without a valid key the note could never be decrypted: don't let a truncated link burn it.
  if (!isLinkKey(linkKey)) {
    showState(root, 'missing-key');
    return;
  }

  const content = $('#note-content');
  const display = (plaintext: string, readsLeft: number) => {
    content.textContent = plaintext; // text only — never parsed as HTML
    $('[data-reads-status]').textContent = readsStatus(readsLeft);
    showState(root, 'shown');
  };

  const promptForPassword = (note: ReadNoteResponse) => {
    showState(root, 'password');
    const form = $<HTMLFormElement>('#password-form');
    const input = $<HTMLInputElement>('#reveal-password');
    const error = $('#password-error');
    const button = $<HTMLButtonElement>('#unlock-button');
    window.addEventListener('beforeunload', warnBeforeLeaving);
    input.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      button.disabled = true;
      button.textContent = 'Unlocking…';
      try {
        const plaintext = await decryptNote(note, linkKey, input.value);
        window.removeEventListener('beforeunload', warnBeforeLeaving);
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
      $('[data-error-message]').textContent = result.message;
      // A 429 or network error never consumed the note, so retrying is safe.
      return showState(root, 'error');
    }
    const note = result.data;
    if (note.hasPassword) return promptForPassword(note);
    try {
      display(await decryptNote(note, linkKey), note.readsLeft);
    } catch (err) {
      $('[data-error-message]').textContent =
        err instanceof DecryptionError
          ? "This note couldn't be decrypted. The link may have been altered. The note has been removed from our servers."
          : 'Decryption failed in this browser.';
      $<HTMLButtonElement>('[data-retry]').hidden = true;
      showState(root, 'error');
    }
  };

  $('#reveal-button').addEventListener('click', reveal);
  $('[data-retry]').addEventListener('click', reveal);
}

function warnBeforeLeaving(event: BeforeUnloadEvent): void {
  event.preventDefault();
}
