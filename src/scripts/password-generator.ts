import {
  buildAlphabet,
  DEFAULT_LENGTH,
  entropyBits,
  generateFromOptions,
  strengthLabel,
  type CharacterSet,
  type PasswordOptions,
} from '../lib/password';
import { $, initCopyButtons } from './ui';

export function initPasswordGenerator(): void {
  const root = $('#generator');
  const output = $<HTMLInputElement>('#generated-password');
  const form = $<HTMLFormElement>('[data-options]', root);
  const length = $<HTMLInputElement>('#password-length');
  const lengthValue = $('[data-length-value]', root);
  const strength = $('[data-strength]', root);
  const setsError = $('[data-sets-error]', root);

  initCopyButtons(root);

  const options = (): PasswordOptions => ({
    length: Number(length.value) || DEFAULT_LENGTH,
    sets: [...form.querySelectorAll<HTMLInputElement>('input[name="sets"]:checked')].map((el) => el.value as CharacterSet),
    avoidLookAlikes: $<HTMLInputElement>('input[name="avoidLookAlikes"]', form).checked,
  });

  const generate = () => {
    const opts = options();
    lengthValue.textContent = String(opts.length);
    setsError.hidden = opts.sets.length > 0;
    if (opts.sets.length === 0) {
      output.value = '';
      strength.textContent = ' ';
      return;
    }
    output.value = generateFromOptions(opts);
    const bits = Math.round(entropyBits(opts.length, buildAlphabet(opts.sets, opts.avoidLookAlikes).length));
    strength.textContent = `${strengthLabel(bits)} · about ${bits} bits`;
  };

  form.addEventListener('input', generate);
  form.addEventListener('submit', (event) => event.preventDefault());
  $('[data-regenerate]', root).addEventListener('click', generate);

  // Hand the password to the note form on this page; nothing travels in the URL.
  $('[data-send-note]', root).addEventListener('click', () => {
    if (!output.value) return;
    const note = $<HTMLTextAreaElement>('#note-text');
    note.value = output.value;
    note.dispatchEvent(new Event('input', { bubbles: true }));
    $('#composer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    note.focus({ preventScroll: true });
  });

  generate();
}
