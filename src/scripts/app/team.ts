import { del, postForm, postJson } from '../http-client';
import { bindForm } from './settings';

export function initTeam(): void {
  const status = document.querySelector<HTMLElement>('[data-team-status]');
  const say = (message: string) => {
    if (status) status.textContent = message;
  };

  const rename = document.querySelector<HTMLFormElement>('form[data-form="team-name"]');
  if (rename) {
    bindForm(rename, async (data) => {
      const r = await postJson('/api/account/team/name', { name: String(data.get('name')).trim() });
      return r.ok ? { ok: true, message: 'Team renamed.' } : r;
    });
  }

  const invite = document.querySelector<HTMLFormElement>('form[data-form="invite"]');
  if (invite) {
    invite.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = invite.querySelector<HTMLInputElement>('input[name="email"]')!;
      if (!input.checkValidity()) {
        say('Enter a valid email address.');
        input.focus();
        return;
      }
      const r = await postJson('/api/account/team/invite', { email: input.value.trim() });
      if (r.ok) location.reload();
      else say(r.message);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-remove-member]')) {
    button.addEventListener('click', async () => {
      if (!window.confirm(`Remove ${button.dataset['name']} from the team? What they’ve sent stays with the team.`)) return;
      const r = await del(`/api/account/team/members/${button.dataset['removeMember']}`);
      if (r.ok) location.reload();
      else say(r.message);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-revoke-invite]')) {
    button.addEventListener('click', async () => {
      const r = await del('/api/account/team/invite', { email: button.dataset['revokeInvite'] });
      if (r.ok) location.reload();
      else say(r.message);
    });
  }

  const branding = document.querySelector<HTMLFormElement>('form[data-form="branding"]');
  if (branding) {
    bindForm(branding, async (data) => {
      const logo = data.get('logo');
      if (logo instanceof File && logo.size > 256 * 1024) return { ok: false, message: 'That logo is larger than 256 KB.' };
      if (logo instanceof File && logo.size === 0) data.delete('logo');
      const r = await postForm('/api/account/team/branding', data);
      if (!r.ok) return r;
      location.reload();
      return { ok: true, message: 'Branding saved.' };
    });
  }
  document.querySelector('[data-remove-logo]')?.addEventListener('click', async () => {
    const r = await del('/api/account/team/branding/logo');
    if (r.ok) location.reload();
  });
}
