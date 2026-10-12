/**
 * Outgoing email. Production sends through Resend's HTTP API. For local development,
 * DEV_OUTBOX=true writes messages to the dev_outbox table instead (read them at /api/dev/outbox).
 * Never log addresses or message bodies.
 */
import type { AppEnv } from './context';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export type Mailer = (email: Email) => Promise<void>;

export function createMailer(env: AppEnv, fetchImpl: typeof fetch = fetch): Mailer | undefined {
  if (env.DEV_OUTBOX === 'true') {
    return async (email) => {
      await env.DB.prepare('INSERT INTO dev_outbox (to_email, subject, text, created_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(email.to, email.subject, email.text, Date.now())
        .run();
    };
  }
  if (!env.RESEND_API_KEY) return undefined;
  return async (email) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Resend responded with HTTP ${response.status}`);
  };
}

/** Send without letting a failure break the request. Logs the error message only. */
export function sendInBackground(
  mailer: Mailer | undefined,
  email: Email,
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  if (!mailer) return;
  waitUntil(
    mailer(email).catch((err: unknown) => {
      console.error('email failed:', err instanceof Error ? err.message : 'unknown error');
    }),
  );
}
