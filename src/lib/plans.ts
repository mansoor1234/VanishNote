/**
 * Plans: the single source of truth for the pricing page, the dashboard and the limits the
 * server enforces. Billing isn't wired up yet; a team's plan is set in the database
 * (see README "Changing a team's plan").
 */

export type PlanId = 'free' | 'standard' | 'business';

export interface PlanLimits {
  /** Account notes per calendar month (UTC). null = unlimited. */
  notesPerMonth: number | null;
  /** Information requests per calendar month (UTC). null = unlimited. */
  requestsPerMonth: number | null;
  /** Largest encrypted attachment, in bytes of plaintext. */
  attachmentBytes: number;
  /** Maximum lifetime of notes, requests and their activity history. */
  retentionDays: number;
  /** Team members allowed. 'seats' = the team's purchased seat count; null = unlimited. */
  maxUsers: number | 'seats' | null;
  /** Teammates see each other's notes and activity. */
  sharedNotes: boolean;
  /** Company name and logo on note pages and emails, Vanishnote marketing removed. */
  branding: boolean;
  /** Keep a note's activity history after it's shredded (until retention ends). */
  keepActivityAfterShred: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** USD per month when billed monthly. */
  monthlyPrice: number;
  /** USD per month when billed yearly (20% off). */
  yearlyMonthlyPrice: number;
  priceUnit: 'flat' | 'per user';
  priceNote: string;
  highlight?: string;
  limits: PlanLimits;
}

const MB = 1024 * 1024;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'For one person',
    monthlyPrice: 0,
    yearlyMonthlyPrice: 0,
    priceUnit: 'flat',
    priceNote: 'Free forever, no card needed',
    limits: {
      // Unlimited, like quick notes from the home page; information requests are the Free limit.
      notesPerMonth: null,
      requestsPerMonth: 2,
      attachmentBytes: 5 * MB,
      retentionDays: 7,
      maxUsers: 1,
      sharedNotes: false,
      branding: false,
      keepActivityAfterShred: false,
    },
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    tagline: 'For small teams',
    monthlyPrice: 5,
    yearlyMonthlyPrice: 4,
    priceUnit: 'per user',
    priceNote: 'Pay only for the people who use it',
    limits: {
      notesPerMonth: null,
      requestsPerMonth: null,
      attachmentBytes: 25 * MB,
      retentionDays: 183,
      maxUsers: 'seats',
      sharedNotes: true,
      branding: true,
      keepActivityAfterShred: true,
    },
  },
  business: {
    id: 'business',
    name: 'Business',
    tagline: 'For whole companies',
    monthlyPrice: 30,
    yearlyMonthlyPrice: 24,
    priceUnit: 'flat',
    priceNote: 'One price for everyone, no per-user fees',
    highlight: 'Most popular',
    limits: {
      notesPerMonth: null,
      requestsPerMonth: null,
      attachmentBytes: 25 * MB,
      retentionDays: 365,
      maxUsers: null,
      sharedNotes: true,
      branding: true,
      keepActivityAfterShred: true,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'standard', 'business'];

export function isPlanId(value: unknown): value is PlanId {
  return value === 'free' || value === 'standard' || value === 'business';
}

export function maxUsersFor(plan: Plan, seats: number): number | null {
  const max = plan.limits.maxUsers;
  return max === 'seats' ? Math.max(1, seats) : max;
}

export function formatRetention(days: number): string {
  if (days >= 365) return `${Math.round(days / 365) * 12} months`;
  if (days >= 28) return `${Math.round(days / 30.5)} months`;
  return `${days} days`;
}

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/** Feature rows for the pricing table. `true`/`false` render as included/not included. */
export const PRICING_ROWS: { label: string; value: (plan: Plan) => string | boolean }[] = [
  { label: 'AES-256 end-to-end encrypted notes', value: () => true },
  { label: 'Encrypted in your browser, never on our servers', value: () => true },
  { label: 'Safe from chat link previews', value: () => true },
  { label: 'Optional password and password hint', value: () => true },
  { label: 'Push and email read notifications', value: () => true },
  { label: 'Encrypted attachments', value: (p) => `${formatMB(p.limits.attachmentBytes)} per file` },
  {
    label: 'Notes',
    value: (p) => (p.limits.notesPerMonth === null ? 'Unlimited' : `${p.limits.notesPerMonth} per month`),
  },
  {
    label: 'Information requests',
    value: (p) => (p.limits.requestsPerMonth === null ? 'Unlimited' : `${p.limits.requestsPerMonth} per month`),
  },
  { label: 'Data retention', value: (p) => formatRetention(p.limits.retentionDays) },
  {
    label: 'Users',
    value: (p) =>
      p.limits.maxUsers === null ? 'Unlimited users, one flat price' : p.limits.maxUsers === 'seats' ? 'Pay per user' : '1 user',
  },
  { label: 'Activity history kept after shredding', value: (p) => p.limits.keepActivityAfterShred },
  { label: 'Shared team notes and activity', value: (p) => p.limits.sharedNotes },
  { label: 'Company branded notes and emails', value: (p) => p.limits.branding },
];
