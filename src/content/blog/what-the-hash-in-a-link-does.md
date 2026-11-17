---
# Quoted: an unquoted " # " starts a YAML comment and cut this title to "What the".
title: 'What the # in a link does, and why secret notes rely on it'
seoTitle: 'What the # in a link does for secret notes'
description: "URL fragments stay out of page requests. Learn how a key after # protects a note, and why the full link still needs careful handling."
published: 2026-10-06
cover: /blog-images/what-the-hash-in-a-link-does.webp
coverAlt: "An indigo ribbon splitting at a glass hash symbol toward a server and a browser-held key."
updated: 2026-11-17T00:00:00+05:00
---

> **At a glance:** The part after # is excluded from the page request, but remains part of the shareable link. Anyone with that full link may have the decryption key.

Look closely at a Vanishnote link and you'll see two parts separated by a `#`:

```
https://vanishnote.net/n/3q2-7wLk0aZb1xYcPn8T4g#Vx4…long-random-string…
```

The part before the `#` identifies the note. The part after it is the decryption key. That split is the reason we can deliver your note without ever being able to read it.

## Fragments stay in the browser

The bit after `#` is called the **fragment**. It was designed for jumping to a section of a page, like `#pricing`, and browsers handle it locally. When your browser requests a page, it sends the server the path, `/n/3q2-7wLk0aZb1xYcPn8T4g`, and keeps the fragment to itself.

That isn't a setting or a promise from us. It's how HTTP works in every major browser. You can see it in your browser's developer tools: open the Network tab, load any URL with a `#`, and the request line won't include it.

## How a secret note uses that

1. Your browser creates a random key and encrypts the note with it.
2. It uploads only the encrypted data. The server stores it and replies with an ID.
3. Your browser builds the link: the ID goes in the path, and the key goes in the fragment.
4. When your recipient opens the link, their browser asks the server for the encrypted note by ID, without sending the key, and decrypts it locally using the key from the fragment.

When you copy and share a note link yourself, the recipient's browser uses that fragment to decrypt the content locally. The note-storage service receives ciphertext rather than the decryption key.

There is a separate account feature for emailing password-protected note links. If you choose it, our server briefly handles the full link to build the email. The note's separate password must still be shared another way. That exception is why a URL fragment should not be described as something that can never leave a browser.

## What could still leak the fragment?

Fragments are private by default, but not magic. A few things deserve attention:

- **Referrer headers.** When you click a link from a page, the browser may tell the next site where you came from. Modern browsers strip fragments from referrers, and Vanishnote also sets `Referrer-Policy: no-referrer`, so nothing is shared.
- **Scripts on the page.** JavaScript running on a page can read the fragment. That's why Vanishnote's note pages load no third-party scripts: no analytics, no ads, no embedded widgets. Only our own code runs there.
- **Wherever the link itself goes.** The fragment is part of the link, so anyone who sees the full link has the key. That's why a password, sent through a different channel, is a useful second lock.
- **Browser history and extensions.** A full link can be retained in history, synchronised to another device, or seen by an extension with sufficient access. Avoid pasting it into public link checkers or support screenshots.

## Why not just send the key separately?

You can add a separate note password and give it to the recipient through another channel. The recipient then needs both the complete link and that password. For an ordinary copied link, the fragment makes the one-link workflow convenient while keeping the key out of the request to retrieve the note.

The best way to protect data on a server is never to send it there.
