/**
 * Team policies set by the owner on paid plans. The server enforces them on every note and
 * request; the dashboard and browser extension use the same rules to shape their forms.
 */
import { TIMED_EXPIRY_DAYS, type TimedExpiry } from './limits';
import { PLANS, type PlanId } from './plans';

export interface TeamPolicy {
  /** Every note must have a password. */
  requirePassword: boolean;
  /** Longest lifetime for notes and requests; null = the plan's retention. */
  maxExpiry: TimedExpiry | null;
  /** Members (not the owner) must sign in with Google or Microsoft. Business only. */
  requireSso: boolean;
}

export const NO_POLICY: TeamPolicy = { requirePassword: false, maxExpiry: null, requireSso: false };

export function isTimedExpiry(value: unknown): value is TimedExpiry {
  return typeof value === 'string' && Object.hasOwn(TIMED_EXPIRY_DAYS, value);
}

/** The policy that applies: stored settings, limited to what the team's plan includes. */
export function effectivePolicy(
  plan: PlanId,
  stored: { requirePassword: boolean; maxExpiry: string | null; requireSso: boolean },
): TeamPolicy {
  const limits = PLANS[plan].limits;
  if (!limits.teamAdmin) return NO_POLICY;
  return {
    requirePassword: stored.requirePassword,
    maxExpiry: isTimedExpiry(stored.maxExpiry) && TIMED_EXPIRY_DAYS[stored.maxExpiry] < limits.retentionDays ? stored.maxExpiry : null,
    requireSso: limits.ssoEnforcement && stored.requireSso,
  };
}

/** Longest a note or request may live, in days: the plan's retention, capped by the policy. */
export function maxLifetimeDays(plan: PlanId, policy: TeamPolicy): number {
  const retention = PLANS[plan].limits.retentionDays;
  return policy.maxExpiry ? Math.min(retention, TIMED_EXPIRY_DAYS[policy.maxExpiry]) : retention;
}

/** "Shred after a set time" choices this team may use. */
export function allowedTimedExpiries(plan: PlanId, policy: TeamPolicy): TimedExpiry[] {
  const max = maxLifetimeDays(plan, policy);
  return (Object.keys(TIMED_EXPIRY_DAYS) as TimedExpiry[]).filter((key) => TIMED_EXPIRY_DAYS[key] <= max);
}

/** Human description of a lifetime in days, e.g. "1 day", "7 days", "12 months". */
export function formatLifetime(days: number): string {
  if (days < 1) return `${Math.round(days * 24)} hour${Math.round(days * 24) === 1 ? '' : 's'}`;
  if (days >= 365) return `${Math.round(days / 365) * 12} months`;
  if (days >= 90) return `${Math.round(days / 30.5)} months`;
  return `${days} day${days === 1 ? '' : 's'}`;
}
