create extension if not exists "pgcrypto";

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  tier text not null default 'unknown',
  weight numeric not null default 1.0,
  created_at timestamptz not null default now()
);

create table if not exists feeds (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete set null,
  url text not null unique,
  feed_type text not null default 'rss',
  is_active boolean not null default true,
  last_success_at timestamptz,
  last_error text,
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_feeds_active on feeds(is_active);
create index if not exists idx_feeds_success_at on feeds(last_success_at desc);

create table if not exists admin_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete set null,
  url text not null unique,
  title text,
  summary text,
  quality_label text not null default 'unknown',
  quality_score numeric not null default 0.5,
  quality_reasons text[] not null default '{}',
  quality_checked_at timestamptz,
  summary_choice_source text,
  summary_choice_method text not null default 'none',
  summary_choice_confidence numeric not null default 0.0,
  summary_choice_reasons text[] not null default '{}',
  summary_choice_checked_at timestamptz,
  summary_candidates jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists articles
  add column if not exists quality_label text not null default 'unknown';

alter table if exists articles
  add column if not exists quality_score numeric not null default 0.5;

alter table if exists articles
  add column if not exists quality_reasons text[] not null default '{}';

alter table if exists articles
  add column if not exists quality_checked_at timestamptz;

alter table if exists articles
  add column if not exists summary_choice_source text;

alter table if exists articles
  add column if not exists summary_choice_method text not null default 'none';

alter table if exists articles
  add column if not exists summary_choice_confidence numeric not null default 0.0;

alter table if exists articles
  add column if not exists summary_choice_reasons text[] not null default '{}';

alter table if exists articles
  add column if not exists summary_choice_checked_at timestamptz;

alter table if exists articles
  add column if not exists summary_candidates jsonb not null default '[]'::jsonb;

create index if not exists idx_articles_published_at on articles(published_at desc);
create index if not exists idx_articles_fetched_at on articles(fetched_at desc);
create index if not exists idx_articles_quality_label on articles(quality_label);
create index if not exists idx_articles_quality_checked_at on articles(quality_checked_at desc);
create index if not exists idx_articles_summary_choice_checked_at on articles(summary_choice_checked_at desc);
create index if not exists idx_articles_summary_choice_method on articles(summary_choice_method);

alter table if exists articles
  add column if not exists relevance_score numeric;

alter table if exists articles
  add column if not exists relevance_category text;

alter table if exists articles
  add column if not exists relevance_reason text;

alter table if exists articles
  add column if not exists relevance_checked_at timestamptz;

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  story_key text not null,
  title text not null,
  summary text,
  preview_text text,
  preview_type text not null default 'headline_only',
  preview_confidence numeric not null default 0.0,
  preview_reason text,
  editor_title text,
  editor_summary text,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists stories
  add column if not exists preview_text text;

alter table if exists stories
  add column if not exists preview_type text not null default 'headline_only';

alter table if exists stories
  add column if not exists preview_confidence numeric not null default 0.0;

alter table if exists stories
  add column if not exists preview_reason text;

create index if not exists idx_stories_story_key on stories(story_key);
create index if not exists idx_stories_story_key_last_seen on stories(story_key, last_seen_at desc);
create index if not exists idx_stories_last_seen_at on stories(last_seen_at desc);
create index if not exists idx_stories_status on stories(status);

create table if not exists story_articles (
  story_id uuid not null references stories(id) on delete cascade,
  article_id uuid not null references articles(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (story_id, article_id)
);

create index if not exists idx_story_articles_story_id on story_articles(story_id);
create unique index if not exists idx_story_articles_primary_unique
  on story_articles (story_id)
  where is_primary;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_articles_updated_at on articles;
create trigger set_articles_updated_at
before update on articles
for each row
execute function set_updated_at();

drop trigger if exists set_feeds_updated_at on feeds;
create trigger set_feeds_updated_at
before update on feeds
for each row
execute function set_updated_at();

drop trigger if exists set_stories_updated_at on stories;
create trigger set_stories_updated_at
before update on stories
for each row
execute function set_updated_at();

-- Enable Row Level Security (permissive policies for server-side access)
alter table sources enable row level security;
alter table feeds enable row level security;
alter table admin_events enable row level security;
alter table articles enable row level security;
alter table stories enable row level security;
alter table story_articles enable row level security;

-- Permissive policies (allow all operations - we use server-side auth)
drop policy if exists "Allow all" on sources;
create policy "Allow all" on sources for all using (true) with check (true);

drop policy if exists "Allow all" on feeds;
create policy "Allow all" on feeds for all using (true) with check (true);

drop policy if exists "Allow all" on admin_events;
create policy "Allow all" on admin_events for all using (true) with check (true);

drop policy if exists "Allow all" on articles;
create policy "Allow all" on articles for all using (true) with check (true);

drop policy if exists "Allow all" on stories;
create policy "Allow all" on stories for all using (true) with check (true);

drop policy if exists "Allow all" on story_articles;
create policy "Allow all" on story_articles for all using (true) with check (true);
