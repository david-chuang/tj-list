-- Editing rules: anyone can read the list; changes go through functions that check the shared
-- password. Paste into Supabase → SQL Editor → Run (after schema.sql). Safe to re-run.
-- Set or change the password itself with set-password.sql.

create extension if not exists pgcrypto with schema extensions;

-- Quantity per item (added in v2).
alter table public.list_items
  add column if not exists quantity int not null default 1;
do $$
begin
  alter table public.list_items add constraint list_items_quantity_range check (quantity between 1 and 99);
exception when duplicate_object then null;
end $$;

-- The password, stored only as a bcrypt hash. Not readable by the app.
create table if not exists public.app_secret (
  id            int primary key default 1 check (id = 1),
  password_hash text not null
);
alter table public.app_secret enable row level security;
revoke all on public.app_secret from anon, authenticated;

create or replace function public.check_editor_password(pw text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_secret s
    where s.password_hash = extensions.crypt(coalesce(pw, ''), s.password_hash)
  );
$$;

-- v1 had save_item without a quantity; replace it so there's exactly one version.
drop function if exists public.save_item(text, uuid, text, text, boolean, timestamptz);

-- item_quantity is optional so older copies of the app keep working; when omitted on an
-- update, the existing quantity is kept.
create or replace function public.save_item(
  pw text, item_id uuid, item_name text, item_category text,
  item_checked boolean, item_created_at timestamptz, item_quantity int default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.check_editor_password(pw) then
    raise exception 'wrong password' using errcode = '28P01';
  end if;
  insert into public.list_items (id, name, category, checked, created_at, quantity)
  values (item_id, item_name, coalesce(nullif(item_category, ''), 'Other'), coalesce(item_checked, false),
          coalesce(item_created_at, now()), least(greatest(coalesce(item_quantity, 1), 1), 99))
  on conflict (id) do update
    set name     = excluded.name,
        category = excluded.category,
        checked  = excluded.checked,
        quantity = case when item_quantity is null then public.list_items.quantity
                        else excluded.quantity end;
end $$;

create or replace function public.delete_item(pw text, item_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.check_editor_password(pw) then
    raise exception 'wrong password' using errcode = '28P01';
  end if;
  delete from public.list_items where id = item_id;
end $$;

revoke all on function public.check_editor_password(text) from public;
revoke all on function public.save_item(text, uuid, text, text, boolean, timestamptz, int) from public;
revoke all on function public.delete_item(text, uuid) from public;
grant execute on function public.check_editor_password(text) to anon, authenticated;
grant execute on function public.save_item(text, uuid, text, text, boolean, timestamptz, int) to anon, authenticated;
grant execute on function public.delete_item(text, uuid) to anon, authenticated;

-- The table itself is read-only to the app.
drop policy if exists "public read"     on public.list_items;
drop policy if exists "public insert"   on public.list_items;
drop policy if exists "public update"   on public.list_items;
drop policy if exists "public delete"   on public.list_items;
drop policy if exists "anyone can read" on public.list_items;

create policy "anyone can read" on public.list_items for select to anon, authenticated using (true);

revoke insert, update, delete on public.list_items from anon, authenticated;
grant select on public.list_items to anon, authenticated;

-- Tell the API about the new function signature right away.
notify pgrst, 'reload schema';
