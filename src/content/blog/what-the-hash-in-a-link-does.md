---
title: What the # in a link does, and why secret notes rely on it
description: URL fragments never leave your browser. Here's how that small detail lets a service deliver a secret it cannot read itself.
published: 2026-10-06
---

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

The key travels from your browser to your recipient's browser inside the link itself. Our servers only ever see the locked box.

## What could still leak the fragment?

Fragments are private by default, but not magic. A few things deserve attention:

- **Referrer headers.** When you click a link from a page, the browser may tell the next site where you came from. Modern browsers strip fragments from referrers, and Vanishnote also sets `Referrer-Policy: no-referrer`, so nothing is shared.
- **Scripts on the page.** JavaScript running on a page can read the fragment. That's why Vanishnote loads no third-party scripts: no analytics, no ads, no embedded widgets. Only our own code runs.
- **Wherever the link itself goes.** The fragment is part of the link, so anyone who sees the full link has the key. That's why a password, sent through a different channel, is a useful second lock.

## Why not just send the key separately?

You could, and a password-protected note effectively does that. But for everyday use, a single link that works on its own is far easier, and the fragment keeps the key away from the one party that never needs it: us.

The best way to protect data on a server is never to send it there.
