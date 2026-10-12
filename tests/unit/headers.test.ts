import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPrivatePath, SECURITY_HEADERS } from '../../src/server/http';

/** Parse the global "/*" block of a Cloudflare _headers file. */
function staticHeaders(): Record<string, string> {
  const lines = readFileSync(join(import.meta.dirname, '../../public/_headers'), 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === '/*');
  const headers: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const [name, ...value] = line.trim().split(':');
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

  it('treats note, destroy and API paths as private', () => {
    for (const path of ['/n/abc', '/d/abc', '/api/notes', '/api/notes/x/read']) expect(isPrivatePath(path)).toBe(true);
    for (const path of ['/', '/faq', '/blog/new-post', '/notes', '/directions']) expect(isPrivatePath(path)).toBe(false);
  });
});
