---
title: "Is it safe to send passwords over WhatsApp, Slack or email?"
seoTitle: "Safe to send passwords over WhatsApp or Slack?"
description: "Encryption isn't the real problem with sending passwords in chat. How long the message stays is. App-by-app answers, and a safer way to share a password."
published: 2026-11-04
cover: /blog-images/is-it-safe-to-send-passwords-over-whatsapp-or-slack.webp
coverAlt: "Translucent chat bubbles and connected devices surrounding a coral key and a sealed message."
updated: 2026-11-17T00:00:00+05:00
---

> **At a glance:** Encryption protects delivery, but copies can persist on devices and in archives. Choose the handoff method for the access being granted, not only the chat app.

For a sensitive login, use an account invitation, an approved shared vault, or an encrypted temporary handoff. Chat encryption helps protect delivery, but it doesn't decide how long a working password stays accessible afterwards.

Most people ask the question with encryption in mind. "WhatsApp is end-to-end encrypted, so it's fine, right?" Encryption protects the message while it travels. The bigger risk is what happens afterwards, when the password sits in a chat for months or years, on several devices, in backups, and in an account somebody might one day get into.

## What encryption does and doesn't protect

End-to-end encryption means nobody between you and the recipient, not even the app's company, can read the message on its way. That's worth having.

It does nothing about:

- **The copy on each phone and computer.** The password stays readable in the chat until someone deletes it, and most people never do.
- **Backups.** Chat history is often backed up to a cloud account, sometimes without the same protection.
- **Account takeovers.** Anyone who gets into either person's account, or picks up their unlocked phone, can scroll back and find it.
- **The recipient.** They can forward it, screenshot it, or paste it somewhere else.
- **Search.** Type "password" into any chat app and see how quickly old ones turn up.

An attacker who gains access to a readable message history may not need to break encryption at all.

## App by app

| App | End-to-end encrypted? | How long the password stays | Who else could find it |
|---|---|---|---|
| WhatsApp | Yes | Until someone deletes it, plus cloud backups | Anyone with an unlocked phone or linked computer; backup accounts |
| Slack | No | On paid plans, forever unless your admins set a limit | Workspace admins through exports; anyone who takes over an account; connected apps |
| Microsoft Teams | No (some calls and meetings can be; chats aren't) | As long as your organisation's retention policy says | Compliance searches; anyone who takes over an account |
| Email | Usually not | Indefinitely, in both mailboxes and their backups | Mail providers; anyone with access to either mailbox; whoever it's forwarded to |
| Plain SMS | No | On both phones until deleted | The phone network; phone backups |
| Signal | Yes | Until a disappearing-message timer runs out, if you set one | Anyone with the unlocked phone before then |

### WhatsApp

Personal messages are end-to-end encrypted, but check your actual backup settings and linked devices. WhatsApp's [backup documentation](https://faq.whatsapp.com/490592613091019) distinguishes backup providers and explains the available end-to-end encryption settings; don't assume every backup has the same protection. Disappearing messages reduce retained history when enabled for the message, but the recipient can still save its contents.

### Slack

Slack messages are not end-to-end encrypted. Retention and export access depend on the workspace's plan, settings, and permissions. Slack's [retention documentation](https://slack.com/help/articles/203457187-Customize-data-retention-in-Slack) explains that free workspaces can retain data for 90 days or one year, while paid workspaces can configure retention. A visible-history limit is not the same thing as a promise that all copies have disappeared.

### Microsoft Teams

Teams chats are kept and searchable under your organisation's retention and compliance settings. Teams [can encrypt the audio and video](https://learn.microsoft.com/en-us/microsoftteams/teams-end-to-end-encryption) of one-to-one calls and some meetings end to end, if your admins allow it, but not chat messages.

### Email

Ordinary email can leave copies in both mailboxes, archives, connected clients, and forwarded threads. Transport encryption does not usually make a message end-to-end encrypted. Check your organisation's approved sharing method rather than assuming that deleting a sent message removes the recipient's copy.

### Signal

Signal provides end-to-end encryption and optional disappearing-message timers. Its [own guidance](https://support.signal.org/hc/en-us/articles/360007320771-Set-and-manage-disappearing-messages) makes the limit clear: a recipient can photograph or otherwise save a disappearing message. Use the approved method for your workplace and treat temporary delivery separately from revoking the underlying credential.

## So is it ever OK?

For something low-stakes, like the guest Wi-Fi password, sending it in chat is fine. For anything that unlocks money, customer data, email or production systems, treat a password in a chat as one you'll eventually need to change.

The question to ask isn't "is this app encrypted?" but "where will this password still be in a year, and who could read it there?"

## A safer way to share a password

1. **Send a one-time link instead of the password.** Put the password in a self-destructing note. The link opens once, the note is destroyed, and your chat history keeps only a dead link. With [Vanishnote](/send-password-securely), the note is encrypted in your browser, so we can't read it either.
2. **Send the context separately.** "Admin login for the billing server" plus a password in the same message is a gift to whoever finds it. Send the link without a label, or mention what it's for elsewhere.
3. **Use a second channel for important ones.** Protect the note with its own password and give that password over a call, or by text if the link went by email. Someone would then need access to two separate channels.
4. **Check an unavailable note.** It may have expired, been destroyed, or already been revealed. If you cannot account for what happened, change the credential before sending another note.
5. **Change temporary passwords afterwards.** When a contractor or support agent no longer needs access, change the password. One that no longer works can't hurt you.

If a whole team needs the same login every day, prefer separate accounts or an approved shared vault. Removing someone from a vault stops future retrieval through it; change the shared password too if they must lose access to the original service.

## Already sent one?

Don't panic, and don't just delete the message: copies stay in backups and on the other person's devices. Change the password, then delete the old message, so the copy everyone else has stops working. For a longer routine, see [Stop pasting passwords into chat](/blog/stop-pasting-passwords-into-chat). For why old passwords have become an easy target for AI tools, see [AI is changing hacking](/blog/how-ai-is-changing-hacking).
