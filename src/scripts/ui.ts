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

/**
 * Wire every [data-copy] button: copies the value/text of the element whose id is in
 * data-copy, and announces the result in the button's [data-copy-status] sibling.
 */
export function initCopyButtons(root: HTMLElement | Document = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
    if (button.dataset['copyBound']) continue;
    button.dataset['copyBound'] = '1';
    const label = button.textContent ?? 'Copy';
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset['copy'] ?? '');
      if (!target) return;
      const text = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : (target.textContent ?? '');
      const ok = await writeClipboard(text);
      if (!ok && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) target.select();
      button.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      const status = button.parentElement?.querySelector<HTMLElement>('[data-copy-status]');
      if (status) status.textContent = ok ? 'Copied to clipboard.' : 'Copy failed. The text is selected; copy it manually.';
      window.setTimeout(() => {
        button.textContent = label;
      }, 2000);
    });
  }
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
