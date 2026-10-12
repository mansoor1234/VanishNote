import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptNote, encryptNote } from '../../src/lib/crypto';
import { EXPIRY_SECONDS, MAX_CIPHERTEXT_CHARS } from '../../src/lib/limits';
import type { CreateNoteResponse, ErrorResponse, ReadNoteResponse } from '../../src/lib/schema';
import {
  handleCreateNote,
  handleDeleteNote,
  handleReadNote,
  type ApiDeps,
  type Limiter,
} from '../../src/server/api';
import { purgeExpired } from '../../src/server/db';
import type { ReadNotification } from '../../src/server/email';
import { NOT_FOUND_MESSAGE } from '../../src/server/http';
import { createTestDb } from './d1';

let db: D1Database;
let dispose: () => Promise<void>;
let clock: number;
const deps = (): ApiDeps => ({ db, now: () => clock });

beforeAll(async () => {
  ({ db, dispose } = await createTestDb());
});
afterAll(async () => {
  await dispose();
});
beforeEach(async () => {
  clock = Date.UTC(2026, 0, 1);
  await db.prepare('DELETE FROM notes').run();
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://vanishnote.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function del(id: string, body: unknown): Request {
  return new Request(`https://vanishnote.test/api/notes/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function create(body: Record<string, unknown>, extra: Partial<ApiDeps> = {}) {
  const res = await handleCreateNote(post('/api/notes', body), { ...deps(), ...extra });
  return { res, data: (await res.json()) as CreateNoteResponse & ErrorResponse };
}

async function read(id: string, extra: Partial<ApiDeps> = {}) {
  const res = await handleReadNote(post(`/api/notes/${id}/read`, ''), id, { ...deps(), ...extra });
  return { res, data: (await res.json()) as ReadNoteResponse & ErrorResponse };
}

async function validNote(options: Record<string, unknown> = {}, password?: string) {
  const { payload, linkKey } = await encryptNote('hello from the test suite', password);
  return { body: { ...payload, options }, linkKey };
}

describe('POST /api/notes', () => {
  it('creates a note with defaults and returns an unguessable id and delete token', async () => {
    const { body } = await validNote();
    const { res, data } = await create(body);
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(data.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(data.deleteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.expiresAt).toBe(clock + EXPIRY_SECONDS['7d'] * 1000);

    const row = await db.prepare('SELECT * FROM notes WHERE id = ?').bind(data.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ reads_left: 1, has_password: 0, salt: null, notify_email: null });
    // Only a hash of the delete token is stored.
    expect(row!['delete_token_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(data.deleteToken);
  });

  it('never generates the same id twice', async () => {
    const { body } = await validNote();
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) ids.add((await create(body)).data.id);
    expect(ids.size).toBe(25);
  });

  it('stores password flag, salt, expiry, read count and email', async () => {
    const { body } = await validNote({ expiresIn: '1h', maxReads: 3, notifyEmail: 'me@example.com' }, 'pw');
    const { res, data } = await create(body);
    expect(res.status).toBe(201);
    const row = await db.prepare('SELECT * FROM notes WHERE id = ?').bind(data.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      has_password: 1,
      salt: body.salt,
      reads_left: 3,
      expires_at: clock + 3600 * 1000,
      notify_email: 'me@example.com',
    });
  });

  it.each([
    ['missing ciphertext', { iv: 'AAAAAAAAAAAAAAAA' }],
    ['bad iv length', { ciphertext: 'A'.repeat(40), iv: 'AAAA' }],
    ['non-base64url ciphertext', { ciphertext: '<script>alert(1)</script>xxxxxxxx', iv: 'AAAAAAAAAAAAAAAA' }],
    ['oversized ciphertext', { ciphertext: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 1), iv: 'AAAAAAAAAAAAAAAA' }],
    ['bad salt', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', salt: 'short' }],
    ['unknown expiry', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', options: { expiresIn: '1y' } }],
    ['zero reads', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', options: { maxReads: 0 } }],
    ['too many reads', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', options: { maxReads: 11 } }],
    ['fractional reads', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', options: { maxReads: 1.5 } }],
    ['bad email', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', options: { notifyEmail: 'nope' } }],
    ['unknown field (e.g. a key)', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', key: 'leak' }],
    ['plaintext field', { ciphertext: 'A'.repeat(40), iv: 'AAAAAAAAAAAAAAAA', text: 'secret' }],
  ])('rejects %s with 400', async (_name, body) => {
    const { res, data } = await create(body);
    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_request');
    const { count } = (await db.prepare('SELECT COUNT(*) AS count FROM notes').first<{ count: number }>())!;
    expect(count).toBe(0);
  });

  it('rejects non-JSON content types and malformed JSON', async () => {
    const wrongType = new Request('https://vanishnote.test/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect((await handleCreateNote(wrongType, deps())).status).toBe(415);
    expect((await handleCreateNote(post('/api/notes', '{not json'), deps())).status).toBe(400);
  });

  it('rejects bodies over the size cap with 413', async () => {
    const huge = JSON.stringify({ ciphertext: 'A'.repeat(200 * 1024), iv: 'AAAAAAAAAAAAAAAA' });
    expect((await handleCreateNote(post('/api/notes', huge), deps())).status).toBe(413);
  });

  it('returns 429 when the create limiter says no', async () => {
    const limiter: Limiter = { limit: vi.fn(async () => ({ success: false })) };
    const { body } = await validNote();
    const { res, data } = await create(body, { createLimiter: limiter });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(data.message).toMatch(/wait a minute/);
  });

  it('rate-limits per client IP', async () => {
    const limiter: Limiter = { limit: vi.fn(async () => ({ success: true })) };
    const { body } = await validNote();
    await handleCreateNote(post('/api/notes', body, { 'CF-Connecting-IP': '203.0.113.9' }), {
      ...deps(),
      createLimiter: limiter,
    });
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
  });
});

describe('POST /api/notes/:id/read', () => {
  it('returns ciphertext once, which decrypts with the fragment key, then 404s', async () => {
    const { body, linkKey } = await validNote();
    const { data: created } = await create(body);

    const first = await read(created.id);
    expect(first.res.status).toBe(200);
    expect(first.res.headers.get('Cache-Control')).toContain('no-store');
    expect(first.data).toMatchObject({ hasPassword: false, readsLeft: 0 });
    expect(await decryptNote(first.data, linkKey)).toBe('hello from the test suite');

    const second = await read(created.id);
    expect(second.res.status).toBe(404);
    expect(second.data.message).toBe(NOT_FOUND_MESSAGE);
    const { count } = (await db.prepare('SELECT COUNT(*) AS count FROM notes').first<{ count: number }>())!;
    expect(count).toBe(0);
  });

  it('round-trips a password-protected note through the API', async () => {
    const { body, linkKey } = await validNote({}, 'hunter2!');
    const { data: created } = await create(body);
    const { data } = await read(created.id);
    expect(data.hasPassword).toBe(true);
    expect(data.salt).toBe(body.salt);
    expect(await decryptNote(data, linkKey, 'hunter2!')).toBe('hello from the test suite');
  });

  it('serves multi-read notes exactly maxReads times', async () => {
    const { body } = await validNote({ maxReads: 3 });
    const { data: created } = await create(body);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await read(created.id));
    expect(results.map((r) => r.res.status)).toEqual([200, 200, 200, 404]);
    expect(results.slice(0, 3).map((r) => r.data.readsLeft)).toEqual([2, 1, 0]);
  });

  it('gives the same 404 for unknown, malformed, consumed and expired ids', async () => {
    const { body } = await validNote({ expiresIn: '1h' });
    const consumed = (await create(body)).data.id;
    await read(consumed);
    const expired = (await create(body)).data.id;
    clock += 3600 * 1000;

    const responses = await Promise.all(
      ['AAAAAAAAAAAAAAAAAAAAAA', 'not-an-id', consumed, expired].map((id) => read(id)),
    );
    for (const { res, data } of responses) {
      expect(res.status).toBe(404);
      expect(data).toEqual({ error: 'not_found', message: NOT_FOUND_MESSAGE });
    }
  });

  it('returns 429 when the read limiter says no, without consuming the note', async () => {
    const { body } = await validNote();
    const { data: created } = await create(body);
    const limiter: Limiter = { limit: async () => ({ success: false }) };
    expect((await read(created.id, { readLimiter: limiter })).res.status).toBe(429);
    expect((await read(created.id)).res.status).toBe(200);
  });
});

describe('burn-after-read race', () => {
  it('two simultaneous reads of a single-read note: exactly one succeeds', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const { body } = await validNote();
      const { data: created } = await create(body);
      const [a, b] = await Promise.all([read(created.id), read(created.id)]);
      expect([a.res.status, b.res.status].sort()).toEqual([200, 404]);
    }
  });

  it('a burst of 25 concurrent reads of a single-read note yields exactly one success', async () => {
    const { body } = await validNote();
    const { data: created } = await create(body);
    const results = await Promise.all(Array.from({ length: 25 }, () => read(created.id)));
    expect(results.filter((r) => r.res.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.res.status === 404)).toHaveLength(24);
  });

  it('a burst of 25 concurrent reads of a 5-read note yields exactly five successes', async () => {
    const { body } = await validNote({ maxReads: 5 });
    const { data: created } = await create(body);
    const results = await Promise.all(Array.from({ length: 25 }, () => read(created.id)));
    const ok = results.filter((r) => r.res.status === 200);
    expect(ok).toHaveLength(5);
    expect(ok.map((r) => r.data.readsLeft).sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('expiry', () => {
  it('rejects reads of an expired note even before the cron runs, and removes it', async () => {
    const { body } = await validNote({ expiresIn: '1d' });
    const { data: created } = await create(body);

    clock += EXPIRY_SECONDS['1d'] * 1000 - 1;
    const stillAlive = await db.prepare('SELECT 1 FROM notes WHERE id = ?').bind(created.id).first();
    expect(stillAlive).not.toBeNull();

    clock += 1; // exactly at expires_at counts as expired
    expect((await read(created.id)).res.status).toBe(404);
    expect(await db.prepare('SELECT 1 FROM notes WHERE id = ?').bind(created.id).first()).toBeNull();
  });

  it('is readable right up to the expiry instant', async () => {
    const { body } = await validNote({ expiresIn: '1h' });
    const { data: created } = await create(body);
    clock += 3600 * 1000 - 1;
    expect((await read(created.id)).res.status).toBe(200);
  });

  it('purgeExpired (cron) deletes only expired rows, including their emails', async () => {
    const { body: short } = await validNote({ expiresIn: '1h', notifyEmail: 'a@example.com' });
    const { body: long } = await validNote({ expiresIn: '30d' });
    await create(short);
    await create(short);
    const keep = (await create(long)).data.id;

    clock += 2 * 3600 * 1000;
    expect(await purgeExpired(db, clock)).toBe(2);
    const rows = await db.prepare('SELECT id, notify_email FROM notes').all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual([keep]);
  });
});

describe('DELETE /api/notes/:id', () => {
  it('destroys a note early with the correct delete token', async () => {
    const { body } = await validNote();
    const { data: created } = await create(body);
    const res = await handleDeleteNote(del(created.id, { deleteToken: created.deleteToken }), created.id, deps());
    expect(res.status).toBe(204);
    expect((await read(created.id)).res.status).toBe(404);
  });

  it('refuses the wrong token, and a token for another note, with a generic 404', async () => {
    const { body } = await validNote();
    const a = (await create(body)).data;
    const b = (await create(body)).data;
    const wrong = await handleDeleteNote(del(a.id, { deleteToken: 'A'.repeat(43) }), a.id, deps());
    const crossed = await handleDeleteNote(del(a.id, { deleteToken: b.deleteToken }), a.id, deps());
    const malformed = await handleDeleteNote(del(a.id, { deleteToken: 'x' }), a.id, deps());
    for (const res of [wrong, crossed, malformed]) expect(res.status).toBe(404);
    expect((await read(a.id)).res.status).toBe(200);
  });
});

describe('read notifications', () => {
  it('emails the creator on each read and deletes the address with the note', async () => {
    const sent: ReadNotification[] = [];
    const notify = async (n: ReadNotification) => {
      sent.push(n);
    };
    const { body } = await validNote({ maxReads: 2, notifyEmail: 'owner@example.com' });
    const { data: created } = await create(body);

    await read(created.id, { notify });
    await read(created.id, { notify });
    expect(sent).toEqual([
      { to: 'owner@example.com', readAt: clock, readsLeft: 1 },
      { to: 'owner@example.com', readAt: clock, readsLeft: 0 },
    ]);
    const leftovers = await db.prepare("SELECT COUNT(*) AS count FROM notes WHERE notify_email IS NOT NULL").first<{ count: number }>();
    expect(leftovers!.count).toBe(0);
  });

  it('a failing email provider never breaks the read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { body } = await validNote({ notifyEmail: 'owner@example.com' });
    const { data: created } = await create(body);
    const { res } = await read(created.id, {
      notify: async () => {
        throw new Error('Resend responded with HTTP 500');
      },
    });
    expect(res.status).toBe(200);
    // The log line must not contain the address or the note id.
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('owner@example.com');
    expect(logged).not.toContain(created.id);
    errorSpy.mockRestore();
  });
});
