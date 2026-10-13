-- Shared grocery list table. Paste into Supabase → SQL Editor → Run.
-- Safe to re-run.

create table if not exists public.list_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  category    text not null default 'Other',
  checked     boolean not null default false,
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

-- MVP access model: anyone with the app link can read and edit the list.
alter table public.list_items enable row level security;

drop policy if exists "public read"   on public.list_items;
drop policy if exists "public insert" on public.list_items;
drop policy if exists "public update" on public.list_items;
drop policy if exists "public delete" on public.list_items;

create policy "public read"   on public.list_items for select to anon, authenticated using (true);
create policy "public insert" on public.list_items for insert to anon, authenticated with check (true);
create policy "public update" on public.list_items for update to anon, authenticated using (true) with check (true);
create policy "public delete" on public.list_items for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.list_items to anon, authenticated;

-- Live sync: broadcast row changes to connected phones.
do $$
begin
  alter publication supabase_realtime add table public.list_items;
exception when duplicate_object then null;
end $$;
