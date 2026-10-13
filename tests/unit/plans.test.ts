import { describe, expect, it } from 'vitest';
import { EXPIRY_SECONDS, TIMED_EXPIRY_DAYS } from '../../src/lib/limits';
import { PLAN_ORDER, PLANS } from '../../src/lib/plans';

describe('plans', () => {
  it('quick notes (no account) never outlast the Free plan', () => {
    const longestQuickNoteDays = Math.max(...Object.values(EXPIRY_SECONDS)) / (24 * 60 * 60);
    expect(longestQuickNoteDays).toBe(PLANS.free.limits.retentionDays);
  });

  it('each plan is at least as generous as the one below it', () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLANS[PLAN_ORDER[i - 1]!].limits;
      const higher = PLANS[PLAN_ORDER[i]!].limits;
      expect(higher.retentionDays).toBeGreaterThanOrEqual(lower.retentionDays);
      expect(higher.attachmentBytes).toBeGreaterThanOrEqual(lower.attachmentBytes);
    }
  });

  it('every plan offers at least one "after a set time" option', () => {
    for (const id of PLAN_ORDER) {
      const allowed = Object.values(TIMED_EXPIRY_DAYS).filter((d) => d <= PLANS[id].limits.retentionDays);
      expect(allowed.length).toBeGreaterThan(0);
    }
  });
});
