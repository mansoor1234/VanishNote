---
title: "How to send a password to a client safely"
seoTitle: "How to send a password to a client safely"
description: "A practical client handoff: choose limited access, share a password through an encrypted one-time link, and remove temporary access when the work is done."
published: 2026-11-14
---

You've finished a client's website, set up their hosting, or created an account for their new project. Now you need to hand over the login without leaving a working password in an email thread for years.

A useful routine is to create access specifically for the client, send any temporary password through an encrypted one-time link, and agree on what happens after they sign in. The link protects the handoff; the account settings control what happens afterwards.

## First, check whether you need to send a password

If the service offers invitations, use one. Your client can accept the invitation and set up their own sign-in without you knowing their password. Give them the role they need rather than sharing your own administrator account.

For a handoff of ownership, check the service's transfer process. Sending a password alone may leave the recovery email, billing account, or multifactor authentication tied to you.

If several people need continuing access to the same login, a shared password-manager vault may fit better than repeated one-time links. Separate accounts are preferable wherever the service supports them: you can remove one person's access without changing everyone else's login.

## When a temporary password is necessary

Some systems still require you to create an initial password. In that case:

1. **Create a unique password.** Don't reuse one from your agency, another client, or a test environment. You can use the [password generator](/password-generator) to create one in your browser.
2. **Limit the account's permissions.** Give access to the relevant project or site. Avoid access to unrelated client data.
3. **Require a password change at first sign-in**, if the service supports it. Otherwise, ask the client to change the temporary password once they've confirmed access.
4. **Set an end date for temporary access.** If the account is for a review or support task, arrange to disable it afterwards.

[CISA's password guidance](https://www.cisa.gov/sites/default/files/2024-09/Secure-Our-World-Passwords-Tip-Sheet.pdf) recommends long, random, unique passwords and a password manager. Those habits protect the account beyond the initial handoff.

## Send the temporary password through a one-time link

With [Vanishnote](/send-password-securely), you can do this without creating an account:

1. Enter the temporary password in a new note. Keep unrelated credentials out of it.
2. Choose a short expiry that gives the client enough time to open it. For a simple handoff, keep the note set to one read.
3. For sensitive access, add a separate note password and tell the client that password through another channel, such as a call.
4. Create the link and send the complete link to the intended client through your existing conversation.
5. Ask them to open it when they're ready to save the credential in their password manager and sign in.

The note is encrypted in your browser. The decryption key is in the link after the `#`, and that fragment isn't sent to our server when the page is requested. For more detail, see [what the hash in a link does](/blog/what-the-hash-in-a-link-does).

Opening the link shows a reveal page. It does not consume the note until someone presses the reveal button. After the final permitted reveal, the stored note is destroyed. An unread note also becomes unavailable when its expiry is reached.

Anyone with the full link can attempt to open it. A one-time link does not verify that the reader is your client, which is why checking the recipient and using a separate note password matter.

## A message you can adapt

Keep the login instructions clear, but leave the actual password out of the email or chat:

> Your project account is ready. I'll send the temporary password as a separate one-time link. Open it when you're ready to save it, then sign in and change the temporary password. Please confirm that you can access the project. If the note is unavailable, contact me so I can replace the temporary password and send a fresh link.

Give the client the service's correct sign-in address and their username through your established conversation. Avoid packing the service name, username, password, recovery codes, and billing details into one note.

Don't put a secret in an account note's title or password hint. Those fields are readable metadata, even though the note content is encrypted. A neutral title such as "Project handoff" is enough.

## If the client says the note is unavailable

An unavailable note may have expired, been destroyed, or already been revealed. That message alone cannot tell you which happened, or who opened it.

If you cannot account for what happened, change the temporary credential at the original service before sending a new note. Creating a new link containing the same password would leave any previously copied password working.

If the client simply missed the expiry, confirm that the account is still needed and replace the temporary password before trying again. Never ask them to send a screenshot containing a password as proof that they received it.

## Finish the account handoff

Once the client can sign in, check that:

- Their recovery email and phone details are correct.
- They have set up multifactor authentication where available, with recovery codes stored privately.
- Any ownership or billing transfer is complete.
- Temporary support accounts and permissions are removed when no longer needed.
- Your project documentation records who owns the account, without recording its password.

Destroying a note does **not** expire the password at the service it unlocks. It also cannot remove a copy the recipient saved, photographed, or pasted elsewhere. Changing or revoking the credential is what ends that access.

For your next client handoff, [create an encrypted note](/send-password-securely) and pair it with a clear plan for changing the temporary password. If you're handing over developer credentials, our [guide to sharing API keys and .env files](/share-api-keys) covers that workflow.
