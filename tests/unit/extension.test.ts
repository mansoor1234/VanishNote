import { describe, expect, it } from 'vitest';
import { ApiError, createNote, validate, type AccountRules } from '../../extension/src/client';
import { decryptNote } from '../../src/lib/crypto';

const SERVER = 'https://vanishnote.test';

/** A fake server that records what it receives. */
function fakeServer(reply: (path: string, body: unknown) => { status?: number; json: unknown }) {
  const calls: { url: string; headers: Headers; body: unknown; credentials?: RequestCredentials }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, headers: new Headers(init?.headers), body, credentials: init?.credentials });
    const r = reply(new URL(url).pathname, body);
    return Response.json(r.json, { status: r.status ?? 201 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('browser extension client', () => {
  it('quick note: only ciphertext is sent, the key stays in the link, and it decrypts', async () => {
    const { calls, fetchImpl } = fakeServer(() => ({ json: { id: 'abc123', deleteToken: 'tok', expiresAt: 0 } }));
    const created = await createNote(SERVER, { kind: 'quick', text: 'wifi: hunter2', expiresIn: '1d', maxReads: 2 }, { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SERVER}/api/notes`);
    expect(calls[0]!.credentials).toBe('omit');
    expect(calls[0]!.headers.has('Authorization')).toBe(false);
    expect(JSON.stringify(calls[0]!.body)).not.toContain('hunter2');
    expect(calls[0]!.body).toMatchObject({ options: { expiresIn: '1d', maxReads: 2 } });

    const [base, key] = created.link.split('#');
    expect(base).toBe(`${SERVER}/n/abc123`);
    expect(JSON.stringify(calls[0]!.body)).not.toContain(key!);
    expect(created.destroyLink).toBe(`${SERVER}/d/abc123#tok`);
    const sent = calls[0]!.body as { ciphertext: string; iv: string };
    expect(await decryptNote(sent, key!)).toBe('wifi: hunter2');
  });

  it('account note: API key header, JSON body with title and shred settings, link from the returned path', async () => {
    const { calls, fetchImpl } = fakeServer(() => ({ json: { id: 'n1', path: '/n/n1?b=brand', expiresAt: 0 } }));
    const created = await createNote(
      SERVER,
      { kind: 'account', text: 'db pass', password: 'pw', title: ' Prod DB ', shred: { mode: 'time', expiresIn: '7d' } },
      { apiKey: 'vn_key', fetchImpl },
    );
    expect(calls[0]!.url).toBe(`${SERVER}/api/account/notes`);
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer vn_key');
    expect(calls[0]!.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]!.body).toMatchObject({ title: 'Prod DB', shred: { mode: 'time', expiresIn: '7d' } });
    expect((calls[0]!.body as { salt?: string }).salt).toBeTruthy(); // password-protected
    expect(created.link).toMatch(new RegExp(`^${SERVER}/n/n1\\?b=brand#[A-Za-z0-9_-]{43}$`));
    expect(created.destroyLink).toBeUndefined();
  });

  it('surfaces the server’s message, e.g. a team policy', async () => {
    const { fetchImpl } = fakeServer(() => ({ status: 403, json: { error: 'policy', message: 'Your team requires a password on every note.' } }));
    const attempt = createNote(SERVER, { kind: 'account', text: 'x', title: 't', shred: { mode: 'read', maxReads: 1 } }, { apiKey: 'vn_key', fetchImpl });
    await expect(attempt).rejects.toThrow(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403, code: 'policy', message: 'Your team requires a password on every note.' });
  });

  it('validates before encrypting, including the team’s password rule', () => {
    const rules = { requirePassword: true } as AccountRules;
    expect(validate({ kind: 'quick', text: '  ', expiresIn: '1d', maxReads: 1 })).toBe('Write the note first.');
    expect(validate({ kind: 'quick', text: 'x'.repeat(60 * 1024), expiresIn: '1d', maxReads: 1 })).toMatch(/too long/);
    expect(validate({ kind: 'account', text: 'x', title: '', shred: { mode: 'read', maxReads: 1 } })).toMatch(/title/);
    expect(validate({ kind: 'account', text: 'x', title: 't', shred: { mode: 'read', maxReads: 1 } }, rules)).toMatch(/requires a password/);
    expect(validate({ kind: 'account', text: 'x', title: 't', password: 'pw', shred: { mode: 'read', maxReads: 1 } }, rules)).toBeNull();
  });
});
