import { DELETE_TOKEN_RE } from '../lib/limits';
import { destroyNote, fragment, idFromPath } from './api-client';
import { $, cooldown, showState } from './ui';

export function initDestroy(): void {
  const root = $('#destroy');
  const token = fragment();
  if (!DELETE_TOKEN_RE.test(token)) {
    showState(root, 'missing-key');
    return;
  }

  const destroy = async () => {
    showState(root, 'loading');
    const result = await destroyNote(idFromPath(), token);
    if (result.ok) return showState(root, 'done');
    if (result.status === 404) return showState(root, 'gone');
    $('[data-error-message]').textContent = result.message;
    showState(root, 'error');
    if (result.retryAfter) cooldown($<HTMLButtonElement>('[data-retry]'), result.retryAfter);
  };

  $('#destroy-button').addEventListener('click', destroy);
  $('[data-retry]').addEventListener('click', destroy);
}
