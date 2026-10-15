/**
 * Google Analytics, opt-in. Base.astro includes this only on ANALYTICS_PATHS, never on pages that
 * handle notes or passwords. Nothing from Google loads until the visitor accepts.
 */
import { CONSENT_KEY, GA_MEASUREMENT_ID } from '../lib/analytics';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function readChoice(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function saveChoice(choice: 'granted' | 'denied' | null): void {
  try {
    if (choice) localStorage.setItem(CONSENT_KEY, choice);
    else localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Storage blocked: the banner simply shows again next time.
  }
}

function loadGoogleAnalytics(): void {
  if (document.querySelector('script[data-ga]')) return;
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js expects the `arguments` object itself, not an array.
  function gtag(..._args: unknown[]): void {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  }
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.dataset['ga'] = '';
  document.head.appendChild(script);
}

/** Remove the _ga cookies Google Analytics set, on this host and its parent domain. */
function clearGoogleCookies(): void {
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0]!.trim())
    .filter((n) => n === '_ga' || n.startsWith('_ga_'));
  const domain = location.hostname.replace(/^www\./, '');
  for (const name of names) {
    for (const scope of ['', `; domain=${domain}`, `; domain=.${domain}`]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${scope}`;
    }
  }
}

export function initAnalytics(): void {
  const banner = document.querySelector<HTMLElement>('[data-consent-banner]');
  if (!banner) return;
  const choice = readChoice();
  if (choice === 'granted') loadGoogleAnalytics();
  else if (choice === null) banner.hidden = false;

  banner.querySelector('[data-consent-accept]')?.addEventListener('click', () => {
    saveChoice('granted');
    banner.hidden = true;
    loadGoogleAnalytics();
  });
  banner.querySelector('[data-consent-decline]')?.addEventListener('click', () => {
    saveChoice('denied');
    banner.hidden = true;
    clearGoogleCookies();
  });
  for (const button of document.querySelectorAll<HTMLElement>('[data-consent-change]')) {
    button.addEventListener('click', () => {
      saveChoice(null);
      clearGoogleCookies();
      banner.hidden = false;
      banner.querySelector<HTMLElement>('[data-consent-accept]')?.focus();
    });
  }
}
