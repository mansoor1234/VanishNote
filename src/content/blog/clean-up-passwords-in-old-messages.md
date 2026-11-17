---
title: "How to clean up passwords left in old messages"
seoTitle: "Clean up passwords in old messages"
description: "Clean up credentials in chats, email and tickets: inventory privately, replace working secrets, remove visible copies, and improve future handoffs."
published: 2026-11-21T09:00:00+05:00
cover: /blog-images/clean-up-passwords-in-old-messages.webp
coverAlt: "Archived message cards passing through a lilac sorting arch into tidy cubes."
---

> **At a glance:** Keep an inventory without copying secret values. Invalidate working credentials before removing the messages that contained them.

Search a long-running project conversation for "password" and you may find credentials nobody remembers sending. Some are obsolete. Others may still unlock a database or a client account.

A cleanup is worthwhile, but don't turn it into a new document containing every secret you discover. Track what needs fixing without collecting the secret values again.

## Keep the search within your authority

Review your own accounts and the workspaces you are authorised to administer. Follow your organisation's policies for retention, incident reporting, and access to other people's messages.

Search terms such as "password", "API key", "token", ".env", and "connection string" can help you find likely handoffs. Avoid copying results into an unapproved external tool or uploading a message archive just to make it easier to search.

## Make an inventory without the passwords

For each finding, record the affected service, owner, approximate sharing date, and whether action is needed. A ticket identifier can point an authorised owner to the source. Keep the actual password, API key, and full secret link out of your spreadsheet.

Prioritise credentials that can reach customer data, production systems, email, billing, or other accounts. If a secret appears publicly exposed or there are signs of misuse, follow your incident process immediately rather than waiting for the cleanup to finish.

## Invalidate working secrets before deleting messages

Ask the service owner to rotate the password or revoke the token. Coordinate updates to applications and integrations that use it. For a shared login, consider replacing it with individual accounts.

Then remove visible copies where policy permits. Deletion alone cannot invalidate a credential or reliably remove copies from exports, notifications, backups, and other people's devices.

Don't attempt to sign into accounts you aren't authorised to access just to test an old password. The account owner can assess and replace the credential through the service's normal controls.

## Check where the replacements will live

Store new passwords in an approved password manager and application keys in the appropriate secrets store. [NIST's password guidance](https://www.nist.gov/cybersecurity-and-privacy/how-do-i-create-good-password) recommends strong passwords and protecting password-manager access with multifactor authentication.

When someone needs a single manual handoff, send an [encrypted one-time note](/one-time-secret-link) rather than putting the replacement back into the same permanent conversation. For daily shared access, a managed vault or individual accounts usually fits better.

## Leave a safer routine behind

Document who owns each shared account and how access is granted and removed. Use placeholders in support tickets. Keep real secrets out of screenshots and debugging examples. Make temporary access expire where the underlying service supports it.

You don't need a promise that every old copy has vanished. The useful outcome is that old credentials no longer work and new ones have a controlled home. If your search turns up an exposed API key, follow the [API key cleanup steps](/blog/accidentally-shared-an-api-key) before sharing its replacement.
