import { ApiError, fetchRules } from './client';
import { getApiKey, SERVER, setApiKey } from './ext';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function status(message: string, tone: 'ok' | 'danger' | 'muted' = 'muted'): void {
  const el = $('[data-status]');
  el.textContent = message;
  el.className = `status ${tone}`;
}

async function describe(apiKey: string): Promise<void> {
  try {
    const rules = await fetchRules(SERVER, apiKey);
    status(`Connected as ${rules.name} (${rules.teamName}). New notes go to your dashboard.`, 'ok');
  } catch (err) {
    status(err instanceof ApiError && err.status === 401 ? 'That key isn’t valid. Create a new one in Settings → Your API key.' : 'Couldn’t reach Vanishnote. Try again.', 'danger');
  }
}

async function main(): Promise<void> {
  for (const el of document.querySelectorAll<HTMLAnchorElement>('a[data-server-link]')) el.href = `${SERVER}${el.dataset['serverLink']}`;
  const input = $<HTMLInputElement>('#api-key');
  const remove = $<HTMLButtonElement>('[data-remove]');
  const current = await getApiKey();
  if (current) {
    input.placeholder = `${current.slice(0, 10)}… (saved)`;
    remove.hidden = false;
    await describe(current);
  } else {
    status('No key saved: the extension sends quick notes that don’t need an account.');
  }

  $<HTMLFormElement>('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!/^vn_[A-Za-z0-9_-]{43}$/.test(key)) return status('That doesn’t look like a Vanishnote API key (it starts with vn_).', 'danger');
    status('Checking…');
    try {
      await fetchRules(SERVER, key);
    } catch (err) {
      return status(err instanceof ApiError && err.status === 401 ? 'That key isn’t valid.' : 'Couldn’t reach Vanishnote. Try again.', 'danger');
    }
    await setApiKey(key);
    input.value = '';
    input.placeholder = `${key.slice(0, 10)}… (saved)`;
    remove.hidden = false;
    await describe(key);
  });

  remove.addEventListener('click', async () => {
    await setApiKey(null);
    input.placeholder = 'vn_…';
    remove.hidden = true;
    status('Key removed. The extension now sends quick notes that don’t need an account.');
  });
}

void main();
