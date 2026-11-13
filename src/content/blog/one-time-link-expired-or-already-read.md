---
title: "Why a one-time note says it is unavailable"
seoTitle: "Why your one-time note is unavailable"
description: "A note may be expired, destroyed or already revealed. Learn why the error stays vague, what to check, and when to replace the credential before sharing again."
published: 2026-11-19T09:00:00+05:00
---

You're expecting a password, open the link, and see that the note doesn't exist or has already been read. It is frustrating, especially when you haven't seen its contents.

That message is deliberately broad. In Vanishnote, it doesn't establish who opened a note or even whether anyone opened it at all.

## Several situations produce the same message

A note may have reached its expiry time, used its final permitted read, or been destroyed by its sender. A mistyped or incomplete note address can also fail.

Vanishnote gives unavailable notes the same error response rather than disclosing which of those cases applies. That avoids turning the lookup into a way to test whether a particular note existed.

Don't take the message alone as proof of interception. But if the note held a working credential and you cannot account for its disappearance, treat that credential cautiously.

## Opening the page isn't the same as revealing the note

Loading a Vanishnote link shows a reveal page. It does not consume the note merely because a chat service fetches the page to create a preview. Consumption happens through the reveal action.

That helps with ordinary preview bots. It does not guarantee that every automated tool or person handling a link will leave it untouched. A tool that performs the reveal action could consume a read.

## Check the full link privately

Ask the sender whether the note expired or was intentionally destroyed. Confirm that the complete link was copied, including everything after the `#` character.

The fragment contains the decryption key. If it is missing, the browser cannot decrypt the content. Don't paste a private link into a public support forum, a link checker, or a screenshot to troubleshoot it.

If you need help, describe the error without sharing the link or its contents.

## A wrong password is a different problem

For a password-protected note, Vanishnote retrieves the encrypted content when you reveal it and then tries to decrypt it locally. If the password is wrong, you can retry in the same open tab with the encrypted content already retrieved.

Keep that tab open while checking the password with the sender. Reloading a one-read note after it has been consumed can leave you unable to retrieve it again. The server cannot recover the plaintext or tell you the correct note password.

## When to send a replacement

For an expired appointment detail, the sender may simply create a new note. For a password or API key with unexplained access, change or revoke the credential at its original service before sharing a replacement.

A new note containing the same working password doesn't make a previously saved copy stop working. Our [client handoff guide](/blog/how-to-send-a-password-to-a-client) explains how to pair private delivery with changes to the underlying account.
