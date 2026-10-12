/**
 * Worker entry point: Astro handles HTTP, and the hourly Cron Trigger purges expired notes.
 * Reads also reject expired notes on their own, so the cron is cleanup, not enforcement.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { purgeExpired } from './server/db';

export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      purgeExpired(env.DB, Date.now()).then((count) => {
        console.log(`cron: purged ${count} expired notes`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
