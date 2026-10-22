/**
 * "Add to Chrome / Edge / Firefox": names the visitor's browser and links to its store listing
 * (or /extension until it's published). Without this script the button reads "Get the extension".
 */
import { BROWSER_NAMES, detectBrowser, storeLink, type StoreBrowser } from '../lib/extension-store';

export function initExtensionCta(): void {
  const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } };
  const browser = detectBrowser(navigator.userAgent, nav.userAgentData?.brands ?? []);
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-extension-cta]')) {
    const target = (link.dataset['browser'] as StoreBrowser | undefined) ?? browser;
    if (!target) continue;
    const label = link.querySelector('[data-label]');
    if (label && !link.dataset['browser']) label.textContent = `Add to ${BROWSER_NAMES[target]}`;
    const href = storeLink(target);
    link.href = href;
    if (href.startsWith('http')) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
  }
  // On /extension: point out the button for this browser.
  if (browser) document.querySelector(`[data-store="${browser}"]`)?.setAttribute('data-current', '');
}
