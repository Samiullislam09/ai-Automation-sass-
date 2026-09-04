#!/usr/bin/env python3
"""Mr. Writer's research step (MASTER_PLAN #16.3 Upgrade E, #7.2's own words: "sirf
conduct_research(), write_report() nahi"). Runs gpt-researcher's OWN research crawl -- real
web search, real source fetching -- and prints ONLY the gathered context + source list as
JSON. It never calls write_report(): the actual prose still comes from writerPipeline.ts's
own outline/section/polish/meta calls, grounded in the tenant's Site Brain (WRITING_RULES
rule 4 -- never invent a stat, price, award or name). This step exists to make the OUTLINE
step's subtopic/question choices reflect what the open web actually discusses about a topic,
not to supply facts the article is allowed to state.

Invoked as a subprocess from agent-server/src/lib/research/gptResearcher.ts -- one Railway
service, no separate deploy unit (2026-08-28 "one service" decision): Python runs alongside
Node in the same container, via nixpacks.toml's python3 package + requirements.txt.

Protocol (stdin -> stdout, ONE JSON value per line, any number of lines):
  stdin:  {"topic": "..."}
  stdout: {"progress": <whatever gpt-researcher itself reported>}   -- zero or more, live
       or {"ok": true, "context": "...", "sources": [{"url": "...", "title": "..."}]}  -- always last
       or {"ok": false, "error": "..."}                                                -- always last

Never a stack trace to stdout -- every failure path here resolves to a normal {"ok": false}
line so the Node side can treat "research unavailable" as a skip, not a crash, the same
convention lib/audit/performance.ts uses for a missing Chrome binary.

LIVE PROGRESS (2026-08-31, MASTER_PLAN's "live Google-search visual" for the research step,
owner's own reference: a real search box + real result cards + real "reading" progress while
gpt-researcher works, not a fake animation). gpt-researcher's own reference server pushes
progress by calling a `websocket` object's `send`/`send_json` -- this file supplies one
(ProgressSink) that just prints each event as its own stdout line instead. UNVERIFIED against
a live install: this package could not be installed in the authoring environment to confirm
the exact method gpt-researcher==0.16.0 calls or the exact shape of what it sends (matches
this file's own long-standing note -- real verification only happens on Railway). So `run()`
below is deliberately defensive: if attaching the websocket raises ANYTHING, at construction
or during conduct_research() itself, it is caught and the whole research call is retried with
no websocket at all -- the exact call this file already made before progress events existed.
A broken guess at the progress API must never cost the article its research; at worst it costs
one retried research call and zero progress lines.
"""
import asyncio
import json
import sys


def emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


class ProgressSink:
    """Handed to GPTResearcher as `websocket=`. Whatever it reports, forwarded verbatim as its
    own stdout line -- this file does not parse or assume gpt-researcher's event shape, the
    Node/frontend side reads it defensively. Every method swallows its own errors so a bad
    progress line can never be the reason a real research result is lost; run()'s own retry
    (see module docstring) is the backstop for everything an in-method try/except can't catch
    (e.g. gpt-researcher awaiting this in a way that raises before entering the method body)."""

    def send(self, data) -> None:
        try:
            emit({"progress": data})
        except Exception:
            pass

    async def send_json(self, data) -> None:
        self.send(data)


async def run(topic: str) -> dict:
    from gpt_researcher import GPTResearcher  # imported here so a missing package still

    try:
        researcher = GPTResearcher(query=topic, report_type="research_report", report_source="web", websocket=ProgressSink())
        await researcher.conduct_research()
    except Exception as e:
        emit({"progress": {"note": f"live progress unavailable this run ({type(e).__name__}) -- continuing without it"}})
        researcher = GPTResearcher(query=topic, report_type="research_report", report_source="web")
        await researcher.conduct_research()

    context = ""
    if hasattr(researcher, "get_research_context"):
        context = researcher.get_research_context()
    elif hasattr(researcher, "context"):
        context = researcher.context
    if isinstance(context, list):
        context = "\n\n".join(str(c) for c in context)

    raw_sources = []
    if hasattr(researcher, "get_research_sources"):
        raw_sources = researcher.get_research_sources() or []
    elif hasattr(researcher, "research_sources"):
        raw_sources = researcher.research_sources or []

    sources = []
    for s in raw_sources[:10]:
        if isinstance(s, dict):
            sources.append({"url": str(s.get("url", "")), "title": str(s.get("title", ""))})
        elif s:
            sources.append({"url": str(s), "title": ""})

    # Capped: this only ever feeds one prompt (buildOutline), not stored, not shown to a user
    # verbatim -- no reason to carry more than a prompt needs.
    return {"ok": True, "context": str(context)[:6000], "sources": sources}


def main() -> None:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        topic = str(data.get("topic", "")).strip()
        if not topic:
            emit({"ok": False, "error": "no topic given"})
            return
        result = asyncio.run(run(topic))
        emit(result)
    except Exception as e:  # noqa: BLE001 -- this process's only contract is "never crash silently"
        emit({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
