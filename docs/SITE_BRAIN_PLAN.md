# Site Brain — what it should hold

Written 2026-09-05, after the owner asked: *"ye brain hai, so all details hona chahiye — kaunse
details add karne chahiye?"*

The Site Brain is the single thing every agent reads before it does anything. If a fact is not
here, no agent can use it — and if a wrong fact is here, every article repeats it. So the rule
for adding a field is not "would this be nice to know", it is:

> **Some agent must be blocked without it, or produce something wrong with it missing.**

Everything below is written against that test, and marked with **who fills it** and **who reads
it**. Nothing is invented at runtime: a field with no evidence stays empty and says so.

---

## Where it stands today (12 fields)

| Field | Filled by | Read by |
|---|---|---|
| `what_they_do` | crawler + analyst | every writer prompt |
| `offerings` | crawler + analyst | Mr. Writer (CTA + internal links) |
| `audience` | onboarding + analyst | tone, examples, Mr. Lead's ICP |
| `buyer_intent` | analyst | article angles |
| `proof` | analyst (quote must exist on a page) | the only business claims allowed in an article |
| `topic_clusters` | analyst (embeddings) | Mr. Keyword — kills off-topic suggestions |
| `content_gaps` | Search Console | the planner's first priority |
| `voice` | onboarding + analyst | every writer prompt |
| `geo` | crawler | titles, schema, local intent |
| `language` | crawler | the language articles are written in |
| `competitors` | user only | comparison angles |
| `goals` | onboarding | what the planner optimises for |

That covers *what the business is*. It does not yet cover *how it is allowed to speak*, *what it
must never say*, or *where a reader should be sent* — which is where most bad output comes from.

---

## Phase 1 — the gaps that cause visibly wrong output (build first)

| # | Field | Why it matters | Filled by | Read by |
|---|---|---|---|---|
| 1 | `never_say` — banned claims, words, competitors, regulated phrases | The single biggest compliance risk. Without it a model will happily write "guaranteed certification in 7 days". | user (onboarding + Site Brain) | every writer, quality gate as a hard block |
| 2 | `cta` — primary CTA text + URL, secondary CTA, contact route (form / phone / booking link) | Today the writer falls back to "contact us" with no link. Every article ends in a dead end. | crawler (finds forms/buttons) + user confirms | Mr. Writer, Miss Social |
| 3 | `usp` — 3–5 differentiators, in the customer's words | Otherwise every article reads like the competitor's. | analyst + user | writer, Mr. Lead outreach |
| 4 | `pricing` — model (fixed / quote / subscription), range or "on request" | Buyer-intent questions are mostly price questions; without this the article dodges them. | user | writer, buyer-intent angles |
| 5 | `objections` — the 5 things a buyer worries about, with the honest answer | Turns thin articles into ones that convert. | user + analyst (FAQ pages) | writer, Miss Social |
| 6 | `credentials` — accreditations, licences, registrations, memberships | A regulated industry cannot claim these loosely, and *can* claim them when true. | crawler + user | writer (E-E-A-T), schema |
| 7 | `money_pages` — the pages that actually earn, in priority order | Internal links should point at these, not at whatever page matched. | user + GSC (conversions where available) | writer's internal-link step |
| 8 | `publishing_rules` — target length, structure, image policy, author byline, disclaimer text | Right now these are hard-coded defaults; they belong to the customer. | user | writer, publisher, quality gate |

## Phase 2 — makes the output measurably better

| # | Field | Why | Filled by | Read by |
|---|---|---|---|---|
| 9 | `personas` — 2–3 buyer profiles (role, pain, trigger) | Beyond one `audience` line: different articles are for different readers. | onboarding + analyst | writer, Mr. Lead |
| 10 | `brand` — brand name, legal name, tagline, founded, team size | Used verbatim in schema, bylines and outreach. Guessing it is embarrassing. | crawler | writer, schema, outreach |
| 11 | `case_studies` — result + number + who + link | The only way an article can say "we cut audit prep by 40%" honestly. | user + crawler | writer, proof block |
| 12 | `internal_link_map` — cluster → pillar page | Makes internal linking a structure, not a lucky match. | analyst | writer |
| 13 | `keywords_owned` — queries already ranking top 3, with their page | Stops the team writing a second article that cannibalises the first. | Search Console | Mr. Keyword, planner |
| 14 | `schema` — Organization vs LocalBusiness, NAP, GBP profile URL, socials | Local SEO and rich results need exact, consistent values. | crawler + Google connection | publisher |
| 15 | `service_areas` — cities/regions actually served, ranked | `geo` is one line; local content needs the list. | user | writer, GBP posts |
| 16 | `seasonality` — deadlines, renewal cycles, event calendar | Timing is half of what makes a topic worth writing this month. | user | planner |

## Phase 3 — competitive and long-term

| # | Field | Why | Filled by | Read by |
|---|---|---|---|---|
| 17 | `competitor_profiles` — per competitor: what they rank for, what they claim, what we do differently | Turns the bare domain list into an angle. | analyst + Search Console | planner, writer |
| 18 | `content_inventory` — every page: URL, type, cluster, last updated, performance | Enables "refresh this old page" instead of only "write a new one". | crawler + GSC | planner |
| 19 | `not_offered` — things the business does NOT do | Prevents the most common hallucination: promising an adjacent service. | user | writer, quality gate |
| 20 | `tone_samples` — 2–3 paragraphs the owner likes, verbatim | The most effective voice control there is: an example beats an adjective. | user | writer |
| 21 | `glossary` — the terms of the trade, spelled the customer's way | ISO 9001 vs ISO9001, "audit" vs "assessment". Consistency is credibility. | analyst + user | writer, quality gate |
| 22 | `review_cadence` — when each field was last confirmed by a human | An 8-month-old "price range" is a liability. Should nudge, not block. | system | this page |

---

## Rules the whole brain follows

1. **Never guess.** No value without either a page it was read from, a Google measurement, or the
   user typing it. An empty field is information, not a hole to fill with a plausible sentence.
2. **Every field carries three things**: the value, its **source** (page URL / "you told us" /
   "Search Console"), and a **confidence**. That trio is already in the schema — new fields keep it.
3. **Human edit wins forever.** Editing a field adds it to `user_edited`; the analyst copies it
   forward untouched and may only *suggest* changes.
4. **Hard blocks are a separate class.** `never_say` and `not_offered` are not advice to the
   writer — the quality gate fails an article that violates them.
5. **Ask at the right moment.** Onboarding asks for Phase 1 only. Everything else is asked when
   it first matters (e.g. `pricing` the first time a "cost" article is planned), so the form
   never becomes a wall.

---

## Build order

1. Extend the schema mirror in both places at once —
   `agent-server/src/lib/siteProfile.ts` and `components/SiteBrainModel.tsx` — plus `coerceField`
   for each new shape. The two files must never drift.
2. Migration: the profile is a jsonb column, so new fields need no DDL; only
   `PROFILE_FIELDS`, `FIELD_GROUPS` and the empty-profile factory change.
3. Analyst: fill what can be read from pages (`brand`, `credentials`, `cta`, `usp` candidates)
   and leave the rest empty for the user.
4. Onboarding: collect Phase 1's user-only fields (`never_say`, `pricing`, `objections`,
   `publishing_rules`) — short, skippable, resumable from this page.
5. Quality gate: enforce `never_say` and `not_offered` as blocks; log the reason on the item so
   Approvals can explain the failure.
6. Writer prompt: add the new fields in a fixed order and keep the prompt under budget by
   sending only the fields that field's article type needs.
