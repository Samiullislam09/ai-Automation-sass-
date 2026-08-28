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

Protocol (stdin -> stdout, one line each):
  stdin:  {"topic": "..."}
  stdout: {"ok": true, "context": "...", "sources": [{"url": "...", "title": "..."}]}
       or {"ok": false, "error": "..."}

Never a stack trace to stdout -- every failure path here resolves to a normal {"ok": false}
line so the Node side can treat "research unavailable" as a skip, not a crash, the same
convention lib/audit/performance.ts uses for a missing Chrome binary.
"""
import asyncio
import json
import sys


def emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


async def run(topic: str) -> dict:
    from gpt_researcher import GPTResearcher  # imported here so a missing package still

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
