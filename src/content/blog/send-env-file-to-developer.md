---
title: "How to send a .env file to another developer safely"
seoTitle: "How to share a .env file safely"
description: "Separate a .env template from real credentials, limit developer access, and use an encrypted handoff when a teammate needs actual configuration secrets."
published: 2026-11-18T09:00:00+05:00
---

"Can you send me your .env?" is a common onboarding request. A working local configuration can contain database passwords, email tokens, signing keys, and access to systems that have nothing to do with the new developer's task.

The useful response is to separate the configuration structure from the credentials inside it.

## Commit an example, not the working secrets

A checked-in `.env.example` can show variable names and harmless placeholders:

```text
DATABASE_URL=replace-with-your-development-database-url
MAIL_API_KEY=replace-with-your-test-key
APP_URL=http://localhost:3000
```

Document what each variable is for and where an authorised developer should obtain its value. Use clearly artificial examples. A real-looking key copied from your own environment can become a real leak.

Keep the working `.env` out of version control. An ignore rule helps prevent future accidental additions, but it does not remove a file that is already tracked or erase previous commits. If real secrets were committed, follow a rotation and cleanup process.

## Give each developer only what they need

Prefer individual access to your team's secrets manager or development resources. Use separate development credentials instead of handing out the production configuration by default.

Before sharing, review every line. Does the recipient need billing access, a production database, or your personal API token? Remove unrelated values and create scoped credentials where the provider supports them.

## When a manual transfer is necessary

For a small set of values, paste the required configuration into an [encrypted note](/share-api-keys). Choose a short expiry and one read for a single handoff. For sensitive values, add a note password and provide that password through another channel.

Vanishnote account notes also support encrypted attachments within the plan's file-size limit. If you attach a configuration file, give it a neutral filename and keep secrets out of the note title and password hint. The title and hint are readable metadata.

Ask the developer to open the note when they are ready to store the values in their approved local setup. Avoid pasting the revealed contents back into the onboarding ticket to confirm receipt.

## Protect the copies after delivery

An encrypted transfer doesn't secure the destination automatically. Check file permissions, avoid synchronising secrets into an unintended folder, and keep configuration values out of terminal recordings, screenshots, and debugging output.

When the developer leaves the project, revoke their individual access. If they received a shared credential, change it where necessary. Destroying the delivery note does not invalidate that credential.

If a working key was already shared publicly, start with [what to do after accidentally sharing an API key](/blog/accidentally-shared-an-api-key). Sending the same key through a safer channel afterwards doesn't undo the first exposure.
