-- 011_chat_history.sql — the conversation with Mr Lxwa has to survive a refresh.
--
-- Chat lived entirely in React state. Reloading the page, or navigating between /app pages,
-- threw the whole conversation away — including the part where he told you which job he had
-- just started, which is the one thing you most want to scroll back to. There was also no way
-- to look at anything you asked yesterday.
--
-- Two tables rather than one blob per tenant: a conversation is the thing you reopen from a
-- list (like ChatGPT's sidebar), and messages have to be appendable one at a time while a
-- reply is still streaming.

create table if not exists chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- Who started it. Kept so a multi-seat workspace can show "your chats" later; RLS is on
  -- the tenant, because teammates on the same workspace share the same team.
  user_id    uuid references auth.users(id) on delete set null,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  -- Denormalised on purpose: RLS has to check tenant membership without joining back to the
  -- parent row on every single insert.
  tenant_id       uuid not null references tenants(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

alter table chat_conversations enable row level security;
alter table chat_messages      enable row level security;

create policy "chat_conversations_all_member" on chat_conversations for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "chat_messages_all_member" on chat_messages for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- The two reads this powers: the conversation list, and one conversation in order.
create index if not exists idx_chat_conversations_tenant on chat_conversations(tenant_id, updated_at desc);
create index if not exists idx_chat_messages_conversation on chat_messages(conversation_id, created_at);
