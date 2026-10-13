import { deriveAuthKey, normalizeEmail } from '../lib/crypto';
import { postJson } from './http-client';
import { $, initPasswordToggles } from './ui';

const INVITE_KEY = 'vn_invite';

/** Only same-site paths are allowed as a post-login destination. */
function safeNext(): string {
  const next = new URLSearchParams(location.search).get('next') ?? '';
  return /^\/(?!\/)[\w\-/?=&%.#]*$/.test(next) ? next : '/app';
}

function afterLogin(): string {
  try {
    if (sessionStorage.getItem(INVITE_KEY)) return '/join';
  } catch {
    // storage unavailable: ignore
  }
  return safeNext();
}

function turnstileToken(form: HTMLFormElement): string | undefined {
  const field = form.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
  return field?.value || undefined;
}

function resetTurnstile(): void {
  (window as unknown as { turnstile?: { reset: () => void } }).turnstile?.reset();
}

type Kind = 'signup' | 'login' | 'forgot' | 'reset' | 'resend';

export function initAuthForms(): void {
  initPasswordToggles();
  for (const form of document.querySelectorAll<HTMLFormElement>('form[data-auth-form]')) {
    const kind = form.dataset['authForm'] as Kind;
    const errorBox = $('[data-error]', form);
    const submit = $<HTMLButtonElement>('button[type="submit"]', form);
    const label = submit.textContent ?? '';
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;

    const fail = (message: string, focus?: HTMLElement | null) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
      focus?.focus();
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      for (const input of form.querySelectorAll<HTMLInputElement>('input[required]')) {
        if (!input.checkValidity()) {
          if (input.type === 'checkbox') return fail('Please accept the terms and privacy policy to continue.', input);
          const what = form.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? 'This field';
          return fail(
            input.type === 'email'
              ? 'Enter a valid email address.'
              : input.minLength > 0 && input.value.length < input.minLength
                ? `${what} must be at least ${input.minLength} characters.`
                : `${what} is required.`,
            input,
          );
        }
      }
      const confirm = field('confirm');
      if (confirm && confirm.value !== field('password')?.value) return fail('The passwords don’t match.', confirm);

      const email = normalizeEmail(field('email')?.value ?? '');
      submit.disabled = true;
      submit.textContent = kind === 'signup' || kind === 'login' || kind === 'reset' ? 'Securing your password…' : 'Sending…';
      try {
        const authKey = field('password') ? await deriveAuthKey(email, field('password')!.value) : undefined;
        let result;
        if (kind === 'signup') {
          result = await postJson('/api/auth/signup', {
            name: field('name')!.value.trim(),
            email,
            authKey,
            acceptTerms: true,
            turnstileToken: turnstileToken(form),
          });
        } else if (kind === 'login') {
          result = await postJson<{ twoFactor?: boolean; challengeId?: string; message?: string }>('/api/auth/login', {
            email,
            authKey,
          });
          if (result.ok && result.data.twoFactor && result.data.challengeId) {
            showLoginCodeStep(form, result.data.challengeId, result.data.message ?? 'Check your email for a sign-in code.');
            return;
          }
        } else if (kind === 'reset') {
          const token = location.hash.slice(1);
          result = await postJson('/api/auth/reset', { token, email, authKey });
        } else {
          result = await postJson(kind === 'forgot' ? '/api/auth/forgot' : '/api/auth/resend', {
            email,
            turnstileToken: turnstileToken(form),
          });
        }

        if (!result.ok) {
          resetTurnstile();
          if (result.error === 'unverified') {
            return fail(`${result.message} Use “Didn’t get the email?” on the sign-up page.`);
          }
          return fail(result.message);
        }
        if (kind === 'login' || kind === 'reset') {
          location.assign(afterLogin());
          return;
        }
        form.hidden = true;
        const done = document.querySelector<HTMLElement>('[data-done]');
        if (done) {
          done.hidden = false;
          done.querySelector<HTMLElement>('[role="status"]')?.focus();
        }
      } finally {
        submit.disabled = false;
        submit.textContent = label;
      }
    });
  }
}

/** Two-factor sign-in: swap the password form for the emailed-code form. */
function showLoginCodeStep(passwordForm: HTMLFormElement, challengeId: string, message: string): void {
  const form = document.querySelector<HTMLFormElement>('form[data-login-code]');
  if (!form) return;
  passwordForm.hidden = true;
  form.hidden = false;
  $('[data-code-message]', form).textContent = message;
  const input = $<HTMLInputElement>('input[name="code"]', form);
  const errorBox = $('[data-error]', form);
  const submit = $<HTMLButtonElement>('button[type="submit"]', form);
  input.focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) {
      errorBox.textContent = 'Enter the 6-digit code from the email.';
      errorBox.hidden = false;
      input.focus();
      return;
    }
    submit.disabled = true;
    const result = await postJson('/api/auth/login/code', { challengeId, code });
    if (result.ok) {
      location.assign(afterLogin());
      return;
    }
    submit.disabled = false;
    errorBox.textContent = result.message;
    errorBox.hidden = false;
    if (result.error === 'code_expired') {
      // Start over: back to email and password.
      form.hidden = true;
      passwordForm.hidden = false;
      const passwordError = $('[data-error]', passwordForm);
      passwordError.textContent = result.message;
      passwordError.hidden = false;
    } else {
      input.select();
    }
  });
}

/** /verify#token: confirm on button press (never automatically). */
export function initVerify(): void {
  const token = location.hash.slice(1);
  const box = document.querySelector<HTMLElement>('[data-verify]');
  if (!box || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  box.hidden = false;
  const intro = document.querySelector<HTMLElement>('[data-resend-intro]');
  if (intro) intro.textContent = 'Link not working? We can send a new one.';
  const button = $<HTMLButtonElement>('[data-verify-button]');
  const errorBox = $('[data-error]', box);
  button.addEventListener('click', async () => {
    button.disabled = true;
    errorBox.hidden = true;
    const result = await postJson('/api/auth/verify', { token });
    if (result.ok) {
      history.replaceState(null, '', '/verify');
      location.assign(afterLogin());
      return;
    }
    errorBox.textContent = result.message;
    errorBox.hidden = false;
    button.disabled = false;
  });
}

/** /join#token: remember the invite across log-in or sign-up, then accept it. */
export function initJoin(): void {
  const root = $('[data-join]');
  let token = location.hash.slice(1);
  try {
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) sessionStorage.setItem(INVITE_KEY, token);
    else token = sessionStorage.getItem(INVITE_KEY) ?? '';
  } catch {
    // storage unavailable: rely on the fragment only
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    root.hidden = true;
    $('[data-missing]').hidden = false;
    return;
  }
  const button = root.querySelector<HTMLButtonElement>('[data-join-button]');
  if (!button) return;
  const errorBox = $('[data-error]', root);
  button.addEventListener('click', async () => {
    button.disabled = true;
    errorBox.hidden = true;
    const result = await postJson('/api/account/team/join', { token });
    if (result.ok) {
      try {
        sessionStorage.removeItem(INVITE_KEY);
      } catch {
        // ignore
      }
      location.assign('/app/team');
      return;
    }
    errorBox.textContent = result.message;
    errorBox.hidden = false;
    button.disabled = false;
  });
}
