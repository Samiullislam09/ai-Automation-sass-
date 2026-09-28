---
title: MrLxwa Agent Server
emoji: 🧠
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# agent-server

The background worker behind MrLxwa: the agent queues (pg-boss), the scheduler, the brain
orchestrator and the Socket.IO event stream. The Next.js app on Vercel talks to it over HTTP with
an `x-agent-token` header; nothing here is meant to be opened in a browser.

**The YAML header above is not decoration.** A Hugging Face Space with no `sdk:` line does not
build at all, and `app_port` has to match the `PORT` the Dockerfile sets, or every request to the
Space times out against a server listening on the wrong port.

## Deploying

This directory is the root of the Space. From the repository root:

```bash
git remote add hf https://huggingface.co/spaces/<user>/<space>
git subtree push --prefix=agent-server hf main
```

Push asks for a username and a password: the password is a Hugging Face **access token with
write permission** (Settings -> Access Tokens), not the account password.

## Configuration

Every variable in `.env.example` has to exist in the Space's **Settings -> Repository secrets**.
Nothing is read from a file in the image — `.dockerignore` keeps `.env` out of it on purpose,
because a Space's build layers are downloadable and a public one would hand them to anyone.

`DATABASE_URL` must be the Supabase **pooler** connection string, and Supabase's own note about
TLS applies here as it did on Railway: the `rediss://`-style requirement is written up in
`docs/` alongside the other deploy gotchas.

## Staying awake

A free Space sleeps after 48 hours without a request. That would stop the scheduler, so something
has to knock on it: point any free cron service (cron-job.org and friends) at

```
GET https://<user>-<space>.hf.space/health
```

every ten minutes. The route is defined in `src/index.ts` and returns `ok`.

## What is different from Railway

The container is described by `Dockerfile` here rather than by `nixpacks.toml`. Both install the
same three things for the same reasons — Chromium for Lighthouse, a Python venv for
gpt-researcher, Node 22 — and `nixpacks.toml` is kept in the repository because its comments
record why each one is needed.

The disk is **ephemeral**: a Space restart or rebuild wipes it. That is survivable only because
no state lives here — everything is in Supabase — so nothing in this server should ever start
writing files it expects to find later. `/tmp` is writable for scratch work.
