-- Sets (or changes) the shared editing password.
-- Replace CHANGE-ME with the new password (keep the quotes), then run in Supabase → SQL Editor.
-- Phones using the old password drop back to view-only until someone enters the new one.

insert into public.app_secret (id, password_hash)
values (1, extensions.crypt('CHANGE-ME', extensions.gen_salt('bf', 10)))
on conflict (id) do update set password_hash = excluded.password_hash;
