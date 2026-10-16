/** Operator details shown on public pages. Change these before launch. */
export const CONTACT_EMAIL = 'hello@vanishnote.net';
export const SECURITY_EMAIL = 'security@vanishnote.net';
export const LEGAL_UPDATED = '2026-10-17';

/**
 * Public path for a page. With `build.format: 'file'`, prerendered pages see
 * pathnames like "/faq.html" or "/index.html"; the served URL is "/faq" or "/".
 */
export function cleanPath(pathname: string): string {
  return pathname.replace(/\.html$/, '').replace(/\/(index)?$/, '') || '/';
}
