-- ============================================================================
-- Tester — newsletters table
-- Stores drafts the admin writes in the dashboard "New Newsletter" editor.
-- ============================================================================

create table if not exists public.newsletters (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  subject     text        not null check (char_length(subject) between 1 and 200),
  body_html   text        not null,
  body_text   text,
  status      text        not null default 'draft'
              check (status in ('draft','sent','archived')),
  sent_at     timestamptz,
  sent_count  int         not null default 0
);

create index if not exists newsletters_updated_at_idx
  on public.newsletters (updated_at desc);

create index if not exists newsletters_status_idx
  on public.newsletters (status);

alter table public.newsletters enable row level security;

-- Only authenticated readers (the dashboard talks via service role, which bypasses RLS).
drop policy if exists "auth can read newsletters" on public.newsletters;
create policy "auth can read newsletters"
  on public.newsletters for select to authenticated using (true);

-- Auto-bump updated_at
create or replace function public.touch_newsletters_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists newsletters_touch_updated_at on public.newsletters;
create trigger newsletters_touch_updated_at
before update on public.newsletters
for each row execute function public.touch_newsletters_updated_at();
