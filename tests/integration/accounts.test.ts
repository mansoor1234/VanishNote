import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRequestKeys,
  decryptNote,
  decryptNoteFile,
  deriveAuthKey,
  openRequestFile,
  openRequestText,
  responseKey,
  sealForRequest,
  sealNote,
  unlockRequestKey,
} from '../../src/lib/crypto';
import { handleReadNote } from '../../src/server/api';
import { runCleanup } from '../../src/server/cleanup';
import { createCtx, type AppEnv } from '../../src/server/context';
import { onAccountNoteRead } from '../../src/server/records';
import { handleApi } from '../../src/server/router';
import { LEGAL_UPDATED } from '../../src/lib/site';
import { createTestEnv } from './d1';

let env: AppEnv;
let dispose: () => Promise<void>;
let clock: number;
let pending: Promise<unknown>[] = [];

beforeAll(async () => {
  const t = await createTestEnv();
  env = {
    DB: t.db,
    FILES: t.files,
    APP_URL: 'https://vanishnote.test',
    EMAIL_FROM: 'Vanishnote <n@vanishnote.test>',
    DEV_OUTBOX: 'true',
  };
  dispose = t.dispose;
});
afterAll(async () => dispose());
beforeEach(() => {
  clock = Date.UTC(2026, 5, 1);
});

const BASE = 'http://localhost';

/** crypto.getRandomValues fills at most 64 KB per call. */
function randomFile(size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, size)));
  return out;
}

/** Call the router like the Worker would, then wait for background work (emails, pushes). */
async function api(method: string, path: string, opts: { json?: unknown; form?: FormData; cookie?: string } = {}) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.1' };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    const encoded = new Response(opts.form);
    headers['Content-Type'] = encoded.headers.get('Content-Type')!;
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    headers['Content-Length'] = String(bytes.length);
    body = bytes;
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  const request = new Request(`${BASE}${path}`, { method, headers, ...(body ? { body } : {}) });
  const res = await handleApi(createCtx(request, env, { now: clock, waitUntil: (p) => pending.push(p) }));
  await Promise.all(pending);
  pending = [];
  return res;
}

