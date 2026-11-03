---
title: "AI is changing hacking. Your old secrets are the easy target"
seoTitle: "How AI is changing hacking in 2026"
description: "AI agents now do most of the work in some real cyberattacks. What that means for passwords and API keys left in chat, tickets and code, and how to clean up."
published: 2026-11-03
---

For most of the history of hacking, the slow part was people. Someone had to scan the network, read what came back, try logins, write an exploit and then dig through a stolen file share for anything useful. That took hours of skilled work, and skilled work is expensive. It's a big reason most small companies were never worth a serious attacker's time.

AI is removing that bottleneck.

## What happened in 2025

In November 2025, Anthropic published a report on what it called [the first reported AI-orchestrated cyber espionage campaign](https://www.anthropic.com/news/disrupting-AI-espionage). According to the report:

- A group Anthropic assessed as Chinese state-sponsored went after roughly 30 organisations, including tech companies, banks, chemical manufacturers and government agencies. It got in at a small number of them.
- The attackers split the job into small, harmless-looking tasks and told the AI it was doing defensive testing for a security firm, so it never saw the whole picture.
- The AI did an estimated 80–90% of the work. People stepped in at about four to six decision points per target.
- It mapped systems, found the most valuable databases, wrote and tested exploit code, **harvested usernames and passwords**, worked out which accounts had the most access, and catalogued what it took.
- At its peak it made thousands of requests, often several per second.

Some outside researchers have questioned how much the report proves, partly because it shared few technical details that defenders could check. Anthropic also notes the AI sometimes made things up, including credentials that didn't work. Fully hands-off attacks aren't here yet.

The direction is still clear. The slow, expensive parts of an attack are becoming fast and cheap.

## Why this matters if you're not a target

Small businesses have always relied on a defence nobody says out loud: being uninteresting. A 15-person agency or a local clinic wasn't worth weeks of an expert's time.

When an AI agent does the reconnaissance and the reading, the cost of looking at you drops close to zero. Attackers can afford to be thorough everywhere, and thoroughness is exactly what finds leftover secrets.

## The easiest way in is still a password someone left behind

New exploits get the headlines, but stolen credentials remain the most common way in. Verizon's [2025 Data Breach Investigations Report](https://www.verizon.com/business/resources/reports/dbir/) found that compromised credentials were the initial access vector in 22% of breaches, ahead of exploited vulnerabilities and phishing.

Where do attackers find them? GitGuardian's [State of Secrets Sprawl 2026](https://dev.to/gitguardian/the-state-of-secrets-sprawl-2026-ai-service-leaks-surge-81-and-29m-secrets-hit-public-github-2bgj) report counted:

- **28.65 million** new secrets (passwords, API keys and tokens) pushed to public GitHub in 2025, up 34% in a year.
- **About 28%** of leak incidents happening entirely outside code, in tools like Slack, Jira and Confluence.
- **1.27 million** leaked secrets for AI services alone, up 81%.
- **More than 64%** of secrets found back in 2022 still working when they were retested in January 2026.

That last number is the one to remember. Most leaked secrets are never changed. They just wait to be found.

Now picture an attacker who gets into one employee's chat or ticketing account. A person would skim a few channels and give up. An AI agent can read every message and attachment going back years, pull out anything that looks like a password, a key, a connection string or "here's the login for the client portal", and then try each one against every service it can reach. Searching someone's history used to be tedious. It no longer is.

## AI coding tools leak secrets too

There's a quieter change on the other side. GitGuardian found that public commits made with help from an AI coding assistant (it measured Claude Code) leaked secrets at a rate of 3.2%, against 1.5% for all public commits. It also found 24,008 secrets exposed in configuration files for MCP, the standard that connects AI assistants to other tools.

The pattern is familiar. Someone moving fast pastes a real key into a prompt or a config file, the assistant uses what it was given, and the key ends up committed. The tools are new; the mistake is old.

## What to do about it

AI makes attackers faster, but it doesn't change what they're looking for. The fewer secrets you leave lying around, the less there is to find.

### 1. Assume your message history will be read one day

Treat chat, email and tickets as places that will eventually be searched by something that never gets bored. Don't leave working credentials there. When you need to share one, send a one-time link that's destroyed after it's opened, so your history keeps only a dead link. We wrote a short routine for this in [Stop pasting passwords into chat](/blog/stop-pasting-passwords-into-chat).

### 2. Clean up what's already there

Search your workspace for "password", "api key", "token", "secret" and ".env". Change anything you find that still works, then delete the message. Changing the secret is the step that matters: deleting a message leaves copies in backups, exports and other people's devices.

### 3. Keep real keys out of prompts and examples

Use placeholders when you ask an AI assistant for help. Keep keys in environment variables or a secrets manager, never in the code itself, and turn on secret scanning for your repositories. GitHub's push protection, for example, blocks commits that contain known key formats.

### 4. Make secrets expire

Short-lived tokens, API keys limited to what they need, and regular rotation all mean that a key leaked last year is useless today. That 64% figure shows how rarely this happens in practice.

### 5. Turn on two-factor sign-in everywhere

A harvested password is far less useful when it isn't enough on its own. Prefer passkeys or an authenticator app to SMS codes.

### 6. Put AI to work on your side

Anthropic's own advice to defenders is to try AI for threat detection, vulnerability checks and incident response. The same speed that helps attackers read a stolen inbox can help you scan your own systems for exposed secrets before anyone else does.

## The short version

AI hasn't invented a new way to break into a company. It has made the oldest ways, like finding a password someone left behind and trying it everywhere, fast and cheap enough to use on everyone.

The defence is unglamorous: fewer secrets in places that remember, and secrets that stop working soon after they're shared. If you need to send a password or an API key today, [Vanishnote](/) encrypts it in your browser and destroys it once it's been read. Our guide to [sharing API keys and .env files](/share-api-keys) covers the developer side.
