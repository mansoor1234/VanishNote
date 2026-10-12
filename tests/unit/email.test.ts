import { describe, expect, it, vi } from 'vitest';
import { buildReadEmail, createResendNotifier } from '../../src/server/email';

describe('read notification email', () => {
  it('says when the note was opened and whether it is gone, without note details', () => {
    const final = buildReadEmail({ to: 'a@example.com', readAt: Date.UTC(2026, 4, 1, 12), readsLeft: 0 }, 'https://v.test');
    expect(final.text).toContain('Fri, 01 May 2026 12:00:00 GMT');
    expect(final.text).toContain('permanently destroyed');
    expect(final.text).toContain('address has been deleted');

    const partial = buildReadEmail({ to: 'a@example.com', readAt: 0, readsLeft: 2 }, 'https://v.test');
    expect(partial.text).toContain('2 more times');
    expect(partial.text).not.toContain('address has been deleted');
  });

  it('is disabled when no API key is configured', () => {
    expect(createResendNotifier({ apiKey: undefined, from: 'x', appUrl: 'y' })).toBeUndefined();
    expect(createResendNotifier({ apiKey: '', from: 'x', appUrl: 'y' })).toBeUndefined();
  });

  it('posts to Resend and reports failures by status only', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"secret":"body"}', { status: 422 }));
    const notify = createResendNotifier({
      apiKey: 're_test',
      from: 'Vanishnote <n@v.test>',
      appUrl: 'https://v.test',
      fetchImpl,
    })!;
    await expect(notify({ to: 'me@example.com', readAt: 0, readsLeft: 0 })).rejects.toThrow(
      /^Resend responded with HTTP 422$/,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toMatchObject({ to: ['me@example.com'], from: 'Vanishnote <n@v.test>' });
  });
});
