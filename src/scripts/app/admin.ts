import { postJson } from '../http-client';
import { localTime } from './dashboard';
import { bindForm } from './settings';

export function initAdmin(): void {
  for (const el of document.querySelectorAll<HTMLTimeElement>('time[data-local-time]')) {
    el.textContent = localTime(Date.parse(el.dateTime));
  }
  const policy = document.querySelector<HTMLFormElement>('form[data-form="policy"]');
  if (policy) {
    bindForm(policy, async (data) => {
      const r = await postJson('/api/account/team/policy', {
        requirePassword: data.get('requirePassword') === 'on',
        maxExpiry: String(data.get('maxExpiry') ?? '') || null,
        requireSso: data.get('requireSso') === 'on',
      });
      return r.ok ? { ok: true, message: 'Policies saved. They apply to everything created from now on.' } : r;
    });
  }

  const status = document.querySelector<HTMLElement>('[data-shred-status]');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-shred-member]')) {
    button.addEventListener('click', async () => {
      const name = button.dataset['name'];
      if (!window.confirm(`Shred every live note and cancel every open request ${name} has sent? Recipients won’t be able to open them. This can’t be undone.`)) return;
      button.disabled = true;
      const r = await postJson<{ notes: number; requests: number }>(`/api/account/team/members/${button.dataset['shredMember']}/shred`, {});
      if (r.ok) {
        if (status) status.textContent = `Shredded ${r.data.notes} notes and ${r.data.requests} requests from ${name}.`;
        window.setTimeout(() => location.reload(), 1200);
      } else {
        if (status) status.textContent = r.message;
        button.disabled = false;
      }
    });
  }

  // HTMLSelectElement clashes with the Workers types; closest('form') avoids it.
  for (const select of document.querySelectorAll<HTMLElement>('select[data-auto-submit]')) {
    select.addEventListener('change', () => select.closest('form')?.submit());
  }
}
