/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

declare namespace Cloudflare {
  interface Env {
    /** Secret. Set with `wrangler secret put RESEND_API_KEY`; unset disables notifications. */
    RESEND_API_KEY?: string;
  }
}
