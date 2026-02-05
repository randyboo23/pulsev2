create extension if not exists "pgcrypto";

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  tier text not null default 'unknown',
  weight numeric not null default 1.0,
  created_at timestamptz not null default now()
);

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
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_articles_published_at on articles(published_at desc);
create index if not exists idx_articles_fetched_at on articles(fetched_at desc);

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  story_key text not null,
  title text not null,
  summary text,
  editor_title text,
  editor_summary text,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

drop trigger if exists set_stories_updated_at on stories;
create trigger set_stories_updated_at
before update on stories
for each row
execute function set_updated_at();
