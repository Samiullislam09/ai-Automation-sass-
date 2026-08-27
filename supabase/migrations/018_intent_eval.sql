-- 018 · intent_eval: the evaluation set for the chat intent engine (rebuild plan §16).
--
-- One row per real user message in chat_messages. auto_label is what the model said
-- (scripts/label-intents.mjs, service role); human_label is what a person said on /app/eval.
-- The new intent engine is scored against human_label before it is allowed to deploy —
-- lib/eval/README.md has the gate. Label shape: lib/eval/intent-labels.ts.
--
-- Idempotent like 017 (create if not exists / drop policy if exists).

create table if not exists intent_eval (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references chat_messages(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  text            text not null,                  -- the user message, copied so the set is stable
  prior_assistant text,                           -- the assistant turn just before it, for follow-ups
  auto_label      jsonb,
  auto_model      text,
  human_label     jsonb,
  status          text not null default 'auto' check (status in ('auto', 'reviewed', 'skipped')),
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists intent_eval_tenant_status on intent_eval(tenant_id, status, created_at);
create index if not exists intent_eval_auto_intent on intent_eval(tenant_id, (auto_label->>'intent'));

alter table intent_eval enable row level security;

-- Per tenant only. No global read — a reviewer sees their own workspace's messages.
drop policy if exists "intent_eval_member_read" on intent_eval;
create policy "intent_eval_member_read" on intent_eval for select
  using (is_tenant_member(tenant_id));

-- Members may review (human_label / status / reviewed_*) rows of their tenant. No insert/delete
-- policy for members: rows and auto labels are written only by the service role, which bypasses
-- RLS. The trigger below stops a member update from touching the auto columns or the text.
drop policy if exists "intent_eval_member_review" on intent_eval;
create policy "intent_eval_member_review" on intent_eval for update
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create or replace function intent_eval_guard_member_update() returns trigger language plpgsql as $$
begin
  -- Service role (and any other non-authenticated caller, e.g. psql) may change anything.
  if auth.role() = 'authenticated' then
    new.message_id      := old.message_id;
    new.tenant_id       := old.tenant_id;
    new.text            := old.text;
    new.prior_assistant := old.prior_assistant;
    new.auto_label      := old.auto_label;
    new.auto_model      := old.auto_model;
    new.created_at      := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists intent_eval_guard on intent_eval;
create trigger intent_eval_guard before update on intent_eval
  for each row execute function intent_eval_guard_member_update();
