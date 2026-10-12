/** Read notifications via the Resend HTTP API. Contains nothing about the note itself. */

export interface ReadNotification {
  to: string;
  readAt: number;
  readsLeft: number;
}

export type Notifier = (notification: ReadNotification) => Promise<void>;

export interface ResendConfig {
  apiKey: string | undefined;
  from: string;
  appUrl: string;
  fetchImpl?: typeof fetch;
}

export function buildReadEmail({ readAt, readsLeft }: ReadNotification, appUrl: string) {
  const when = new Date(readAt).toUTCString();
  const status =
    readsLeft === 0
      ? 'It has now been permanently destroyed.'
      : `It can be opened ${readsLeft} more ${readsLeft === 1 ? 'time' : 'times'} before it is destroyed.`;
  const subject = 'Your Vanishnote was opened';
  const lines = [
    `A note you created on Vanishnote was opened on ${when}.`,
    status,
    '',
    "We can't tell you who opened it or what it said — we never had the key.",
  ];
  if (readsLeft === 0) lines.push('Your email address has been deleted along with the note.');
  lines.push('', appUrl);
  const text = lines.join('\n');
  return { subject, text };
}

export function createResendNotifier(config: ResendConfig): Notifier | undefined {
  if (!config.apiKey) return undefined;
  const doFetch = config.fetchImpl ?? fetch;
  return async (notification) => {
    const { subject, text } = buildReadEmail(notification, config.appUrl);
    const response = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [notification.to], subject, text }),
    });
    if (!response.ok) {
      // Status only: never log the address or the response body.
      throw new Error(`Resend responded with HTTP ${response.status}`);
    }
  };
}
