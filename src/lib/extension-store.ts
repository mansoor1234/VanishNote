/**
 * Where to get the browser extension. Websites can't install extensions themselves (browsers
 * removed "inline install"), so "Add to Chrome" opens the store listing, where the user confirms.
 *
 * Paste each listing's URL here once it's published. Empty = that store shows "Coming soon" and
 * the header button links to /extension instead.
 */
export const EXTENSION_STORES = {
  chrome: '', // https://chromewebstore.google.com/detail/vanishnote/<id>
  edge: '', // https://microsoftedge.microsoft.com/addons/detail/<id>
  firefox: '', // https://addons.mozilla.org/firefox/addon/vanishnote/
} as const;

export type StoreBrowser = keyof typeof EXTENSION_STORES;

export const STORE_NAMES: Record<StoreBrowser, string> = {
  chrome: 'Chrome Web Store',
  edge: 'Edge Add-ons',
  firefox: 'Firefox Add-ons',
};

export const BROWSER_NAMES: Record<StoreBrowser, string> = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' };

/**
 * The visitor's desktop browser, or null (phones, Safari, unknown). Brave, Opera, Vivaldi and other
 * Chromium browsers install from the Chrome Web Store, so they count as Chrome.
 */
export function detectBrowser(userAgent: string, brands: readonly { brand: string }[] = []): StoreBrowser | null {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return null;
  if (brands.some((b) => b.brand === 'Microsoft Edge') || /\bEdg\//.test(userAgent)) return 'edge';
  if (/\bFirefox\//.test(userAgent)) return 'firefox';
  if (brands.some((b) => /Chrom/.test(b.brand)) || /\bChrome\//.test(userAgent)) return 'chrome';
  return null;
}

/** The store link for a browser, or the extension page when it isn't published there yet. */
export function storeLink(browser: StoreBrowser | null): string {
  return (browser && EXTENSION_STORES[browser]) || '/extension';
}
