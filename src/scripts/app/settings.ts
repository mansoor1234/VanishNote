import { deriveAuthKey } from '../../lib/crypto';
import { fromBase64Url } from '../../lib/encoding';
import { del, postJson } from '../http-client';
import { $, initPasswordToggles } from '../ui';

/** Wire a form: validate required fields, run `action`, and show the outcome in [data-result]. */
export function bindForm(
  form: HTMLFormElement,
  action: (data: FormData) => Promise<{ ok: boolean; message: string }>,
): void {
  const result = $('[data-result]', form.parentElement ?? form);
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    for (const input of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[required]')) {
      if (!input.checkValidity()) {
        result.className = 'text-sm text-danger';
        result.textContent =
          input instanceof HTMLInputElement && input.type === 'email'
            ? 'Enter a valid email address.'
            : input.minLength > 0 && input.value.length < input.minLength
              ? `Use at least ${input.minLength} characters.`
              : 'Please fill in every field.';
        input.focus();
        return;
      }
    }
    if (submit) submit.disabled = true;
    result.className = 'text-sm text-muted';
    result.textContent = 'Working…';
    try {
      const outcome = await action(new FormData(form));
      result.className = outcome.ok ? 'text-sm text-success' : 'text-sm text-danger';
      result.textContent = outcome.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

export function initSettings(): void {
  initPasswordToggles();
  const profile = document.querySelector<HTMLFormElement>('form[data-form="profile"]');
  if (profile) {
    bindForm(profile, async (data) => {
      const r = await postJson('/api/account/profile', { name: String(data.get('name')).trim() });
      return r.ok ? { ok: true, message: 'Saved.' } : r;
    });
  }

  const password = document.querySelector<HTMLFormElement>('form[data-form="password"]');
  if (password) {
    const email = password.dataset['email']!;
    bindForm(password, async (data) => {
      if (data.get('password') !== data.get('confirm')) return { ok: false, message: 'The new passwords don’t match.' };
      const [currentAuthKey, newAuthKey] = await Promise.all([
        deriveAuthKey(email, String(data.get('current'))),
        deriveAuthKey(email, String(data.get('password'))),
      ]);
      const r = await postJson('/api/account/password', { currentAuthKey, newAuthKey });
      if (!r.ok) return r;
      location.assign('/login');
      return { ok: true, message: 'Password changed. Please log in again.' };
    });
  }

  const remove = document.querySelector<HTMLFormElement>('form[data-form="delete"]');
  if (remove) {
    const email = remove.dataset['email']!;
    bindForm(remove, async (data) => {
      if (!window.confirm('Delete your account permanently? This can’t be undone.')) return { ok: false, message: 'Cancelled.' };
      const authKey = await deriveAuthKey(email, String(data.get('password')));
      const r = await postJson('/api/account/delete', { authKey });
      if (!r.ok) return r;
      location.assign('/');
      return { ok: true, message: 'Your account has been deleted.' };
    });
  }

  void initPush();
}

async function initPush(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-push]');
  if (!root) return;
  const state = $('[data-push-state]', root);
  const enable = $<HTMLButtonElement>('[data-push-enable]', root);
  const disable = $<HTMLButtonElement>('[data-push-disable]', root);
  const test = $<HTMLButtonElement>('[data-push-test]', root);
  const result = $('[data-result]', root);
  const vapid = root.dataset['vapid'] ?? '';

  if (!vapid) {
    state.textContent = 'Push notifications aren’t set up on this server yet. Email notifications still work.';
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    state.textContent = 'This browser doesn’t support push notifications.';
    return;
  }

  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const render = async () => {
    const sub = await registration.pushManager.getSubscription();
    const blocked = Notification.permission === 'denied';
    state.textContent = blocked
      ? 'Notifications are blocked for this site in your browser settings.'
      : sub
        ? 'Push notifications are on for this device.'
        : 'Push notifications are off for this device.';
    enable.hidden = Boolean(sub) || blocked;
    disable.hidden = !sub;
    test.hidden = !sub;
  };

  enable.addEventListener('click', async () => {
    result.textContent = '';
    if ((await Notification.requestPermission()) !== 'granted') {
      result.textContent = 'Permission wasn’t granted.';
      return render();
    }
    try {
      const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(vapid) });
      const json = sub.toJSON();
      const r = await postJson('/api/account/push', { endpoint: json.endpoint, keys: { p256dh: json.keys?.['p256dh'], auth: json.keys?.['auth'] } });
      if (!r.ok) {
        await sub.unsubscribe();
        result.textContent = r.message;
      }
    } catch {
      result.textContent = 'Couldn’t turn on notifications in this browser.';
    }
    await render();
  });
  disable.addEventListener('click', async () => {
    const sub = await registration.pushManager.getSubscription();
    if (sub) {
      await del('/api/account/push', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    await render();
  });
  test.addEventListener('click', async () => {
    const r = await postJson('/api/account/push/test', {});
    result.textContent = r.ok ? 'Sent. It should arrive in a few seconds.' : r.message;
  });
  await render();
}

export function initContact(): void {
  const form = document.querySelector<HTMLFormElement>('form[data-form="contact"]');
  if (!form) return;
  bindForm(form, async (data) => {
    const r = await postJson('/api/account/contact', {
      subject: String(data.get('subject')).trim(),
      message: String(data.get('message')).trim(),
    });
    if (!r.ok) return r;
    form.reset();
    return { ok: true, message: 'Thanks, your message is on its way. We’ll reply by email.' };
  });
}
