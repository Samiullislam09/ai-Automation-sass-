# Intent evaluation set

The chat intent engine (rebuild plan §5.1, §16) is an LLM. It is not trusted; it is scored.
This folder holds the label schema; the data lives in the `intent_eval` table
(`supabase/migrations/018_intent_eval.sql`), one row per real user message in `chat_messages`.

## 1. Build the set

```
# once: apply supabase/migrations/018_intent_eval.sql (manual, like the others)

node scripts/label-intents.mjs --dry-run --limit 10   # sanity-check the prompt, writes nothing
node scripts/label-intents.mjs                        # label every user message not yet in intent_eval
node scripts/label-intents.mjs --limit 50             # a batch
```

Reads `.env.local` for `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NVIDIA_API_KEY`,
optional `CHAT_MODEL` (default `openai/gpt-oss-120b`, `reasoning_effort:"low"`, temperature 0).
Each user message is sent with the assistant turn right before it, so follow-ups ("haan",
"mat karna") can be read in context. Already-labelled messages are skipped, so re-run it any
time the chat has grown. 4 calls in flight, 3 retries, a summary table of intents at the end.

## 2. Review it

`/app/eval` (nav: Eval). One message at a time: the previous assistant turn (muted), the user
text, and the auto label as editable fields.

- **A** accept the auto label as the human label
- **S** save the edited fields as the human label (Ctrl/Cmd+Enter from inside a field)
- **K** skip (not scored — junk, test messages, someone else's language)
- **← / →** move without saving

Filters: status (unreviewed / reviewed / skipped / all) and auto intent. Header shows
`37/222 reviewed`. Only `human_label`, `status`, `reviewed_*` are writable by a member; the
auto columns and text are frozen by a trigger.

## 3. What the labels mean

Schema: `lib/eval/intent-labels.ts` (`IntentLabel`).

| field | meaning |
|---|---|
| `intent` | `write_article` new article now (also "likh ke publish kar do") · `find_keywords` research only, never an article · `plan_topics` "run the team", no topic · `publish` push an EXISTING draft live · `schedule` change the recurring timetable · `cancel` call off a booked order · `reject` bin a draft · `status` "kya update hai" · `connect` site/WP/Google integration · `question` how does X work / can you do X · `chitchat` hi, thanks · `followup` only meaningful as a reply to the previous turn · `other` |
| `topic` | the subject only ("solar panels for homes"), never the request words; null if none |
| `delivery` | `approvals` draft to review · `publish` straight to the site · `chat` answer in chat · null = not said (never guessed) |
| `when` | the time phrase as typed ("30 min baad"); `lib/when.ts` parses it, the label does not |
| `is_followup` / `followup_kind` | `confirm` "haan" · `deny` "mat karna" · `choose` "pehla wala", "2" · `change` "solar ki jagah wind" |
| `ambiguous` | two reasonable readings; say why in `notes` |

Negation rules everything: "article nahi likhna" is `find_keywords`, "publish mat karna" after a
publish question is `followup`/`deny`. A follow-up that also carries a full new order gets the
order's intent with `is_followup: true`.

## 4. How the set is used — the accuracy gate

Before a new intent engine (prompt, model, or router change) deploys, run it over every row with
`status = 'reviewed'`, feeding `prior_assistant` + `text`, and compare to `human_label`:

| metric | gate |
|---|---|
| `intent` exact match, all reviewed rows | ≥ 90 % |
| `intent` exact match on rows whose human intent is irreversible (`publish`, `cancel`, `reject`, `schedule`) | ≥ 99 % — a miss here spends money or deletes work |
| `is_followup` + `followup_kind` match on rows with `is_followup = true` | ≥ 95 % |
| a `deny` follow-up read as any action | 0 allowed |
| `topic` match (case-insensitive, after trimming filler) where human topic is non-null | ≥ 85 % |

Rows with `ambiguous = true` count as correct if the engine picks the human intent **or** asks a
question (`missing`/`confidence < 0.75` in the §5.1 shape). Skipped rows are not scored. The gate
runs in CI once the engine exists (`scripts/eval-intents.mjs`, not yet written); the numbers are
the starting bar and go up, not down, as the set grows. Nothing is deployed on the auto labels
alone — they are the model grading itself.
