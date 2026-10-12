-- 011_set_status.sql
--
-- Schedule changes (docs/festival-data.md §4.1): a set can be marked as moved
-- or cancelled instead of silently changing time or disappearing, so the app
-- can say "Moved from Sat 11:00 PM (weather)" or "Cancelled" and keep users'
-- picks of it.
--
--   status               'scheduled' (default) | 'moved' | 'cancelled'
--   original_start_time  the start time before a move; only on moved sets,
--                        optional (a stage-only move or an unknown old time)
--   change_note          short reason shown in the app, 1-140 characters
--
-- Data only comes from festival:seed (service role); clients read it through
-- the existing table-level select grant and sets_select_published policy.
-- Idempotent.

set local lock_timeout = '5s';

alter table public.sets
  add column if not exists status text not null default 'scheduled',
  add column if not exists original_start_time timestamptz,
  add column if not exists change_note text;

alter table public.sets
  drop constraint if exists sets_status_check,
  add constraint sets_status_check
    check (status in ('scheduled', 'moved', 'cancelled')),
  drop constraint if exists sets_original_start_time_check,
  add constraint sets_original_start_time_check
    check (original_start_time is null or status = 'moved'),
  drop constraint if exists sets_change_note_check,
  add constraint sets_change_note_check
    check (change_note is null or (
      char_length(change_note) between 1 and 140
      and change_note = btrim(change_note)
    ));
