---
title: "How to share credentials with a contractor"
seoTitle: "Share credentials with a contractor safely"
description: "Give contractors limited, temporary access. Use separate accounts where possible, send unavoidable shared secrets carefully, and close access when work ends."
published: 2026-11-20T09:00:00+05:00
cover: /blog-images/share-credentials-with-contractors.webp
coverAlt: "A layered indigo access doorway with a mint keycard and a coral hourglass."
---

> **At a glance:** Define the task, grant limited access, and assign a removal date. A private handoff does not replace revoking the underlying account or token.

A contractor needs to fix a website, investigate a deployment, or review a report. Sending your main administrator password is quick, but it can leave them with more access than the job requires and no clear end date.

A better handoff defines what they can do, how long they can do it, and who will remove access afterwards.

## Start with the task

Write down the system and project the contractor needs. Does the work require editing, or would read-only access be sufficient? Can it happen in a test environment? Do they need to view personal information at all?

Use the service's invitation and role controls to create an individual account where possible. Keep recovery and billing ownership with the appropriate person in your organisation.

Don't send an employee's normal login just because it already has the necessary permissions. That makes it harder to distinguish activity and end one person's access cleanly.

## Make the access temporary

Set an expiry through the service when it supports one. Otherwise, record a removal date and assign someone to carry it out. A calendar reminder is more useful than assuming that everybody will remember after the project closes.

For API work, create a key scoped to the project and required operations. Avoid providing a master key when a narrower one will do.

## Share unavoidable secrets carefully

If a system requires a shared password, verify the recipient through your established conversation before sending it. An unexpected request for access deserves a check through a known contact route.

An [encrypted one-time note](/send-password-securely) can deliver a temporary credential without keeping its readable value in the project thread. Choose a short expiry and one read for one recipient. For sensitive access, use a separate note password and share that password through another channel.

Agree that the contractor will store it in their approved password manager rather than copying it into tickets or work notes. The delivery method cannot control what they do after revealing it.

## Keep the handoff record free of secrets

Record the contractor, project, account identifier, permission level, approver, and removal date. Don't record the password or full secret link in an access spreadsheet.

In Vanishnote, note content is encrypted, but account note titles and password hints are readable metadata. Use a neutral title rather than putting a credential into those fields.

## Close access when the work ends

Remove the contractor's account, revoke project tokens, and change shared credentials as appropriate. Check automated jobs they created so a useful integration doesn't silently depend on a personal account that is about to disappear.

Ask for the agreed handling of local project files and document completion. Removing a note doesn't remove saved copies, and removing access to a password vault doesn't change a password someone already learned.

For an ongoing team relationship, see [password managers versus one-time links](/blog/password-manager-or-one-time-link). For a client ownership transfer, use the [client handoff checklist](/blog/how-to-send-a-password-to-a-client).
