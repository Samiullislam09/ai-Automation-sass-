# The Hugging Face Space image for agent-server — the replacement for nixpacks.toml, which
# described this same container to Railway. Read that file alongside this one: every apt package
# and env var below is here for a reason already written down there.
#
# WHY HUGGING FACE AT ALL. Railway's trial credit ran out (2026-09-27) and this server has to be
# awake all the time: it holds a Postgres LISTEN/NOTIFY connection for pg-boss and ticks the
# scheduler once a minute, so the "sleeps after 15 minutes idle" free tiers (Render, Koyeb) are
# not an option. A free HF Space on CPU basic is 2 vCPU / 16 GB RAM and does not sleep until 48
# hours without traffic, which an external ping keeps away.
#
# node:22 AND NOT python:3.11 (which is what a generic HF Docker guide will hand you): this is a
# TypeScript/Express/socket.io server that spawns Python for exactly one step. Node is the base;
# Python is a venv bolted on beside it, not the other way round.
FROM node:22-bookworm-slim

# chromium -> lib/audit/performance.ts runs real Lighthouse. Without a browser the audit still
#             works (the deterministic catalogue in lib/audit/checks.ts needs none) but the
#             performance pass reports itself as skipped.
# python3  -> src/lib/research/conduct_research.py, Mr. Writer's gpt-researcher step.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      python3 \
      python3-venv \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# chrome-launcher searches PATH by itself, so /usr/bin/chromium would be found anyway. CHROME_PATH
# is set regardless because performance.ts:98 reads it first, and an explicit path is one less
# thing to guess when an audit reports "no Chrome browser was found on this server".
ENV CHROME_PATH=/usr/bin/chromium

# Debian's python3 is PEP 668 "externally managed" exactly like the Nix one was, so pip cannot
# install into it — a venv is the only route. PYTHON_BIN is the variable gptResearcher.ts:11
# reads; pointing it at the venv's interpreter is what makes the research step work at RUNTIME,
# not just makes the build pass.
ENV PYTHON_BIN=/opt/venv/bin/python3
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir --upgrade pip

# HF Spaces runs the container as uid 1000. The node image ALREADY has a user at uid 1000 called
# `node`, so creating an `app` user here would fail with "UID 1000 already exists" — use the one
# that is there.
WORKDIR /app
RUN chown node:node /app

# package files first so a code-only change does not reinstall node_modules on every push.
COPY --chown=node:node package*.json ./
RUN npm ci

COPY --chown=node:node requirements.txt ./
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY --chown=node:node . .
RUN npm run build && npm prune --omit=dev

USER node

# env.ts:10 reads PORT and defaults to 4000; HF sends traffic to the port named by app_port in
# README.md, which is 7860. These two must agree.
ENV PORT=7860 \
    NODE_ENV=production
EXPOSE 7860

CMD ["npm", "run", "start"]
