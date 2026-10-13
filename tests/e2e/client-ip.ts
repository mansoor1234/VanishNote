import type { BrowserContext } from '@playwright/test';

/**
 * Give each test its own client IP so the per-IP rate limits (10 creates a minute) don't make a
 * full suite run trip over itself. In production Cloudflare overwrites CF-Connecting-IP with the
 * real address, so clients can't do this.
 */
export async function useFreshClientIp(context: BrowserContext): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.51.${octet()}.${octet()}` });
}
