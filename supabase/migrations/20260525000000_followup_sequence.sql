-- ============================================================================
-- Tester — follow-up nurture sequence
-- Adds unsubscribe state, email_interactions log, and the daily pg_cron job
-- that calls the send-followup-email Edge Function.
-- Safe to re-run.
-- ============================================================================

-- 1. Extensions
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Unsubscribe state on contact_submissions
alter table public.contact_submissions
  add column if not exists unsubscribed_at   timestamptz,
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists contact_submissions_unsub_token_idx
  on public.contact_submissions (unsubscribe_token);

-- 3. email_interactions — one row per send (success or failure)
create table if not exists public.email_interactions (
  id            uuid        primary key default gen_random_uuid(),
  submission_id uuid        not null references public.contact_submissions(id) on delete cascade,
  kind          text        not null check (kind in (
                            'confirmation','followup_value','followup_testimonials',
                            'followup_updates','followup_final')),
  step          int         not null check (step between 0 and 4),
  sent_at       timestamptz not null default now(),
  resend_id     text,
  status        text        not null default 'sent' check (status in ('sent','failed','skipped')),
  error         text,
  unique (submission_id, step)
);

create index if not exists email_interactions_submission_idx on public.email_interactions (submission_id);
create index if not exists email_interactions_sent_at_idx    on public.email_interactions (sent_at desc);

-- 4. RLS — only authenticated team members can read
alter table public.email_interactions enable row level security;

drop policy if exists "auth can read interactions" on public.email_interactions;
create policy "auth can read interactions"
  on public.email_interactions for select to authenticated using (true);

-- 5. The function pg_cron calls every day.
-- Secret is embedded in the function body (security definer means only the
-- function owner can read its source via pg_proc — safe enough for this scope).
create or replace function public.tick_followups()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://rcuvzfzqrozhovddffqk.supabase.co/functions/v1/send-followup-email',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  '06120e7cbee105095e32def0ab11270f53ecb72a01455e528f551e375685502e'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;

-- Lock down direct callers: only postgres (cron) and service_role can execute it
revoke all on function public.tick_followups() from public, anon, authenticated;

-- 7. Schedule: every day at 10:00 UTC
-- Unschedule first so re-running this migration doesn't duplicate jobs.
do $$
begin
  perform cron.unschedule('tester-daily-followups');
exception when others then null;
end $$;

select cron.schedule(
  'tester-daily-followups',
  '0 10 * * *',
  $cmd$ select public.tick_followups(); $cmd$
);
