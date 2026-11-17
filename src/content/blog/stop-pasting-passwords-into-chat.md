---
title: Stop pasting passwords into chat. Here's what to do instead
seoTitle: Stop pasting passwords into chat
description: Why passwords sent over chat and email outlive their purpose, and a simple routine for sharing credentials that don't stick around.
published: 2026-09-28
cover: /blog-images/stop-pasting-passwords-into-chat.webp
coverAlt: "A password message dissolving into lilac cubes beside a key sealed in a glass capsule."
updated: 2026-11-17T00:00:00+05:00
---

> **At a glance:** Send a temporary encrypted link instead of leaving the password in chat. Use a short expiry and change temporary credentials when access ends.

Somebody needs the Wi-Fi password, the staging database login, or the code for the side door. The quickest move is to paste it into whatever chat window is already open. Done in five seconds.

The trouble is that the message doesn't go away once it has done its job.

## Where a pasted password ends up

A credential sent through a normal chat or email doesn't live in one place. It lives in:

- **Both people's message history**, often synced to every device they own.
- **Server-side archives and backups**, sometimes kept for years for compliance.
- **Search indexes.** Type "password" into your workspace search and see what comes back.
- **Notification previews** on lock screens and smartwatches.
- **Exports and integrations**: bots, connected apps, and the archive someone downloads when they leave the company.

Each copy is another place an attacker might find it later. A well-encrypted message can still expose a working password if someone gains access to the device or account holding it.

## A better routine in four steps

### 1. Send the secret through something that forgets

Use an encrypted note set to one read and a short expiry. In Vanishnote, loading the link shows a reveal page; pressing the reveal button consumes the read. After that, the stored note is destroyed and the conversation keeps a link that cannot retrieve it again.

Anyone holding the complete unprotected link can attempt that reveal. A one-read setting limits retrieval; it does not identify the recipient or prevent them saving what they see.

### 2. Split the secret from its context

Don't send "here's the admin password for the billing server: …" in a single message. If the link travels by chat, mention what it's for in a different conversation, or not at all. A secret with no label is far less useful to whoever stumbles on it.

### 3. Add a password for anything important, and send it another way

For high-value secrets, protect the note with a password and share the password over a different channel: say it on a call, or send it by SMS if the link went by email. An attacker then needs access to two separate channels instead of one.

### 4. Rotate after sharing

If a credential is shared with someone temporarily, such as a contractor, a support session, or a one-off login, change it once they're done. The safest shared secret is one that has stopped working.

## What if the link was already opened?

An unavailable note may have expired, been destroyed by its sender, or used its final read. The error alone doesn't prove someone else opened it. Ordinary page-preview requests don't consume Vanishnote notes; a person or tool would need to perform the reveal action.

Check with the sender. If a working credential was in the note and you cannot account for its disappearance, change or revoke that credential before sharing a replacement. The [FAQ](/faq) explains note expiry and reveal behaviour.

## The five-second version

Next time someone asks for a password: write it into a self-destructing note, send the link, and, if it matters, send a password for the note separately. It takes about as long as pasting, and it doesn't leave a copy in your chat history.
