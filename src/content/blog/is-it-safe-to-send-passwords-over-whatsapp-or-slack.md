---
title: "Is it safe to send passwords over WhatsApp, Slack or email?"
seoTitle: "Safe to send passwords over WhatsApp or Slack?"
description: "Encryption isn't the real problem with sending passwords in chat. How long the message stays is. App-by-app answers, and a safer way to share a password."
published: 2026-11-04
---

Short answer: it's safer than shouting it across the office, and much less safe than it feels.

Most people ask the question with encryption in mind. "WhatsApp is end-to-end encrypted, so it's fine, right?" Encryption protects the message while it travels. The bigger risk is what happens afterwards, when the password sits in a chat for months or years, on several devices, in backups, and in an account somebody might one day get into.

## What encryption does and doesn't protect

End-to-end encryption means nobody between you and the recipient, not even the app's company, can read the message on its way. That's worth having.

It does nothing about:

- **The copy on each phone and computer.** The password stays readable in the chat until someone deletes it, and most people never do.
- **Backups.** Chat history is often backed up to a cloud account, sometimes without the same protection.
- **Account takeovers.** Anyone who gets into either person's account, or picks up their unlocked phone, can scroll back and find it.
- **The recipient.** They can forward it, screenshot it, or paste it somewhere else.
- **Search.** Type "password" into any chat app and see how quickly old ones turn up.

Attackers rarely break encryption. They log in as you and search.

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

Messages are end-to-end encrypted, but your chat history isn't the only copy. Backups to Google Drive or iCloud are only end-to-end encrypted if you [turn on encrypted backups](https://faq.whatsapp.com/490592613091019), which is off by default. WhatsApp Web and other linked devices keep their own copies too. Disappearing messages help, but only if they were switched on before you sent the password, and the recipient can still copy it before it goes.

### Slack

Slack encrypts messages in transit and on its servers, but it doesn't offer end-to-end encryption, so the message is readable on Slack's side. On paid plans, Slack keeps everything forever unless the workspace sets a retention period, and depending on the plan, owners can export messages. On the [free plan](https://slack.com/help/articles/27204752526611), you can only see the last 90 days, but messages are kept for up to a year. Either way, the password is searchable by anyone who gets into the account.

### Microsoft Teams

Teams chats are kept and searchable under your organisation's retention and compliance settings. Teams [can encrypt the audio and video](https://learn.microsoft.com/en-us/microsoftteams/teams-end-to-end-encryption) of one-to-one calls and some meetings end to end, if your admins allow it, but not chat messages.

### Email

Email is the worst of the common options. A copy lands in both mailboxes, often in backups and archives too, and it's forwarded, synced and searched for years. Email accounts are also among the most frequently taken over, because one mailbox resets the password for everything else.

### Signal

Signal is the best of the chat apps for this: end-to-end encrypted by default, with disappearing messages you can set per chat. If you must send a password in a message, a Signal chat with a short disappearing-message timer is a reasonable choice. The recipient still sees it in plain text and can copy it, and you won't know if anyone else did.

## So is it ever OK?

For something low-stakes, like the guest Wi-Fi password, sending it in chat is fine. For anything that unlocks money, customer data, email or production systems, treat a password in a chat as one you'll eventually need to change.

The question to ask isn't "is this app encrypted?" but "where will this password still be in a year, and who could read it there?"

## A safer way to share a password

1. **Send a one-time link instead of the password.** Put the password in a self-destructing note. The link opens once, the note is destroyed, and your chat history keeps only a dead link. With [Vanishnote](/send-password-securely), the note is encrypted in your browser, so we can't read it either.
2. **Send the context separately.** "Admin login for the billing server" plus a password in the same message is a gift to whoever finds it. Send the link without a label, or mention what it's for elsewhere.
3. **Use a second channel for important ones.** Protect the note with its own password and give that password over a call, or by text if the link went by email. Someone would then need access to two separate channels.
4. **Watch for the warning.** If the recipient opens the link and is told it's already been read, someone else got there first. Change the password straight away.
5. **Change temporary passwords afterwards.** When a contractor or support agent no longer needs access, change the password. One that no longer works can't hurt you.

If a whole team needs the same login every day, a one-time link isn't the right tool. Use a password manager's shared vault, so access can be granted and removed without passing the password around at all.

## Already sent one?

Don't panic, and don't just delete the message: copies stay in backups and on the other person's devices. Change the password, then delete the old message, so the copy everyone else has stops working. For a longer routine, see [Stop pasting passwords into chat](/blog/stop-pasting-passwords-into-chat). For why old passwords have become an easy target for AI tools, see [AI is changing hacking](/blog/how-ai-is-changing-hacking).
