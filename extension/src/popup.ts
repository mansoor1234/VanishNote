import { utf8ByteLength } from '../../src/lib/crypto';
import { MAX_NOTE_BYTES, TIMED_EXPIRY_LABELS, type ExpiryOption, type TimedExpiry } from '../../src/lib/limits';
import { ApiError, createNote, fetchRules, validate, type AccountRules, type NoteInput } from './client';
import { ext, getApiKey, SERVER, shortTerm } from './ext';

// HTMLSelectElement clashes with the Workers types in this project; this is all we use of it.
type Select = HTMLElement & { value: string };

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function show(state: 'form' | 'result'): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-state]')) el.hidden = el.dataset['state'] !== state;
}

function fail(message: string): void {
  const box = $('[data-error]');
  box.textContent = message;
  box.hidden = false;
}

function option(value: string, label: string, selected = false): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = selected;
  return o;
}

async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied ✓';
    window.setTimeout(() => (button.textContent = 'Copy link'), 2000);
  } catch {
    $<HTMLInputElement>('#link').select();
  }
}

async function main(): Promise<void> {
  const text = $<HTMLTextAreaElement>('#text');
  const size = $('[data-size]');
  const password = $<HTMLInputElement>('#password');
  const confirm = $<HTMLInputElement>('#confirm');
  const submit = $<HTMLButtonElement>('[data-submit]');
  const account = $('[data-account]');
  const quick = $('[data-quick]');
  const mode = $('[data-mode]');

  $('[data-open-settings]').addEventListener('click', () => void ext.runtime.openOptionsPage());
  for (const el of document.querySelectorAll<HTMLAnchorElement>('a[data-server-link]')) el.href = `${SERVER}${el.dataset['serverLink']}`;

  const updateSize = () => {
    const bytes = utf8ByteLength(text.value);
    size.textContent = `${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`} of ${MAX_NOTE_BYTES / 1024} KB`;
    size.classList.toggle('danger', bytes > MAX_NOTE_BYTES);
  };
  text.addEventListener('input', updateSize);

  // Text selected on a page (right-click menu), read once and deleted.
  const { selection } = await shortTerm.get('selection');
  if (typeof selection === 'string') {
    text.value = selection;
    await shortTerm.remove('selection');
  }
  updateSize();
  text.focus();

  // Account mode when an API key is saved and still works; otherwise a quick note.
  const apiKey = await getApiKey();
  let rules: AccountRules | undefined;
  if (apiKey) {
    try {
      rules = await fetchRules(SERVER, apiKey);
    } catch (err) {
      mode.textContent = err instanceof ApiError && err.status === 401 ? 'API key not accepted: sending a quick note instead.' : 'Couldn’t reach your account: sending a quick note instead.';
      mode.classList.add('warn');
    }
  }
  if (rules) {
    mode.textContent = `Saved to ${rules.teamName}’s dashboard as ${rules.name}`;
    account.hidden = false;
    quick.hidden = true;
    if (rules.requirePassword) {
      // Short label so the two boxes stay level; the reason goes in the hint under them.
      $('[data-password-label]').textContent = '(required)';
      $('[data-password-policy]').hidden = false;
      password.setAttribute('aria-describedby', 'password-policy');
      password.required = true;
    }
    const views = $<Select>('#reads');
    views.replaceChildren(...Array.from({ length: rules.maxReads }, (_, i) => option(String(i + 1), i === 0 ? '1 view' : `${i + 1} views`)));
    const timed = $<Select>('#timed');
    timed.replaceChildren(
      option('read', 'After it’s read', true),
      ...rules.timedExpiry.map((key) => option(key, `After ${TIMED_EXPIRY_LABELS[key]}`)),
    );
    timed.addEventListener('change', () => ($('[data-reads-row]').hidden = timed.value !== 'read'));
  } else if (!apiKey) {
    mode.textContent = 'Quick note, no account needed';
  }

  $<HTMLFormElement>('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('[data-error]').hidden = true;
    if (password.value !== confirm.value) return fail('The passwords don’t match.');

    let input: NoteInput;
    if (rules) {
      const timed = $<Select>('#timed').value;
      input = {
        kind: 'account',
        text: text.value,
        password: password.value,
        title: $<HTMLInputElement>('#title').value,
        shred: timed === 'read' ? { mode: 'read', maxReads: Number($<Select>('#reads').value) } : { mode: 'time', expiresIn: timed as TimedExpiry },
      };
    } else {
      input = {
        kind: 'quick',
        text: text.value,
        password: password.value,
        expiresIn: $<Select>('#expires').value as ExpiryOption,
        maxReads: Number($<Select>('#quick-reads').value),
      };
    }
    const problem = validate(input, rules);
    if (problem) return fail(problem);

    submit.disabled = true;
    submit.textContent = password.value ? 'Encrypting (a moment)…' : 'Encrypting…';
    try {
      const created = await createNote(SERVER, input, { apiKey: rules ? apiKey : undefined });
      // Nothing about the note stays in the popup once the link exists.
      text.value = '';
      password.value = '';
      confirm.value = '';
      $<HTMLInputElement>('#link').value = created.link;
      const destroy = $('[data-destroy]');
      destroy.hidden = !created.destroyLink;
      if (created.destroyLink) $<HTMLInputElement>('#destroy-link').value = created.destroyLink;
      $('[data-password-tip]').hidden = !input.password;
      show('result');
      await copy(created.link, $<HTMLButtonElement>('[data-copy]'));
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Encryption failed in this browser.');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create secure link';
    }
  });

  $<HTMLButtonElement>('[data-copy]').addEventListener('click', (e) => void copy($<HTMLInputElement>('#link').value, e.currentTarget as HTMLButtonElement));
  $('[data-again]').addEventListener('click', () => {
    $<HTMLInputElement>('#link').value = '';
    show('form');
    text.focus();
    updateSize();
  });
}

void main();
