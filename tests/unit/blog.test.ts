import { describe, expect, it } from 'vitest';
import { isPublished } from '../../src/lib/blog';
import { readdirSync, readFileSync } from 'node:fs';

describe('scheduled blog publication', () => {
  it('has seven real posts at 9 AM Karachi on November 15–21', () => {
    const dates = readdirSync('src/content/blog').map((file) =>
      readFileSync(`src/content/blog/${file}`, 'utf8').match(/^published:\s*(2026-11-(?:1[5-9]|2[01])T.+)$/m)?.[1],
    ).filter((date): date is string => !!date).sort();
    expect(dates).toEqual(Array.from({ length: 7 }, (_, i) => `2026-11-${15 + i}T09:00:00+05:00`));
  });
  it('publishes at 9 AM Karachi, including the exact boundary', () => {
    const post = { data: { published: new Date('2026-11-15T09:00:00+05:00') } };
    const release = Date.parse('2026-11-15T04:00:00Z');
    expect(isPublished(post, release - 1)).toBe(false);
    expect(isPublished(post, release)).toBe(true);
    expect(isPublished(post, release + 1)).toBe(true);
  });

  it('releases exactly one more post each day for seven days', () => {
    const posts = Array.from({ length: 7 }, (_, i) => ({ data: { published: new Date(`2026-11-${15 + i}T09:00:00+05:00`) } }));
    for (let day = 0; day <= 7; day++) {
      const now = Date.parse('2026-11-14T04:00:00Z') + day * 86_400_000;
      expect(posts.filter((post) => isPublished(post, now))).toHaveLength(day);
    }
  });
});
