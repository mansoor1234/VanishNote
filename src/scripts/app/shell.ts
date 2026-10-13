import { generatePassword } from '../../lib/crypto';
import { postJson } from '../http-client';

/** Sidebar menu (small screens), dialog open/close, logout, and password field helpers. */
export function initAppShell(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const panel = document.querySelector<HTMLElement>('[data-sidebar-panel]');
  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      panel.classList.toggle('hidden', !open);
      panel.classList.toggle('flex', open);
    });
  }

  for (const opener of document.querySelectorAll<HTMLElement>('[data-open-dialog]')) {
    opener.addEventListener('click', () => {
      document.querySelector<HTMLDialogElement>(`#${opener.dataset['openDialog']}`)?.showModal();
    });
  }
  // Open straight from a link such as /app#create-note.
  const fromHash = location.hash === '#create-note' || location.hash === '#create-request' ? location.hash.slice(1) : null;
  if (fromHash) document.querySelector<HTMLDialogElement>(`#${fromHash}`)?.showModal();

  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog.dialog')) {
    for (const closer of dialog.querySelectorAll<HTMLElement>('[data-close-dialog]')) {
      closer.addEventListener('click', () => dialog.close());
    }
  }

  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await postJson('/api/auth/logout', {});
    location.assign('/login');
  });

  initPasswordHelpers(document);
}

export function initPasswordHelpers(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-generate-password]')) {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset['generatePassword'] ?? '') as HTMLInputElement | null;
      if (!input) return;
      const value = generatePassword();
      input.value = value;
      const form = input.form;
      const confirm = form?.elements.namedItem('confirm') as HTMLInputElement | null;
      if (confirm) confirm.value = value;
      // Show what was generated so the user can copy it.
      for (const field of [input, confirm]) if (field) field.type = 'text';
      form?.querySelector('[data-toggle-password-pair]')?.setAttribute('aria-pressed', 'true');
      const pairButton = form?.querySelector<HTMLButtonElement>('[data-toggle-password-pair]');
      if (pairButton) pairButton.textContent = 'Hide';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.select();
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-toggle-password-pair]')) {
    button.addEventListener('click', () => {
      const ids = (button.dataset['togglePasswordPair'] ?? '').split(' ');
      const inputs = ids.map((id) => document.getElementById(id) as HTMLInputElement | null).filter(Boolean) as HTMLInputElement[];
      const show = inputs[0]?.type === 'password';
      for (const input of inputs) input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(show));
    });
  }
}
