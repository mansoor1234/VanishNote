/**
 * Public pages written for a specific search (docs/SEO_PLAN.md §2). Each one links to the others
 * through RelatedGuides, and the footer lists them. All are indexable: never add one to PRIVATE_PATH.
 */
export interface Guide {
  href: string;
  title: string;
  blurb: string;
}

export const GUIDES: Guide[] = [
  {
    href: '/send-password-securely',
    title: 'Send a password securely',
    blurb: 'Share a login with a link that works once, instead of leaving it in email or chat.',
  },
  {
    href: '/one-time-secret-link',
    title: 'One-time secret links',
    blurb: 'What a one-time link is, how it self-destructs, and when to add a password.',
  },
  {
    href: '/share-api-keys',
    title: 'Share API keys and .env files',
    blurb: 'Hand a teammate credentials without committing them or pasting them into Slack.',
  },
  {
    href: '/password-generator',
    title: 'Password generator',
    blurb: 'Make a strong random password in your browser, then send it as a self-destructing note.',
  },
  {
    href: '/privnote-alternative',
    title: 'Vanishnote vs Privnote',
    blurb: 'How the two compare on encryption, options and accounts.',
  },
  {
    href: '/onetimesecret-alternative',
    title: 'Vanishnote vs One-Time Secret',
    blurb: 'Where each one encrypts your secret, and what each offers.',
  },
];
