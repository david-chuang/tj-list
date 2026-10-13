-- View-only for everyone; editing requires the shared password.
-- 1. Replace CHANGE-ME below with your editing password (keep the quotes).
-- 2. Paste into Supabase → SQL Editor → Run (after schema.sql). Safe to re-run;
--    re-running with a new password changes it.

create extension if not exists pgcrypto with schema extensions;

-- The password, stored only as a bcrypt hash. Not readable by the app.
create table if not exists public.app_secret (
  id            int primary key default 1 check (id = 1),
  password_hash text not null
);
alter table public.app_secret enable row level security;
revoke all on public.app_secret from anon, authenticated;

insert into public.app_secret (id, password_hash)
values (1, extensions.crypt('CHANGE-ME', extensions.gen_salt('bf', 10)))
on conflict (id) do update set password_hash = excluded.password_hash;

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

-- All edits go through these functions, which check the password first.
create or replace function public.save_item(
  pw text, item_id uuid, item_name text, item_category text,
  item_checked boolean, item_created_at timestamptz
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.check_editor_password(pw) then
    raise exception 'wrong password' using errcode = '28P01';
  end if;
  insert into public.list_items (id, name, category, checked, created_at)
  values (item_id, item_name, coalesce(nullif(item_category, ''), 'Other'), coalesce(item_checked, false),
          coalesce(item_created_at, now()))
  on conflict (id) do update
    set name = excluded.name, category = excluded.category, checked = excluded.checked;
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
revoke all on function public.save_item(text, uuid, text, text, boolean, timestamptz) from public;
revoke all on function public.delete_item(text, uuid) from public;
grant execute on function public.check_editor_password(text) to anon, authenticated;
grant execute on function public.save_item(text, uuid, text, text, boolean, timestamptz) to anon, authenticated;
grant execute on function public.delete_item(text, uuid) to anon, authenticated;

-- The table itself becomes read-only to the app.
drop policy if exists "public read"     on public.list_items;
drop policy if exists "public insert"   on public.list_items;
drop policy if exists "public update"   on public.list_items;
drop policy if exists "public delete"   on public.list_items;
drop policy if exists "anyone can read" on public.list_items;

create policy "anyone can read" on public.list_items for select to anon, authenticated using (true);

revoke insert, update, delete on public.list_items from anon, authenticated;
grant select on public.list_items to anon, authenticated;