async function readNote(id: string) {
  const req = new Request(`${BASE}/api/notes/${id}/read`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  const res = await handleReadNote(req, id, {
    db: env.DB,
    now: () => clock,
    onAccountRead: (nid, note, now) => onAccountNoteRead(env, nid, note, now, 'GB', (p) => pending.push(p)),
  });
  await Promise.all(pending);
  pending = [];
  return res;
}

async function outbox(to: string) {
  const rows = await env.DB.prepare('SELECT subject, text FROM dev_outbox WHERE to_email = ?1 ORDER BY id').bind(to).all<{ subject: string; text: string }>();
  return rows.results;
}

function linkIn(text: string, path: string): string {
  const match = text.match(new RegExp(`https://vanishnote\\.test${path}[^\\s]*`));
  if (!match) throw new Error(`no ${path} link in email`);
  return match[0];
}

let counter = 0;
/** Sign up, verify by email, and return a session cookie. */
async function newUser(name = 'Jane') {
  const email = `user${++counter}-${Date.now()}@example.com`;
  const password = `pw-${counter}-correct horse`;
  const authKey = await deriveAuthKey(email, password);
  const signup = await api('POST', '/api/auth/signup', { json: { name, email, authKey, acceptTerms: true } });
  expect(signup.status).toBe(202);
  const [mail] = await outbox(email);
  const token = linkIn(mail!.text, '/verify#').split('#')[1];
  const verify = await api('POST', '/api/auth/verify', { json: { token } });
  expect(verify.status).toBe(200);
  const cookie = verify.headers.get('Set-Cookie')!.split(';')[0]!;
  return { email, password, authKey, cookie, name };
}

async function teamOf(email: string) {
  return (await env.DB.prepare('SELECT team_id FROM users WHERE email = ?1').bind(email).first<{ team_id: string }>())!.team_id;
}

async function createNote(
  cookie: string,
  opts: { password?: string; file?: Uint8Array<ArrayBuffer>; shred?: unknown; title?: string } = {},
) {
  const sealed = await sealNote('the vault code is 1234', opts.password, opts.file ? { bytes: opts.file, meta: { name: 'a.pdf', type: 'application/pdf' } } : undefined);
  const meta: Record<string, unknown> = {
    ...sealed.payload,
    title: opts.title ?? 'Vault code',
    shred: opts.shred ?? { mode: 'read', maxReads: 1 },
  };
  if (sealed.file) meta['file'] = { iv: sealed.file.iv, meta: sealed.file.meta, metaIv: sealed.file.metaIv };
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  if (sealed.file) form.set('file', new Blob([sealed.file.bytes]), 'encrypted.bin');
  const res = await api('POST', '/api/account/notes', { form, cookie });
  return { res, sealed, data: res.ok ? ((await res.json()) as { id: string; path: string }) : null };
}

describe('sign-up, verification and login', () => {
  it('signs up, verifies by email and gets a session; the password never reaches the server', async () => {
    const user = await newUser();
    expect(user.cookie).toMatch(/^vn_session=[A-Za-z0-9_-]{43}$/);
    expect((await api('GET', '/api/account/records', { cookie: user.cookie })).status).toBe(200);
    const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?1').bind(user.email).first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(user.password);
    expect(JSON.stringify(row)).not.toContain(user.authKey);
  });

  it('gives the same answer for an existing email and does not create a second account', async () => {
    const user = await newUser();
    const again = await api('POST', '/api/auth/signup', { json: { name: 'Mallory', email: user.email, authKey: user.authKey, acceptTerms: true } });
    expect(again.status).toBe(202);
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?1').bind(user.email).first<{ n: number }>())!;
    expect(n).toBe(1);
    expect((await outbox(user.email)).at(-1)!.subject).toMatch(/tried to sign up/);
  });

  it('rejects unverified logins, wrong passwords and reused verification links', async () => {
    const email = `unverified-${Date.now()}@example.com`;
    const authKey = await deriveAuthKey(email, 'pw');
    await api('POST', '/api/auth/signup', { json: { name: 'U', email, authKey, acceptTerms: true } });
    expect((await api('POST', '/api/auth/login', { json: { email, authKey } })).status).toBe(403);

    const token = linkIn((await outbox(email))[0]!.text, '/verify#').split('#')[1];
    expect((await api('POST', '/api/auth/verify', { json: { token } })).status).toBe(200);
    expect((await api('POST', '/api/auth/verify', { json: { token } })).status).toBe(400);

    const wrong = await api('POST', '/api/auth/login', { json: { email, authKey: await deriveAuthKey(email, 'nope') } });
    expect(wrong.status).toBe(401);
    const ok = await api('POST', '/api/auth/login', { json: { email, authKey } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Set-Cookie')).toMatch(/HttpOnly; SameSite=Lax/);
  });

  it('an unknown email and a wrong password get the same error', async () => {
    const user = await newUser();
    const a = await api('POST', '/api/auth/login', { json: { email: 'nobody@example.com', authKey: user.authKey } });
    const b = await api('POST', '/api/auth/login', { json: { email: user.email, authKey: 'A'.repeat(43) } });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(await a.json()).toEqual(await b.json());
  });

  it('logout ends the session', async () => {
    const user = await newUser();
    await api('POST', '/api/auth/logout', { cookie: user.cookie });
    expect((await api('GET', '/api/account/records', { cookie: user.cookie })).status).toBe(401);
  });

  it('password reset replaces the password and signs out other sessions', async () => {
    const user = await newUser();
    expect((await api('POST', '/api/auth/forgot', { json: { email: user.email } })).status).toBe(202);
    const token = linkIn((await outbox(user.email)).at(-1)!.text, '/reset#').split('#')[1];
    const newKey = await deriveAuthKey(user.email, 'brand new password');
    const res = await api('POST', '/api/auth/reset', { json: { token, email: user.email, authKey: newKey } });
    expect(res.status).toBe(200);
    expect((await api('GET', '/api/account/records', { cookie: user.cookie })).status).toBe(401);
    expect((await api('POST', '/api/auth/login', { json: { email: user.email, authKey: user.authKey } })).status).toBe(401);
    expect((await api('POST', '/api/auth/login', { json: { email: user.email, authKey: newKey } })).status).toBe(200);
  });

  it('turnstile is required off localhost when no secret is configured', async () => {
    const req = new Request('https://vanishnote.test/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', email: 'x@example.com', authKey: 'A'.repeat(43), acceptTerms: true }),
    });
    const res = await handleApi(createCtx(req, env, { now: clock }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('captcha_failed');
  });

  it('account endpoints need a session', async () => {
    expect((await api('GET', '/api/account/records')).status).toBe(401);
    expect((await api('POST', '/api/account/notes', { json: {} })).status).toBe(401);
  });
});

describe('account notes', () => {
  it('Free plan: notes are unlimited, like quick notes from the home page', async () => {
    const user = await newUser();
    const results = await Promise.all(Array.from({ length: 8 }, () => createNote(user.cookie)));
    expect(results.map((r) => r.res.status)).toEqual(Array(8).fill(201));
  });

  it('attachment: encrypted in R2, downloadable once after reveal, then shredded', async () => {
    const user = await newUser();
    const file = randomFile(200_000);
    const { res, sealed, data } = await createNote(user.cookie, { password: 'pw', file });
    expect(res.status).toBe(201);

    const read = await readNote(data!.id);
    const note = (await read.json()) as { ciphertext: string; iv: string; salt: string; file: { downloadToken: string; iv: string; meta: string; metaIv: string } };
    expect(await decryptNote(note, sealed.linkKey, 'pw')).toBe('the vault code is 1234');

    const download = await api('GET', `/api/files/${note.file.downloadToken}`);
    expect(download.status).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes).not.toEqual(file); // ciphertext only
    const opened = await decryptNoteFile(note, sealed.linkKey, 'pw', { bytes, iv: note.file.iv, meta: note.file.meta, metaIv: note.file.metaIv });
    expect(opened.bytes).toEqual(file);
    expect(opened.meta.name).toBe('a.pdf');

    expect((await api('GET', `/api/files/${note.file.downloadToken}`)).status).toBe(404);
    expect((await readNote(data!.id)).status).toBe(404);

    const record = await env.DB.prepare('SELECT status FROM records WHERE id = ?1').bind(data!.id).first<{ status: string }>();
    expect(record!.status).toBe('shredded');
    // Free plan: activity is removed when the note is shredded.
    expect((await api('GET', `/api/account/records/${data!.id}`, { cookie: user.cookie }).then((r) => r.json()) as { events: unknown[] }).events).toEqual([]);
    expect((await outbox(user.email)).at(-1)!.subject).toBe('“Vault code” was opened');

    // After the grace period the cron deletes the encrypted file from R2.
    clock += 16 * 60 * 1000;
    const report = await runCleanup(env, clock);
    expect(report.files).toBeGreaterThanOrEqual(1);
    const listed = await env.FILES.list({ prefix: `notes/${data!.id}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it('rejects attachments over the plan limit', async () => {
    const user = await newUser();
    const { res } = await createNote(user.cookie, { file: new Uint8Array(5 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
  });

  it('"after a set time" notes stay readable until they expire; plan retention caps the time', async () => {
    const user = await newUser();
    expect((await createNote(user.cookie, { shred: { mode: 'time', expiresIn: '30d' } })).res.status).toBe(403);

    const { data } = await createNote(user.cookie, { shred: { mode: 'time', expiresIn: '1d' } });
    expect((await readNote(data!.id)).status).toBe(200);
    const second = await readNote(data!.id);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { readsLeft: number }).readsLeft).toBe(-1);
    clock += 24 * 60 * 60 * 1000;
    expect((await readNote(data!.id)).status).toBe(404);
  });

  it('emails the link only for password-protected notes, once', async () => {
    const user = await newUser('Sam');
    const plain = await createNote(user.cookie);
    const send = (id: string, linkKey: string) =>
      api('POST', `/api/account/notes/${id}/send`, { json: { recipientEmail: 'bob@example.com', linkKey }, cookie: user.cookie });
    expect((await send(plain.data!.id, plain.sealed.linkKey)).status).toBe(400);

    const protectedNote = await createNote(user.cookie, { password: 'pw' });
    expect((await send(protectedNote.data!.id, protectedNote.sealed.linkKey)).status).toBe(204);
    const mail = (await outbox('bob@example.com')).at(-1)!;
    expect(mail.subject).toBe('Sam sent you a private note');
    expect(mail.text).toContain(`/n/${protectedNote.data!.id}#${protectedNote.sealed.linkKey}`);
    expect(mail.text).not.toContain('the vault code');
    expect((await send(protectedNote.data!.id, protectedNote.sealed.linkKey)).status).toBe(409);
  });

  it('deleting from the dashboard destroys the note and removes its history', async () => {
    const user = await newUser();
    const { data } = await createNote(user.cookie);
    expect((await api('DELETE', `/api/account/records/${data!.id}`, { cookie: user.cookie })).status).toBe(204);
    expect((await readNote(data!.id)).status).toBe(404);
    expect((await api('GET', `/api/account/records/${data!.id}`, { cookie: user.cookie })).status).toBe(404);
  });

  it('other teams cannot see or delete a note', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const { data } = await createNote(owner.cookie);
    expect((await api('GET', `/api/account/records/${data!.id}`, { cookie: stranger.cookie })).status).toBe(404);
    expect((await api('DELETE', `/api/account/records/${data!.id}`, { cookie: stranger.cookie })).status).toBe(404);
    expect((await readNote(data!.id)).status).toBe(200);
  });

  it('wrong-password reports always answer 204 and are recorded for live notes', async () => {
    const user = await newUser();
    const { data } = await createNote(user.cookie, { shred: { mode: 'read', maxReads: 2 }, password: 'pw' });
    await readNote(data!.id);
    expect((await api('POST', `/api/notes/${data!.id}/events`, { json: { type: 'wrong_password' } })).status).toBe(204);
    expect((await api('POST', '/api/notes/AAAAAAAAAAAAAAAAAAAAAA/events', { json: { type: 'wrong_password' } })).status).toBe(204);
    const { events } = (await (await api('GET', `/api/account/records/${data!.id}`, { cookie: user.cookie })).json()) as { events: { type: string; country: string | null }[] };
    expect(events.map((e) => e.type)).toEqual(['created', 'opened', 'wrong_password']);
    expect(events[1]!.country).toBe('GB');
  });
});

describe('information requests', () => {
  async function createRequest(cookie: string, password = 'request-pw') {
    const keys = await createRequestKeys(password);
    const { fingerprint, ...wrapped } = keys;
    const res = await api('POST', '/api/account/requests', {
      json: { title: 'Passport number', ...wrapped, message: 'Please send your passport number', recipientEmail: 'client@example.com' },
      cookie,
    });
    return { res, keys, fingerprint, data: res.ok ? ((await res.json()) as { id: string; path: string }) : null };
  }

  async function respond(id: string, publicKey: string, fingerprint: string, file?: Uint8Array<ArrayBuffer>) {
    const sealed = await sealForRequest(publicKey, fingerprint, 'P1234567', file ? { bytes: file, meta: { name: 'scan.jpg', type: 'image/jpeg' } } : undefined);
    const meta: Record<string, unknown> = { response: sealed.response, responseIv: sealed.responseIv, epk: sealed.epk };
    if (sealed.file) meta['file'] = { iv: sealed.file.iv, meta: sealed.file.meta, metaIv: sealed.file.metaIv };
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    if (sealed.file) form.set('file', new Blob([sealed.file.bytes]));
    return api('POST', `/api/requests/${id}/respond`, { form });
  }

  it('end to end: request → emailed link → one response → requester unlocks, opens once', async () => {
    const user = await newUser('Ana');
    const { data, keys, fingerprint } = await createRequest(user.cookie);
    expect(data!.path).toBe(`/r/${data!.id}#${fingerprint}`);
    const mail = (await outbox('client@example.com')).at(-1)!;
    expect(mail.subject).toBe('Ana sent you a secure request');
    expect(mail.text).toContain(data!.path);

    const file = randomFile(10_000);
    const [a, b] = await Promise.all([respond(data!.id, keys.publicKey, fingerprint, file), respond(data!.id, keys.publicKey, fingerprint)]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect((await outbox(user.email)).at(-1)!.subject).toBe('“Passport number” has been answered');

    // Step 1 has no side effects: the wrapped key, checked locally against the password.
    const keyRes = await api('GET', `/api/account/requests/${data!.id}/key`, { cookie: user.cookie });
    const wrapped = (await keyRes.json()) as { publicKey: string; wrappedKey: string; wrappedKeyIv: string; wrappedKeySalt: string; answered: boolean };
    expect(wrapped.answered).toBe(true);
    await expect(unlockRequestKey(wrapped, 'wrong')).rejects.toThrow();
    const privateKey = await unlockRequestKey(wrapped, 'request-pw');

    // Step 2 hands over the response and shreds it.
    const opened = (await (await api('POST', `/api/account/requests/${data!.id}/open`, { cookie: user.cookie })).json()) as {
      response: string; responseIv: string; epk: string; file?: { downloadToken: string; iv: string; meta: string; metaIv: string };
    };
    const key = await responseKey(privateKey, wrapped.publicKey, opened.epk);
    const winner = a.status === 200 ? 'with-file' : 'no-file';
    expect(await openRequestText(key, opened.response, opened.responseIv)).toBe('P1234567');
    if (winner === 'with-file') {
      const bytes = new Uint8Array(await (await api('GET', `/api/files/${opened.file!.downloadToken}`)).arrayBuffer());
      const f = await openRequestFile(key, { bytes, iv: opened.file!.iv, meta: opened.file!.meta, metaIv: opened.file!.metaIv });
      expect(f.bytes).toEqual(file);
      expect(f.meta.name).toBe('scan.jpg');
    }
    expect((await api('POST', `/api/account/requests/${data!.id}/open`, { cookie: user.cookie })).status).toBe(404);
    const record = await env.DB.prepare('SELECT status FROM records WHERE id = ?1').bind(data!.id).first<{ status: string }>();
    expect(record!.status).toBe('opened');
  });

  it('Free plan: 2 requests a month, enforced atomically under concurrency', async () => {
    const user = await newUser();
    const results = await Promise.all(Array.from({ length: 5 }, () => createRequest(user.cookie)));
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(2);
    const refused = results.find((r) => r.res.status === 403)!;
    expect(((await refused.res.json()) as { error: string }).error).toBe('quota_reached');

    clock = Date.UTC(2026, 6, 1); // next month (the 30-day session has also expired: log in again)
    const login = await api('POST', '/api/auth/login', { json: { email: user.email, authKey: user.authKey } });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await createRequest(cookie)).res.status).toBe(201);
  });

  it('expired requests cannot be answered', async () => {
    const user = await newUser();
    const { data, keys, fingerprint } = await createRequest(user.cookie);
    clock += 8 * 24 * 60 * 60 * 1000; // past Free retention
    expect((await respond(data!.id, keys.publicKey, fingerprint)).status).toBe(404);
  });
});

describe('teams and branding', () => {
  it('Free plan cannot invite; Standard can, up to its seats; members share notes', async () => {
    const owner = await newUser('Olive');
    const invite = (email: string, cookie = owner.cookie) => api('POST', '/api/account/team/invite', { json: { email }, cookie });
    const member = await newUser('Mo');
    expect((await invite(member.email)).status).toBe(403);

    const teamId = await teamOf(owner.email);
    await env.DB.prepare("UPDATE teams SET plan = 'standard', seats = 2 WHERE id = ?1").bind(teamId).run();
    expect((await invite(member.email)).status).toBe(204);
    expect((await invite('third@example.com')).status).toBe(403); // owner + 1 pending = 2 seats

    const memberNote = await createNote(member.cookie, { title: 'Before joining' });
    const token = linkIn((await outbox(member.email)).at(-1)!.text, '/join#').split('#')[1];
    expect((await api('POST', '/api/account/team/join', { json: { token }, cookie: member.cookie })).status).toBe(204);
    expect(await teamOf(member.email)).toBe(teamId);

    await createNote(owner.cookie, { title: 'Owner note' });
    const list = (await (await api('GET', '/api/account/records', { cookie: owner.cookie })).json()) as { records: { title: string; author: string }[] };
    expect(list.records.map((r) => r.title).sort()).toEqual(['Before joining', 'Owner note']);
    expect(list.records.find((r) => r.title === 'Before joining')!.author).toBe('Mo');
    expect((await readNote(memberNote.data!.id)).status).toBe(200);

    // Members can't manage the team; the owner can remove them.
    expect((await invite('x@example.com', member.cookie)).status).toBe(403);
    const memberId = (await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(member.email).first<{ id: string }>())!.id;
    expect((await api('DELETE', `/api/account/team/members/${memberId}`, { cookie: owner.cookie })).status).toBe(204);
    expect(await teamOf(member.email)).not.toBe(teamId);
  });

  it('branding: premium only, logos sniffed by content, served with a locked-down CSP', async () => {
    const owner = await newUser();
    const brand = (logo: Uint8Array<ArrayBuffer> | null, type = 'image/png') => {
      const form = new FormData();
      form.set('brandName', 'Acme Ltd');
      if (logo) form.set('logo', new Blob([logo], { type }), 'logo');
      return api('POST', '/api/account/team/branding', { form, cookie: owner.cookie });
    };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    expect((await brand(png)).status).toBe(403);

    await env.DB.prepare("UPDATE teams SET plan = 'business' WHERE id = ?1").bind(await teamOf(owner.email)).run();
    const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');
    expect((await brand(svg, 'image/png')).status).toBe(415);
    const ok = await brand(png);
    expect(ok.status).toBe(200);
    const { brandId } = (await ok.json()) as { brandId: string };

    const logo = await api('GET', `/brand/${brandId}/logo`);
    // The logo route is served by handleLogo (not the API router); check it directly.
    expect(logo.status).toBe(404);
    const { handleLogo } = await import('../../src/server/team');
    const res = await handleLogo(createCtx(new Request(`${BASE}/brand/${brandId}/logo`), env, { now: clock }), brandId);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');

    // New note links carry the brand.
    const { data } = await createNote(owner.cookie);
    expect(data!.path).toBe(`/n/${data!.id}?b=${brandId}`);
  });
});

describe('settings and cleanup', () => {
  it('changing the password requires the current one and signs out', async () => {
    const user = await newUser();
    const newKey = await deriveAuthKey(user.email, 'next password');
    expect((await api('POST', '/api/account/password', { json: { currentAuthKey: 'A'.repeat(43), newAuthKey: newKey }, cookie: user.cookie })).status).toBe(403);
    expect((await api('POST', '/api/account/password', { json: { currentAuthKey: user.authKey, newAuthKey: newKey }, cookie: user.cookie })).status).toBe(200);
    expect((await api('GET', '/api/account/records', { cookie: user.cookie })).status).toBe(401);
    expect((await api('POST', '/api/auth/login', { json: { email: user.email, authKey: newKey } })).status).toBe(200);
  });

  it('deleting an account removes its team, notes and history', async () => {
    const user = await newUser();
    const { data } = await createNote(user.cookie);
    const teamId = await teamOf(user.email);
    expect((await api('POST', '/api/account/delete', { json: { authKey: user.authKey }, cookie: user.cookie })).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM teams WHERE id = ?1').bind(teamId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM records WHERE id = ?1').bind(data!.id).first()).toBeNull();
    expect((await readNote(data!.id)).status).toBe(404);
  });

  it('cron removes records and activity after the plan retention period', async () => {
    const user = await newUser();
    const { data } = await createNote(user.cookie);
    clock += 7 * 24 * 60 * 60 * 1000;
    await runCleanup(env, clock);
    expect(await env.DB.prepare('SELECT 1 FROM records WHERE id = ?1').bind(data!.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM record_events WHERE record_id = ?1').bind(data!.id).first()).toBeNull();
  });

  it('the dev outbox is unreachable unless explicitly enabled', async () => {
    expect((await api('GET', '/api/dev/outbox')).status).toBe(200);
    const off = { ...env, DEV_OUTBOX: undefined };
    const res = await handleApi(createCtx(new Request(`${BASE}/api/dev/outbox`), off, { now: clock }));
    expect(res.status).toBe(404);
  });
});

describe('security settings', () => {
  function cookiesFrom(res: Response): string[] {
    return res.headers.getSetCookie().map((c) => c.split(';')[0]!);
  }

  async function login(email: string, authKey: string, cookie?: string) {
    const res = await api('POST', '/api/auth/login', { json: { email, authKey }, ...(cookie ? { cookie } : {}) });
    return { res, body: (await res.json()) as { ok?: boolean; twoFactor?: boolean; challengeId?: string } };
  }

  it('sign-up records which version of the terms was accepted, and requires acceptance', async () => {
    const user = await newUser();
    const row = await env.DB.prepare('SELECT terms_version, terms_accepted_at FROM users WHERE email = ?1')
      .bind(user.email)
      .first<{ terms_version: string; terms_accepted_at: number }>();
    expect(row).toEqual({ terms_version: LEGAL_UPDATED, terms_accepted_at: clock });

    const email = `noconsent-${Date.now()}@example.com`;
    const res = await api('POST', '/api/auth/signup', { json: { name: 'N', email, authKey: await deriveAuthKey(email, 'pw') } });
    expect(res.status).toBe(400);
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE email = ?1').bind(email).first()).toBeNull();

    // Re-accepting (e.g. after the terms change) updates the record.
    clock += 1000;
    expect((await api('POST', '/api/account/consent', { json: { accept: true }, cookie: user.cookie })).status).toBe(200);
    const after = await env.DB.prepare('SELECT terms_accepted_at FROM users WHERE email = ?1')
      .bind(user.email)
      .first<{ terms_accepted_at: number }>();
    expect(after!.terms_accepted_at).toBe(clock);
  });

  it('two-factor: unrecognised devices need an emailed code; recognised ones do not', async () => {
    const user = await newUser('Tess');
    // Enabling needs the password, and remembers the current browser.
    const badPassword = { enabled: true, authKey: 'A'.repeat(43) };
    expect((await api('POST', '/api/account/2fa', { json: badPassword, cookie: user.cookie })).status).toBe(403);
    const enable = await api('POST', '/api/account/2fa', { json: { enabled: true, authKey: user.authKey }, cookie: user.cookie });
    expect(enable.status).toBe(200);
    const device = cookiesFrom(enable).find((c) => c.startsWith('vn_device='))!;
    expect(device).toMatch(/^vn_device=[A-Za-z0-9_-]{43}$/);

    // Same browser: straight in.
    expect((await login(user.email, user.authKey, device)).body).toEqual({ ok: true });

    // New browser: the password alone isn't enough.
    const fresh = await login(user.email, user.authKey);
    expect(fresh.body.twoFactor).toBe(true);
    expect(fresh.res.headers.getSetCookie()).toEqual([]);
    const mail = (await outbox(user.email)).at(-1)!;
    expect(mail.subject).toMatch(/^\d{6} is your Vanishnote sign-in code$/);
    const code = mail.subject.slice(0, 6);
    const stored = await env.DB.prepare('SELECT code_hash FROM login_challenges WHERE id = ?1')
      .bind(fresh.body.challengeId)
      .first<{ code_hash: string }>();
    expect(stored!.code_hash).not.toContain(code);

    const wrong = code === '000000' ? '111111' : '000000';
    const attempt = (c: string) => api('POST', '/api/auth/login/code', { json: { challengeId: fresh.body.challengeId, code: c } });
    expect((await attempt(wrong)).status).toBe(401);
    const ok = await attempt(code);
    expect(ok.status).toBe(200);
    const cookies = cookiesFrom(ok);
    expect(cookies.some((c) => c.startsWith('vn_session='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('vn_device='))).toBe(true);
    // The code is single-use.
    expect((await attempt(code)).status).toBe(400);

    // Turning it off needs the password and forgets remembered devices.
    const disable = await api('POST', '/api/account/2fa', { json: { enabled: false, authKey: user.authKey }, cookie: user.cookie });
    expect(disable.status).toBe(200);
    expect((await login(user.email, user.authKey)).body).toEqual({ ok: true });
  });

  it('two-factor codes allow only five attempts', async () => {
    const user = await newUser();
    await api('POST', '/api/account/2fa', { json: { enabled: true, authKey: user.authKey }, cookie: user.cookie });
    const { body } = await login(user.email, user.authKey);
    const code = (await outbox(user.email)).at(-1)!.subject.slice(0, 6);
    const wrong = code === '000000' ? '111111' : '000000';
    const attempt = (c: string) => api('POST', '/api/auth/login/code', { json: { challengeId: body.challengeId, code: c } });
    for (let i = 0; i < 5; i++) expect((await attempt(wrong)).status).toBe(401);
    // Even the right code is refused once the attempts are used up.
    expect((await attempt(code)).status).toBe(400);
  });

  it('API key: shown once, stored hashed, works only on note and request endpoints', async () => {
    const user = await newUser();
    expect((await api('POST', '/api/account/api-key', { json: { authKey: 'A'.repeat(43) }, cookie: user.cookie })).status).toBe(403);
    const created = await api('POST', '/api/account/api-key', { json: { authKey: user.authKey }, cookie: user.cookie });
    expect(created.status).toBe(201);
    const { key, prefix } = (await created.json()) as { key: string; prefix: string };
    expect(key).toMatch(/^vn_[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(prefix)).toBe(true);
    const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?1').bind(user.email).first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(key);

    const bearer = (method: string, path: string, json?: unknown, token = key) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '203.0.113.7' };
      if (json !== undefined) headers['Content-Type'] = 'application/json';
      const req = new Request(`${BASE}${path}`, { method, headers, ...(json !== undefined ? { body: JSON.stringify(json) } : {}) });
      return handleApi(createCtx(req, env, { now: clock }));
    };
    expect((await bearer('GET', '/api/account/records')).status).toBe(200);
    // Never on security-sensitive endpoints.
    expect((await bearer('POST', '/api/account/api-key', { authKey: user.authKey })).status).toBe(401);
    expect((await bearer('POST', '/api/account/delete', { authKey: user.authKey })).status).toBe(401);
    expect((await bearer('POST', '/api/account/2fa', { enabled: false, authKey: user.authKey })).status).toBe(401);

    // Regenerating replaces the old key; revoking disables it.
    const second = (await (await api('POST', '/api/account/api-key', { json: { authKey: user.authKey }, cookie: user.cookie })).json()) as { key: string };
    expect(second.key).not.toBe(key);
    expect((await bearer('GET', '/api/account/records')).status).toBe(401);
    expect((await bearer('GET', '/api/account/records', undefined, second.key)).status).toBe(200);
    await api('DELETE', '/api/account/api-key', { cookie: user.cookie });
    expect((await bearer('GET', '/api/account/records', undefined, second.key)).status).toBe(401);
  });
});
