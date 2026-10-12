/**
 * Worker entry point: Astro handles HTTP, and the hourly Cron Trigger enforces expiry and
 * retention. Reads also reject expired notes on their own, so the cron is cleanup, not enforcement.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { runCleanup } from './server/cleanup';

export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runCleanup(env, Date.now()).then((r) => {
        console.log(`cron: purged ${r.notes} notes, ${r.requests} requests, ${r.records} records, ${r.files} files`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
