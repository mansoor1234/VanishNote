import { NoteTooLargeError, sealNote } from '../lib/crypto';

/**
 * Show, live, what the server receives for the text being typed: real AES-256-GCM output under a
 * throwaway key (the note itself is sealed again, with a new key, when it's created). Purely a
 * demonstration that the server only ever gets noise.
 */
export function initCipherPreview(input: HTMLTextAreaElement, output: HTMLElement): void {
  const placeholder = output.textContent ?? '';
  let timer: number | undefined;
  let latest = 0;

  const render = async () => {
    const run = ++latest;
    const text = input.value;
    if (text === '') {
      output.textContent = placeholder;
      return;
    }
    try {
      const { payload } = await sealNote(text);
      if (run !== latest) return; // a newer keystroke already started
      const cipher = payload.ciphertext;
      output.textContent = cipher.length > 240 ? `${cipher.slice(0, 240)}…` : cipher;
    } catch (err) {
      if (run === latest) output.textContent = err instanceof NoteTooLargeError ? 'Too long to send.' : placeholder;
    }
  };

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void render(), 120);
  });
  input.form?.addEventListener('reset', () => {
    window.setTimeout(() => {
      latest++;
      output.textContent = placeholder;
    });
  });
}
