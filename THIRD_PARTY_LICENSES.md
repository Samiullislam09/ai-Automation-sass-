# Third-party code and permissions

This file records every external repository whose code, structure or ideas are used in
MrLxwa beyond an ordinary npm/pip dependency, and on what terms. Add a section before
copying anything in; a repo that is not listed here is not cleared for use.

## kaymen99/sales-outreach-automation-langgraph — Mr. Lead skeleton

- **Repository:** https://github.com/kaymen99/sales-outreach-automation-langgraph
- **Used for:** the LangGraph structure of the Leads agent (research → qualify → personalise →
  draft outreach), as described in the rebuild plan §17 and §20.
- **Permission:** explicit permission from the author, obtained by Samiul Islam (musab@cgheven.com)
  on 2026-08-27.
- **Proof:** <!-- TODO (Samiul): paste the author's message / link to the issue, DM or email, with date -->
- **Scope granted:** <!-- TODO (Samiul): e.g. "use, modify and deploy commercially in MrLxwa"; anything the author excluded -->
- **Attribution required:** <!-- TODO (Samiul): yes/no, and the exact wording if the author asked for one -->
- **Local changes:** none yet (Phase 1 fork will live in its own `mrlxwa-agent-leads` repo).

## Postiz (gitroomhq/postiz-app) — Mr. Social scheduling backend

- **Repository:** https://github.com/gitroomhq/postiz-app
- **License:** AGPL-3.0.
- **How it is used:** run **unmodified**, as a separate service, called over its public API.
  No Postiz source is copied into this repo. That keeps our own code outside AGPL's reach;
  if we ever modify Postiz, the modified fork must itself be published under AGPL.

## Other repos referenced by the plan (not yet copied)

| Repo | License | Planned use | Status |
|---|---|---|---|
| assafelovic/gpt-researcher | Apache-2.0 | Mr. Research / Writer research step | dependency, no copy |
| langchain-ai/social-media-agent | MIT | Mr. Social flow (pattern only) | pattern only |
| AI-Powered open-seo clustering / SerpBear | MIT | Mr. Keyword clustering + rank tracking | pattern / dependency |
| unlighthouse | MIT | Mr. Audit page scans | dependency |
| mendableai/fire-enrich | MIT | Mr. Lead enrichment pattern | pattern only |

When one of these moves from "pattern" to copied code, add a full section above with the
license text location and the commit it was taken from.
