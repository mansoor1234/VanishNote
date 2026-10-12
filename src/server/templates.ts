/** Transactional email content. Nothing here ever contains a note's or response's contents. */
import type { Email } from './mail';

export interface Brand {
  name: string;
  logoUrl?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Section {
  /** Paragraphs of plain text. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Small print under the button. */
  footer?: string[];
}

function render(to: string, subject: string, section: Section, brand?: Brand): Email {
  const text = [
    ...section.paragraphs,
    ...(section.button ? ['', `${section.button.label}: ${section.button.url}`] : []),
    ...(section.footer?.length ? ['', ...section.footer] : []),
    '',
    brand ? `Sent securely by ${brand.name}` : 'Vanishnote',
  ].join('\n');

  const header = brand
    ? brand.logoUrl
      ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="40">`
      : `<strong>${escapeHtml(brand.name)}</strong>`
    : '<strong style="color:#4338ca">vanish</strong><strong style="color:#545869">note</strong>';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b1d2a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #d9d8e0;border-radius:16px">
<tr><td style="padding:28px 28px 8px;font-size:20px">${header}</td></tr>
<tr><td style="padding:8px 28px 24px;font-size:15px;line-height:1.6">
${section.paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('\n')}
${
  section.button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(section.button.url)}" style="background:#4338ca;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;display:inline-block">${escapeHtml(section.button.label)}</a></p>`
    : ''
}
${(section.footer ?? []).map((p) => `<p style="margin:0 0 10px;font-size:13px;color:#545869">${escapeHtml(p)}</p>`).join('\n')}
</td></tr></table>
<p style="font-size:12px;color:#545869;margin-top:16px">${brand ? `Sent securely by ${escapeHtml(brand.name)}` : 'Vanishnote: encrypted notes that disappear after reading'}</p>
</td></tr></table></body></html>`;
  return { to, subject, text, html };
}

export function verifyEmail(to: string, name: string, url: string): Email {
  return render(to, 'Confirm your email for Vanishnote', {
    paragraphs: [`Hi ${name},`, 'Confirm your email address to finish creating your Vanishnote account.'],
    button: { label: 'Confirm email', url },
    footer: ['This link expires in 24 hours. If you didn’t sign up, you can ignore this email.'],
  });
}

export function signupExistingEmail(to: string, loginUrl: string, resetUrl: string): Email {
  return render(to, 'Someone tried to sign up with your email', {
    paragraphs: [
      'Someone tried to create a Vanishnote account with this email address, but you already have one.',
      `If it was you, log in at ${loginUrl}. Forgot your password? Reset it at ${resetUrl}.`,
    ],
    footer: ['If it wasn’t you, you don’t need to do anything.'],
  });
}

export function resetEmail(to: string, url: string): Email {
  return render(to, 'Reset your Vanishnote password', {
    paragraphs: ['Use the button below to choose a new password.'],
    button: { label: 'Choose a new password', url },
    footer: ['This link expires in 1 hour. If you didn’t ask for this, you can ignore this email.'],
  });
}

export function noteForRecipientEmail(
  to: string,
  sender: string,
  title: string,
  url: string,
  hint: string | null,
  brand?: Brand,
): Email {
  const paragraphs = [
    `${sender} sent you a private note: “${title}”.`,
    'It’s end-to-end encrypted and will be destroyed after you read it. You’ll need the password they gave you.',
  ];
  if (hint) paragraphs.push(`Password hint: ${hint}`);
  return render(
    to,
    `${sender} sent you a private note`,
    {
      paragraphs,
      button: { label: 'Open the note', url },
      footer: ['Don’t forward this email: anyone with the link and password can open the note.'],
    },
    brand,
  );
}

export function requestForRecipientEmail(
  to: string,
  sender: string,
  title: string,
  message: string | null,
  url: string,
  brand?: Brand,
): Email {
  const paragraphs = [`${sender} asked you to share information securely: “${title}”.`];
  if (message) paragraphs.push(message);
  paragraphs.push(
    'Whatever you enter is encrypted in your browser so only they can read it. You don’t need an account.',
  );
  return render(to, `${sender} sent you a secure request`, { paragraphs, button: { label: 'Respond securely', url } }, brand);
}

export function noteOpenedEmail(to: string, title: string, readsLeft: number, dashboardUrl: string): Email {
  const status =
    readsLeft === 0
      ? 'It has now been shredded.'
      : readsLeft > 0
        ? `It can be opened ${readsLeft} more ${readsLeft === 1 ? 'time' : 'times'}.`
        : 'It stays available until it expires.';
  return render(to, `“${title}” was opened`, {
    paragraphs: [`Your note “${title}” was just opened. ${status}`],
    button: { label: 'View activity', url: dashboardUrl },
  });
}

export function requestCompletedEmail(to: string, title: string, dashboardUrl: string): Email {
  return render(to, `“${title}” has been answered`, {
    paragraphs: [
      `Your information request “${title}” has been answered.`,
      'Open it from your dashboard with the request password. It will be shredded once you open it.',
    ],
    button: { label: 'Open dashboard', url: dashboardUrl },
  });
}

export function inviteEmail(to: string, inviter: string, team: string, url: string): Email {
  return render(to, `${inviter} invited you to ${team} on Vanishnote`, {
    paragraphs: [`${inviter} invited you to join ${team} on Vanishnote, to share encrypted notes as a team.`],
    button: { label: 'Join the team', url },
    footer: ['This invitation expires in 7 days.'],
  });
}

export function contactEmail(to: string, from: { name: string; email: string; team: string; plan: string }, subject: string, message: string): Email {
  return {
    ...render(to, `[Contact] ${subject}`, {
      paragraphs: [`From: ${from.name} <${from.email}>`, `Team: ${from.team} (${from.plan} plan)`, '', message],
    }),
    replyTo: from.email,
  };
}
