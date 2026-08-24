-- 013_chat_events.sql — keep the team's reports in the transcript.
--
-- The green "Mr. Keyword found these five keywords, here are their volumes" lines lived only
-- in React state. They vanished on refresh and on reopening the thread — which is exactly
-- backwards: the keyword table with its measured numbers is the part you most want to look
-- back at when asking "why is this article about that?".
--
-- They are not turns in the conversation, though. Nobody said them to Mr Lxwa and he didn't
-- say them to anyone; they are the team reporting work. So they get their own kind rather
-- than being disguised as assistant messages, which keeps them out of the model's history
-- (where they would just be noise it already has in its live status block) while keeping
-- them on screen where they belong.

alter table chat_messages add column if not exists kind text not null default 'message';

alter table chat_messages drop constraint if exists chat_messages_kind_check;
alter table chat_messages add constraint chat_messages_kind_check
  check (kind in ('message', 'event'));

-- 'done' | 'error', for how the line is coloured. Null for ordinary messages.
alter table chat_messages add column if not exists tone text;
