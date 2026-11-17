---
title: "Accidentally shared an API key? What to do next"
seoTitle: "Accidentally shared an API key?"
description: "Posted a real API key in chat, a ticket or a repository? Revoke or rotate it, inspect its use, and replace dependent copies before cleaning up the message."
published: 2026-11-16T09:00:00+05:00
cover: /blog-images/accidentally-shared-an-api-key.webp
coverAlt: "A broken coral API key beside a fresh mint key rising through a glass ring."
updated: 2026-11-17T00:00:00+05:00
---

> **At a glance:** Revoke or rotate the exposed key first, check its use, then update dependent applications and remove visible copies.

You paste a debugging example into a ticket and notice the real API key after pressing send. Or you commit a configuration file that was supposed to contain placeholders.

Deleting the message is useful cleanup, but it doesn't stop the key from working. Start with the service that issued it.

## 1. Revoke or rotate the exposed credential

Open the provider's trusted dashboard directly. Follow its procedure for revoking or rotating the key. If someone may be using it already, prioritise disabling that access; don't leave an exposed key active just to tidy the message first.

Rotation procedures differ. Some services let you create a replacement before disabling the old key; others replace a key immediately. Understand which applications depend on it and coordinate with the service owner to avoid an unexpected outage.

Never paste the exposed key into a public checker to see whether it still works. That creates another disclosure.

## 2. Check what the key could access

Was it limited to a test project, or could it read customer data, create resources, or spend money? Review the provider's available usage history, audit records, and billing activity for the exposure period.

Record the key identifier, affected project, approximate time, actions taken, and anything suspicious. Keep the secret value out of incident notes. Notify your security contact or account owner using your organisation's incident process, especially if customer information may be involved.

No suspicious activity in the logs is reassuring, but it isn't proof that nobody copied the key.

## 3. Update the applications that used it

Put the replacement in the appropriate secrets store or deployment environment. Restart or redeploy services if they require it, then confirm that legitimate requests work and the old credential has been disabled.

Check background jobs, local development settings, and integrations as well as the main app. A key can be used in more places than the configuration file that exposed it.

## 4. Clean up the exposed copies

Remove the secret from the ticket or conversation where possible. If it was committed, remember that editing the latest file doesn't remove older commits. [GitHub's sensitive-data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) starts with revocation or rotation and explains the limitations of rewriting repository history.

Coordinate any history rewrite with repository maintainers. Clones, forks, exports, and notifications may retain copies. That is why invalidating the key matters more than making the visible copy disappear.

## Make the next handoff smaller

Use placeholders in examples and issue keys with only the permissions needed. Store application credentials outside source files. For a manual handoff, an [encrypted one-time link](/share-api-keys) can reduce how long the secret remains retrievable from your message history.

It cannot repair an earlier leak or revoke a working key. Rotate first, then share the replacement carefully if someone genuinely needs it.
