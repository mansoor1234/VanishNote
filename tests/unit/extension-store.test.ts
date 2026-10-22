import { describe, expect, it } from 'vitest';
import { detectBrowser, EXTENSION_STORES, storeLink } from '../../src/lib/extension-store';

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

describe('extension store links', () => {
  it('detects desktop Chrome, Edge and Firefox; Chromium browsers use the Chrome Web Store', () => {
    expect(detectBrowser(UA.chrome)).toBe('chrome');
    expect(detectBrowser(UA.edge)).toBe('edge');
    expect(detectBrowser(UA.firefox)).toBe('firefox');
    expect(detectBrowser(UA.chrome, [{ brand: 'Brave' }, { brand: 'Chromium' }])).toBe('chrome');
    expect(detectBrowser(UA.chrome, [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }])).toBe('edge');
  });

  it('offers nothing to Safari or phones, where the extension doesn’t run', () => {
    expect(detectBrowser(UA.safari)).toBeNull();
    expect(detectBrowser(UA.androidChrome)).toBeNull();
    expect(detectBrowser(UA.iphone)).toBeNull();
  });

  it('links to the store when published, otherwise to /extension', () => {
    for (const browser of ['chrome', 'edge', 'firefox'] as const) {
      const url = EXTENSION_STORES[browser];
      expect(storeLink(browser)).toBe(url || '/extension');
      if (url) expect(url).toMatch(/^https:\/\//);
    }
    expect(storeLink(null)).toBe('/extension');
  });
});
