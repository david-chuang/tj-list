-- Shared grocery list table. Paste into Supabase → SQL Editor → Run, then run functions.sql
-- and set-password.sql. Safe to re-run.

create table if not exists public.list_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  category    text not null default 'Other',
  checked     boolean not null default false,
  quantity    int not null default 1 check (quantity between 1 and 99),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep updated_at current on every change.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists list_items_touch on public.list_items;
create trigger list_items_touch
  before update on public.list_items
  for each row execute function public.touch_updated_at();

-- Locked down by default; functions.sql grants read access and password-checked editing.
alter table public.list_items enable row level security;

-- Live sync: broadcast row changes to connected phones.
do $$
begin
  alter publication supabase_realtime add table public.list_items;
exception when duplicate_object then null;
end $$;
