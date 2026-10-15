import type { AppEnv } from './context';
import { createMailer, type Email } from './mail';
import { sendPush, type PushMessage } from './webpush';

/**
 * Tell an account holder something happened: email, plus a push to every device they enabled.
 * Runs in the background; failures are logged without addresses or endpoints.
 */
export function notifyUser(
  env: AppEnv,
  userId: string,
  email: Email | null,
  push: PushMessage,
  now: number,
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  const mailer = createMailer(env);
  const work = async () => {
    const tasks: Promise<unknown>[] = [];
    if (email && mailer) tasks.push(mailer(email));
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      const vapid = {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT || 'mailto:hello@vanishnote.net',
      };
      const subs = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1')
        .bind(userId)
        .all<{ endpoint: string; p256dh: string; auth: string }>();
      for (const sub of subs.results) {
        tasks.push(
          sendPush(sub, push, vapid, now).then(async (result) => {
            if (result === 'gone') {
              await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(sub.endpoint).run();
            }
          }),
        );
      }
    }
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('notification failed:', r.reason instanceof Error ? r.reason.message : 'unknown error');
      }
    }
  };
  waitUntil(work());
}
