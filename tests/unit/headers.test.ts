import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANALYTICS_PATHS, isAnalyticsPath } from '../../src/lib/analytics';
import { ANALYTICS_CSP, CONTENT_SECURITY_POLICY, isPrivatePath, SECURITY_HEADERS } from '../../src/server/http';

/** Every block of a Cloudflare _headers file: path → indented lines ("Name: value" or "! Name"). */
function headerBlocks(): Map<string, string[]> {
  const lines = readFileSync(join(import.meta.dirname, '../../public/_headers'), 'utf8').split('\n');
  const blocks = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines) {
    if (/^\s+\S/.test(line)) current?.push(line.trim());
    else if (/^\/\S*$/.test(line.trim())) blocks.set(line.trim(), (current = []));
    else current = undefined;
  }
  return blocks;
}

/** The global "/*" block as a header map. */
function staticHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headerBlocks().get('/*') ?? []) {
    const [name, ...value] = line.split(':');
    headers[name!.trim()] = value.join(':').trim();
  }
  return headers;
}

describe('security headers', () => {
  it('public/_headers matches the headers the Worker sets', () => {
    expect(staticHeaders()).toEqual(SECURITY_HEADERS);
  });

  it('CSP forbids inline script, framing, and third-party origins', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:/);
  });

  it('never sends a referrer, so note URLs cannot leak to other sites', () => {
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
  });

  it('allows Google Analytics only on the information pages, never where notes or passwords are handled', () => {
    const blocks = headerBlocks();
    const withAnalytics = [...blocks].filter(([, lines]) => lines.some((l) => l.includes('googletagmanager'))).map(([path]) => path);
    expect(withAnalytics.sort()).toEqual([...ANALYTICS_PATHS].sort());
    for (const path of ANALYTICS_PATHS) {
      // '!' must drop the strict policy, or browsers enforce both and block analytics.
      expect(blocks.get(path)).toEqual(['! Content-Security-Policy', `Content-Security-Policy: ${ANALYTICS_CSP}`]);
    }
    expect(CONTENT_SECURITY_POLICY).not.toContain('google');
    expect(ANALYTICS_CSP).not.toContain('unsafe-inline');

    for (const path of ['/', '/n/abc', '/r/abc', '/d/abc', '/app', '/app/settings', '/login', '/signup', '/forgot', '/reset', '/verify', '/join', '/api/notes']) {
      expect(isAnalyticsPath(path), path).toBe(false);
    }
    for (const path of ['/pricing', '/faq', '/blog', '/blog/what-the-hash-in-a-link-does', '/privacy']) {
      expect(isAnalyticsPath(path), path).toBe(true);
    }
    expect(isAnalyticsPath('/blogger')).toBe(false);
  });

  it('treats note, destroy and API paths as private', () => {
    for (const path of ['/n/abc', '/d/abc', '/api/notes', '/api/notes/x/read']) expect(isPrivatePath(path)).toBe(true);
    for (const path of ['/', '/faq', '/blog/new-post', '/notes', '/directions']) expect(isPrivatePath(path)).toBe(false);
  });
});
