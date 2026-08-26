-- Adds 'running' to scheduled_orders.status.
--
-- WHY THIS IS A SECOND FILE. 015 shipped and was applied before the claim step existed, so its
-- CHECK lists only pending/done/failed/cancelled. `create table if not exists` does nothing on
-- a database that already has the table — editing 015 in place would fix new installs and
-- leave every existing one broken, which is the worse half of the two.
--
-- What breaks without it, measured rather than assumed: the scheduler claims a row by moving
-- it out of 'pending' before it starts work, so two overlapping ticks cannot both publish the
-- same article. Against the old constraint that UPDATE fails with 23514, claim() returns
-- false, the tick moves on — and the order never fires. No error reaches the customer, the row
-- just sits at 'pending' forever while the countdown they were shown runs to zero and past it.
-- A booking that silently never happens is precisely the failure this table was added to end.

-- Found rather than named. Postgres would normally call this scheduled_orders_status_check,
-- but a constraint created by hand or by a different tool can be called anything, and a DROP
-- that silently matches nothing would leave this file reporting success while changing nothing
-- — the same shape of quiet failure it is here to remove.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.scheduled_orders'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table scheduled_orders drop constraint %I', c.conname);
  end loop;
end $$;

alter table scheduled_orders
  add constraint scheduled_orders_status_check
  check (status in ('pending', 'running', 'done', 'failed', 'cancelled'));
