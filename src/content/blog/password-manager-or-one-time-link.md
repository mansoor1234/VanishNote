---
title: "Password manager or one-time link: which should you use?"
seoTitle: "Password manager or one-time link?"
description: "Use a shared vault for ongoing access and a one-time link for a temporary handoff. Learn where each fits, and why neither replaces access control."
published: 2026-11-15T09:00:00+05:00
cover: /blog-images/password-manager-or-one-time-link.webp
coverAlt: "An indigo vault beside a translucent chain link dissolving into lilac cubes."
updated: 2026-11-17T00:00:00+05:00
---

> **At a glance:** Use a managed vault for ongoing access and a one-read note for a temporary handoff. Neither can revoke a password someone has already saved.

A colleague needs a login. Should you put it in a shared password vault, or send a link that disappears after reading?

Both can be useful. The deciding question is how long the other person needs access, and whether you expect to manage that access again.

## Use separate accounts when you can

Before sharing a password, look for an invitation button. A separate account lets each person use their own sign-in and authentication methods. You can remove one person's access without changing a shared password for everybody.

This is particularly useful for client projects, hosting dashboards, and business software. Check the role you assign: someone reviewing a page probably doesn't need permission to manage billing or delete the project.

## A shared vault fits an ongoing relationship

If a service only supports one login and several colleagues need it regularly, a password manager with sharing controls can keep that credential in one managed place. Check how your chosen manager handles membership, recovery, and updates to shared items.

[NIST's password guidance](https://www.nist.gov/cybersecurity-and-privacy/how-do-i-create-good-password) discusses password managers and recommends protecting the manager with multifactor authentication. A vault deserves particular care because it holds access to other accounts.

Removing someone from a vault prevents future retrieval through that vault. It cannot make them forget a password they already saw or saved. If they must lose access to the underlying service, change the shared credential too.

## A one-time link fits a single handoff

A temporary staging login, an initial password for a new client, or a credential needed during one support session doesn't always belong in a permanent shared vault.

An encrypted one-time link lets you hand over that secret without leaving its text in the conversation. With [Vanishnote](/one-time-secret-link), the note is encrypted in your browser and the stored content is destroyed after the final permitted reveal or becomes unavailable at expiry.

Choose one read and a short expiry for a simple handoff. For sensitive access, protect the note with an additional password and share that password through a separate channel.

## What a disappearing link cannot do

A recipient can save the revealed password. Destroying the note doesn't revoke their account, change the credential, or remove copies from their device. Anyone with the complete unprotected link can attempt to reveal it before your intended recipient does.

Treat the note as a delivery method. Use the original service's account settings to control permissions and end access.

## A practical choice

- **Daily team access:** separate accounts where possible; a managed shared vault when necessary.
- **A single temporary handoff:** an encrypted one-time note with a short expiry.
- **A person leaving a project:** remove their account or rotate shared credentials, regardless of how you originally shared them.

For a client-specific routine, see [how to send a password to a client safely](/blog/how-to-send-a-password-to-a-client). If you only need to make one handoff today, [create a note](/send-password-securely).
