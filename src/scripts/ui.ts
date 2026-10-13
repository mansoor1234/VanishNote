/** Small DOM helpers shared by the page scripts. */

export function $<T extends HTMLElement = HTMLElement>(selector: string, root: HTMLElement | Document = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

/** Show exactly one of the elements marked [data-state] inside `root`. */
export function showState(root: HTMLElement, state: string): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-state]')) {
    el.hidden = el.dataset['state'] !== state;
  }
  const heading = root.querySelector<HTMLElement>(`[data-state="${state}"] [data-focus]`);
  heading?.focus();
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function textOf(target: HTMLElement): string {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target.value
    : (target.textContent ?? '');
}

/** Put a short message in the [data-copy-status] live region next to `button`, then clear it. */
function announce(button: HTMLElement, message: string): void {
  const status = button.parentElement?.querySelector<HTMLElement>('[data-copy-status]');
  if (!status) return;
  status.textContent = message;
  // Clearing lets an identical message be announced again on the next copy.
  window.setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

/**
 * Wire every [data-copy] button: copies the value/text of the element whose id is in
 * data-copy. `onCopied` receives the target id after a successful copy.
 */
export function initCopyButtons(
  root: HTMLElement | Document = document,
  onCopied?: (targetId: string) => void,
): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
    if (button.dataset['copyBound']) continue;
    button.dataset['copyBound'] = '1';
    const label = button.textContent?.trim() ?? 'Copy';
    button.addEventListener('click', async () => {
      const targetId = button.dataset['copy'] ?? '';
      const target = document.getElementById(targetId);
      if (!target) return;
      const ok = await writeClipboard(textOf(target));
      if (ok) {
        button.textContent = 'Copied';
        announce(button, 'Copied to clipboard.');
        onCopied?.(targetId);
      } else {
        selectContents(target);
        button.textContent = 'Select & copy';
        announce(button, "Couldn't copy automatically. The text is selected. Long-press or press Ctrl+C to copy it.");
      }
      window.setTimeout(() => {
        button.textContent = label;
      }, 2000);
    });
  }
}

function selectContents(target: HTMLElement): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus();
    target.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Wire every [data-share] button to the native share sheet, if the browser has one.
 * On touch devices the share button becomes the primary action. Returns false when
 * sharing is unavailable (buttons stay hidden).
 */
export function initShareButtons(
  root: HTMLElement | Document,
  shareText: string,
  onShared?: (targetId: string) => void,
): boolean {
  if (typeof navigator.share !== 'function') return false;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-share]')) {
    const targetId = button.dataset['share'] ?? '';
    button.hidden = false;
    if (touch) {
      button.classList.replace('btn-secondary', 'btn-primary');
      const copy = root.querySelector<HTMLElement>(`button[data-copy="${targetId}"]`);
      copy?.classList.replace('btn-primary', 'btn-secondary');
      button.parentElement?.insertBefore(button, copy ?? null);
    }
    button.addEventListener('click', async () => {
      const target = document.getElementById(targetId);
      if (!target) return;
      try {
        await navigator.share({ text: shareText, url: textOf(target) });
        onShared?.(targetId);
      } catch {
        // Cancelled by the user, or blocked: the copy button is still there.
      }
    });
  }
  return true;
}

/** Ask the browser to confirm before the page is closed or reloaded, until the returned function is called. */
export function guardUnload(): () => void {
  const handler = (event: BeforeUnloadEvent) => {
    event.preventDefault();
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}

/** Disable a button for `seconds`, showing a countdown, then restore its label. */
export function cooldown(button: HTMLButtonElement, seconds: number): void {
  const label = button.textContent?.trim() ?? '';
  let left = Math.max(1, Math.ceil(seconds));
  button.disabled = true;
  const tick = () => {
    if (left <= 0) {
      button.disabled = false;
      button.textContent = label;
      return;
    }
    button.textContent = `${label} (${left}s)`;
    left--;
    window.setTimeout(tick, 1000);
  };
  tick();
}

/** Show/Hide buttons for password fields: <button data-toggle-password="input-id">. */
export function initPasswordToggles(root: HTMLElement | Document = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-toggle-password]')) {
    if (button.dataset['toggleBound']) continue;
    button.dataset['toggleBound'] = '1';
    const input = document.getElementById(button.dataset['togglePassword'] ?? '') as HTMLInputElement | null;
    if (!input) continue;
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(show));
    });
  }
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
