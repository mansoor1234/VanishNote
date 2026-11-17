---
title: "AI is changing hacking. Your old secrets are the easy target"
seoTitle: "How AI is changing hacking in 2026"
description: "AI can speed up credential theft. What published research says about passwords and API keys left in messages, and practical ways to reduce exposure."
published: 2026-11-03
cover: /blog-images/how-ai-is-changing-hacking.webp
coverAlt: "A frosted neural-network sphere illuminating archived messages and a forgotten key."
updated: 2026-11-17T00:00:00+05:00
---

> **At a glance:** AI can help search material an attacker already has access to. Reduce what they can find by keeping working credentials out of old messages and source files.

Reading stolen documents, identifying useful accounts, and sorting old messages can take time. AI tools can assist with that work, making credentials left in an accessible archive more useful to an attacker.

That doesn't mean every attack is autonomous or every small business will be individually targeted. It gives us another reason to stop treating message history as a safe place to leave working secrets.

## What happened in 2025

In November 2025, [Anthropic reported an AI-assisted espionage campaign](https://www.anthropic.com/news/disrupting-AI-espionage) against roughly thirty organisations. The company estimated that AI handled 80–90% of that campaign, including reconnaissance and credential harvesting, with people directing key decisions. It also reported mistakes, including invented credentials.

Those findings concern one investigated campaign. They do not establish how much of every cyberattack is automated or prove that a model's claimed discoveries are reliable.

The practical concern is that automated assistance can make parts of a credential-hunting workflow faster, even when people still direct the attack.

## Why this matters if you're not a target

You don't need to predict whether your company will face a sophisticated campaign to improve how it handles passwords. Credentials copied into a ticket, repository, or archived conversation create another place where access can escape its original purpose.

Once an attacker can read that material, automated search may help identify candidate keys or connection strings. The benefit of removing those secrets doesn't depend on whether the search is performed by a person, a script, or an AI tool.

## Old credentials can still open current accounts

Encryption doesn't help if an attacker obtains a working credential from somewhere it was legitimately readable. Keeping secrets out of source files and long-lived conversations reduces that exposure.

GitGuardian's [State of Secrets Sprawl 2026](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/) describes findings from its research, including:

- **28.65 million** new secrets (passwords, API keys and tokens) pushed to public GitHub in 2025, up 34% in a year.
- **About 28%** of leak incidents happening entirely outside code, in tools like Slack, Jira and Confluence.
- **More than 64%** of secrets found back in 2022 still working when they were retested in January 2026.

That last number concerns the previously valid secrets in GitGuardian's retested dataset. It should not be treated as a statistic about every leaked password, but it shows why removing a message alone is insufficient.

For example, someone with access to an employee's archive could look for messages containing password labels or configuration snippets. Automated analysis may help sort those findings. Limiting access and invalidating exposed credentials addresses that risk regardless of the search method.

## AI coding tools leak secrets too

GitGuardian also observed more secret leaks in its sample of Claude Code-assisted commits than in its overall public-commit baseline, and found credentials in MCP configuration files.

That comparison doesn't establish that the assistant caused the leaks. GitGuardian notes that developers still control what is accepted and committed. The practical lesson is to review generated changes and keep real secrets out of prompts and examples.

## What to do about it

AI makes attackers faster, but it doesn't change what they're looking for. The fewer secrets you leave lying around, the less there is to find.

### 1. Assume your message history will be read one day

Treat chat, email and tickets as places that will eventually be searched by something that never gets bored. Don't leave working credentials there. When you need to share one, send a one-time link that's destroyed after it's opened, so your history keeps only a dead link. We wrote a short routine for this in [Stop pasting passwords into chat](/blog/stop-pasting-passwords-into-chat).

### 2. Clean up what's already there

Search your workspace for "password", "api key", "token", "secret" and ".env". Change anything you find that still works, then delete the message. Changing the secret is the step that matters: deleting a message leaves copies in backups, exports and other people's devices.

### 3. Keep real keys out of prompts and examples

Use placeholders when you ask an AI assistant for help. Keep keys in environment variables or a secrets manager, never in the code itself, and turn on secret scanning for your repositories. GitHub's push protection, for example, blocks commits that contain known key formats.

### 4. Make secrets expire

Prefer short-lived tokens and narrowly scoped keys where supported. Revoke or rotate a credential when it is exposed or temporary access ends. Confirm invalidation at the issuing service: deleting a note or changing a message doesn't make a working token expire.

### 5. Turn on two-factor sign-in everywhere

A harvested password is far less useful when it isn't enough on its own. Prefer passkeys or an authenticator app to SMS codes.

### 6. Put AI to work on your side

Anthropic's own advice to defenders is to try AI for threat detection, vulnerability checks and incident response. The same speed that helps attackers read a stolen inbox can help you scan your own systems for exposed secrets before anyone else does.

## A useful next step

Start with one project: check where its credentials live, who can retrieve them, and how access ends. Replace exposed values rather than only removing the visible messages.

The defence is unglamorous: fewer secrets in places that remember, and secrets that stop working soon after they're shared. If you need to send a password or an API key today, [Vanishnote](/) encrypts it in your browser and destroys it once it's been read. Our guide to [sharing API keys and .env files](/share-api-keys) covers the developer side.
