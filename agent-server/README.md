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

The YAML header above is only meaningful to Hugging Face Spaces, which was evaluated as a
Railway replacement and dropped (Docker Spaces need a PRO subscription as of 2026-09-28). It is
harmless everywhere else and kept so the move is a one-step one if it ever happens.

## Deploying

Railway builds this directory with `Dockerfile` (service Root Directory is `agent-server`, with
**no leading slash** — `/agent-server` is read as an absolute container path and fails with
"Failed to read app source directory"). A Dockerfile in the root directory takes precedence over
whatever builder `railway.json` names, which is why that file now says `DOCKERFILE` out loud.

The same image runs anywhere else that takes a Dockerfile — `docker build -t agent-server .` and
a `--env-file` is the whole story on a VM.

## Configuration

Every variable in `.env.example` has to exist in the Space's **Settings -> Repository secrets**.
Nothing is read from a file in the image — `.dockerignore` keeps `.env` out of it on purpose,
because a Space's build layers are downloadable and a public one would hand them to anyone.

`DATABASE_URL` must be the Supabase **pooler** connection string, and Supabase's own note about
TLS applies here as it did on Railway: the `rediss://`-style requirement is written up in
`docs/` alongside the other deploy gotchas.

## Health

`GET /health` returns `ok` and `GET /version` reports the running commit, uptime, which agents
registered and whether the brain came up — the fastest way to tell a live deploy from a stale one
after a push. Both are defined in `src/index.ts`.

Railway does not idle this service out, so nothing has to ping it. A host that does sleep idle
containers is not usable here at all: the scheduler ticks once a minute and pg-boss holds a
Postgres LISTEN/NOTIFY connection, so a sleeping container is a stopped product, not a slow one.

## Why a Dockerfile and not nixpacks.toml

`nixpacks.toml` built this service on Railway until 2026-09-28 and is kept because its comments
are the record of *why* each piece is needed. The Dockerfile installs the same three things for
the same reasons — Chromium for Lighthouse, a Python venv for gpt-researcher, Node 22 — and is
portable to any host that takes a container, which nixpacks.toml is not.

The disk is **ephemeral** on most of these hosts: a restart or rebuild wipes it. That is
survivable only because no state lives here — everything is in Supabase — so nothing in this
server should start writing files it expects to find later. `/tmp` is writable for scratch work.
