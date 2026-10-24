/**
 * Google Analytics runs only on these information pages, and only after the visitor accepts.
 * Never on pages that handle note content, keys or passwords (home, /n, /r, /d, the dashboard,
 * login and sign-up, the landing pages with a note form, the password generator): a third-party
 * script there could read the link fragment, the text or the password.
 *
 * public/_headers gives exactly these paths ANALYTICS_CSP (tests/unit/headers.test.ts checks).
 */
export const GA_MEASUREMENT_ID = 'G-EZDT80VC6P';

export const ANALYTICS_PATHS = [
  '/pricing',
  '/extension',
  '/faq',
  '/how-it-works',
  '/security',
  '/privacy',
  '/terms',
  '/privnote-alternative',
  '/onetimesecret-alternative',
  '/blog',
  '/blog/*',
] as const;

/** `pathname` without a trailing ".html" (see cleanPath). */
export function isAnalyticsPath(pathname: string): boolean {
  return ANALYTICS_PATHS.some((p) => (p.endsWith('/*') ? pathname.startsWith(p.slice(0, -1)) && pathname.length > p.length - 1 : pathname === p));
}

/** localStorage key holding the visitor's choice: 'granted' or 'denied'. */
export const CONSENT_KEY = 'vn-analytics-consent';
