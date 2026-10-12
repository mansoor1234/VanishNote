/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

declare namespace Cloudflare {
  interface Env {
    /** Secret. Set with `wrangler secret put RESEND_API_KEY`; unset disables notifications. */
    RESEND_API_KEY?: string;
    /** Secret. Turnstile server key. Unset only allowed for localhost requests. */
    TURNSTILE_SECRET_KEY?: string;
    /** Secret. Web Push VAPID private key (base64url P-256 scalar). Unset disables push. */
    VAPID_PRIVATE_KEY?: string;
    /** Local development only: "true" writes emails to the dev_outbox table instead of sending. */
    DEV_OUTBOX?: string;
  }
}

declare namespace App {
  interface Locals {
    /** Set by middleware for authenticated requests. */
    user?: import('./server/auth').SessionUser;
  }
}
