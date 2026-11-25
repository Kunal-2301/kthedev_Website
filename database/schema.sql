-- =============================================================================
-- Kunal Gupta Portfolio CMS — core schema
-- Run order: schema.sql → functions.sql → rls-policies.sql → storage.sql → cron.sql → seed.sql
-- Target: Supabase (PostgreSQL 15+). Idempotent where practical.
-- =============================================================================

create extension if not exists pgcrypto;

-- Internal schema: NOT exposed through the Supabase Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Domains (validated scalar types)
-- -----------------------------------------------------------------------------
do $$ begin
  create domain public.https_url as text
    check (value ~* '^https://[^\s<>"''`]+$' and char_length(value) <= 2048);
exception when duplicate_object then null; end $$;

-- Links that may also be e-mail links (social/footer links)
do $$ begin
  create domain public.safe_link as text
    check ((value ~* '^https://[^\s<>"''`]+$' or value ~* '^mailto:[^\s<>"''`@]+@[^\s<>"''`]+$')
           and char_length(value) <= 2048);
exception when duplicate_object then null; end $$;

do $$ begin
  create domain public.email_address as text
    check (value ~* '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$' and char_length(value) <= 254);
exception when duplicate_object then null; end $$;

do $$ begin
  create domain public.slug_text as text
    check (value ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(value) <= 120);
exception when duplicate_object then null; end $$;

-- Storage object path: no traversal, no leading slash, safe characters only
do $$ begin
  create domain public.storage_path as text
    check (value ~ '^[a-z0-9][a-z0-9/_\.-]*$' and value !~ '\.\.' and char_length(value) <= 300);
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_status as enum ('draft', 'scheduled', 'published', 'archived');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Administrators (authorization source of truth)
-- Rows can only be created with SQL by the project owner (see docs/SETUP.md).
-- -----------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Profile (singleton, published values only — drafts live in content_drafts)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id               smallint primary key default 1 check (id = 1),
  full_name        text not null check (char_length(full_name) between 1 and 120),
  handle           text check (handle ~ '^[A-Za-z0-9_.-]{1,40}$'),
  tagline          text check (char_length(tagline) <= 160),
  designation      text not null default '' check (char_length(designation) <= 200),
  hero_headline    text not null default '' check (char_length(hero_headline) <= 200),
  hero_description text not null default '' check (char_length(hero_description) <= 600),
  intro            text not null default '' check (char_length(intro) <= 600),
  about_md         text not null default '' check (char_length(about_md) <= 10000),
  focus_areas      text[] not null default '{}' check (cardinality(focus_areas) <= 20),
  availability     text check (char_length(availability) <= 160),
  location         text check (char_length(location) <= 120),
  email            public.email_address,
  phone            text check (phone ~ '^[0-9+()\s.-]{4,40}$'),
  github_url       public.https_url,
  linkedin_url     public.https_url,
  avatar_path      public.storage_path,
  footer_text      text check (char_length(footer_text) <= 300),
  seo_title        text check (char_length(seo_title) <= 120),
  seo_description  text check (char_length(seo_description) <= 320),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

-- Columns added after the first release (no-ops on fresh installs).
alter table public.profiles add column if not exists handle text check (handle ~ '^[A-Za-z0-9_.-]{1,40}$');
alter table public.profiles add column if not exists tagline text check (char_length(tagline) <= 160);

-- -----------------------------------------------------------------------------
-- Website settings (singleton)
-- -----------------------------------------------------------------------------
create table if not exists public.site_settings (
  id               smallint primary key default 1 check (id = 1),
  site_title       text not null check (char_length(site_title) between 1 and 120),
  meta_description text check (char_length(meta_description) <= 320),
  keywords         text check (char_length(keywords) <= 500),
  canonical_url    public.https_url,
  theme_default    text not null default 'light' check (theme_default in ('light', 'dark', 'system')),
  og_image_path    public.storage_path,
  favicon_path     public.storage_path,
  contact_email    public.email_address,
  contact_phone    text check (contact_phone ~ '^[0-9+()\s.-]{4,40}$'),
  sections         jsonb not null default
    '{"about":true,"skills":true,"projects":true,"experience":true,"education":true,"certifications":true,"contact":true}'::jsonb
    check (jsonb_typeof(sections) = 'object'),
  analytics_enabled boolean not null default true,
  assistant_enabled boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

-- -----------------------------------------------------------------------------
-- Navigation / footer / social links
-- -----------------------------------------------------------------------------
create table if not exists public.nav_items (
  id          uuid primary key default gen_random_uuid(),
  location    text not null check (location in ('header', 'footer', 'social')),
  label       text not null check (char_length(label) between 1 and 40),
  target_type text not null check (target_type in ('section', 'url')),
  section_key text check (section_key in ('about','skills','projects','experience','education','certifications','contact')),
  url         public.safe_link,
  icon        text check (icon in ('github','linkedin','email','x','website','youtube','kaggle','medium','huggingface','link')),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint nav_target_valid check (
    (target_type = 'section' and section_key is not null and url is null) or
    (target_type = 'url' and url is not null and section_key is null))
);
create index if not exists nav_items_location_order_idx on public.nav_items (location, sort_order);

-- -----------------------------------------------------------------------------
-- Skills
-- -----------------------------------------------------------------------------
create table if not exists public.skill_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  slug        public.slug_text not null unique,
  description text check (char_length(description) <= 300),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index if not exists skill_categories_name_uq on public.skill_categories (lower(name));
create index if not exists skill_categories_order_idx on public.skill_categories (sort_order);

create table if not exists public.skills (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.skill_categories (id) on delete restrict,
  name        text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 300),
  icon_path   public.storage_path,
  level       text not null default 'familiar' check (level in ('experienced', 'familiar', 'exploring')),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index if not exists skills_name_uq on public.skills (lower(name));
create index if not exists skills_category_order_idx on public.skills (category_id, sort_order);

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  slug              public.slug_text not null unique,
  title             text not null check (char_length(title) between 1 and 120),
  short_description text not null default '' check (char_length(short_description) <= 300),
  description_md    text not null default '' check (char_length(description_md) <= 50000),
  problem_md        text not null default '' check (char_length(problem_md) <= 20000),
  solution_md       text not null default '' check (char_length(solution_md) <= 20000),
  architecture_md   text not null default '' check (char_length(architecture_md) <= 20000),
  implementation_md text not null default '' check (char_length(implementation_md) <= 30000),
  key_features      text[] not null default '{}' check (cardinality(key_features) <= 40),
  challenges        text[] not null default '{}' check (cardinality(challenges) <= 40),
  category          text check (char_length(category) <= 60),
  project_status    text not null default 'completed'
                      check (project_status in ('completed', 'in_progress', 'maintained', 'planned')),
  github_url        public.https_url,
  demo_url          public.https_url,
  docs_url          public.https_url,
  resources         jsonb not null default '[]'::jsonb,
  metrics           jsonb not null default '[]'::jsonb,
  cover_image_path  public.storage_path,
  cover_alt         text check (char_length(cover_alt) <= 200),
  is_featured       boolean not null default false,
  sort_order        integer not null default 0,
  status            public.content_status not null default 'draft',
  publish_at        timestamptz,
  unpublish_at      timestamptz,
  published_at      timestamptz,
  seo_title         text check (char_length(seo_title) <= 120),
  seo_description   text check (char_length(seo_description) <= 320),
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  constraint projects_scheduled_has_date check (status <> 'scheduled' or publish_at is not null),
  constraint projects_unpublish_after_publish check (unpublish_at is null or publish_at is null or unpublish_at > publish_at)
);
create index if not exists projects_public_idx on public.projects (status, is_featured desc, sort_order);
create index if not exists projects_publish_at_idx on public.projects (publish_at) where status = 'scheduled';
create index if not exists projects_unpublish_at_idx on public.projects (unpublish_at) where unpublish_at is not null;

create table if not exists public.project_images (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  kind         text not null check (kind in ('screenshot', 'architecture')),
  storage_path public.storage_path not null,
  alt_text     text not null default '' check (char_length(alt_text) <= 200),
  caption      text check (char_length(caption) <= 300),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists project_images_project_idx on public.project_images (project_id, kind, sort_order);

create table if not exists public.project_technologies (
  project_id uuid not null references public.projects (id) on delete cascade,
  skill_id   uuid not null references public.skills (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (project_id, skill_id)
);
create index if not exists project_technologies_skill_idx on public.project_technologies (skill_id);

-- -----------------------------------------------------------------------------
-- Experience / Education / Certifications
-- -----------------------------------------------------------------------------
create table if not exists public.experience (
  id               uuid primary key default gen_random_uuid(),
  company          text not null check (char_length(company) between 1 and 120),
  company_url      public.https_url,
  role_title       text not null check (char_length(role_title) between 1 and 120),
  employment_type  text not null default 'full_time'
                     check (employment_type in ('full_time','part_time','internship','contract','freelance','leadership','volunteer')),
  location         text check (char_length(location) <= 120),
  start_date       date not null,
  end_date         date,
  is_current       boolean not null default false,
  date_precision   text not null default 'month' check (date_precision in ('month', 'year')),
  logo_path        public.storage_path,
  summary          text check (char_length(summary) <= 1000),
  responsibilities text[] not null default '{}' check (cardinality(responsibilities) <= 30),
  achievements     text[] not null default '{}' check (cardinality(achievements) <= 30),
  sort_order       integer not null default 0,
  status           public.content_status not null default 'draft' check (status <> 'scheduled'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint experience_dates_valid check (end_date is null or end_date >= start_date),
  constraint experience_current_valid check (not (is_current and end_date is not null))
);
create index if not exists experience_public_idx on public.experience (status, sort_order);

create table if not exists public.education (
  id           uuid primary key default gen_random_uuid(),
  institution  text not null check (char_length(institution) between 1 and 160),
  degree       text not null check (char_length(degree) between 1 and 160),
  field        text check (char_length(field) <= 160),
  location     text check (char_length(location) <= 120),
  start_year   integer check (start_year between 1950 and 2100),
  end_year     integer check (end_year between 1950 and 2100),
  grade        text check (char_length(grade) <= 60),
  description  text check (char_length(description) <= 2000),
  logo_path    public.storage_path,
  sort_order   integer not null default 0,
  status       public.content_status not null default 'draft' check (status <> 'scheduled'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  constraint education_years_valid check (end_year is null or start_year is null or end_year >= start_year)
);
create index if not exists education_public_idx on public.education (status, sort_order);

create table if not exists public.certifications (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 200),
  issuer         text not null check (char_length(issuer) between 1 and 160),
  issue_date     date,
  expiry_date    date,
  credential_id  text check (char_length(credential_id) <= 120),
  verify_url     public.https_url,
  file_path      public.storage_path,
  file_kind      text check (file_kind in ('image', 'pdf')),
  description    text check (char_length(description) <= 1000),
  sort_order     integer not null default 0,
  status         public.content_status not null default 'draft' check (status <> 'scheduled'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint certifications_file_kind check ((file_path is null) = (file_kind is null)),
  constraint certifications_dates_valid check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create index if not exists certifications_public_idx on public.certifications (status, sort_order);

-- -----------------------------------------------------------------------------
-- Resumes (files live in the PRIVATE "resumes" bucket; served via Edge Function)
-- -----------------------------------------------------------------------------
create table if not exists public.resumes (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 120),
  description   text check (char_length(description) <= 500),
  storage_path  public.storage_path not null,
  original_name text check (char_length(original_name) <= 255),
  file_size     integer not null check (file_size > 0 and file_size <= 10485760),
  is_active     boolean not null default true,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  constraint resumes_default_must_be_active check (not is_default or is_active)
);
create unique index if not exists resumes_single_default_uq on public.resumes (is_default) where is_default;

-- -----------------------------------------------------------------------------
-- Contact messages (inserted ONLY by the submit-contact Edge Function)
-- -----------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  email      public.email_address not null,
  subject    text not null default '' check (char_length(subject) <= 200),
  message    text not null check (char_length(message) between 10 and 5000),
  status     text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  ip_hash    text check (char_length(ip_hash) <= 128),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists contact_messages_status_idx on public.contact_messages (status, created_at desc);

-- -----------------------------------------------------------------------------
-- CMS infrastructure
-- -----------------------------------------------------------------------------
-- Unpublished edits to singletons (profile, site settings). Admin-only.
create table if not exists public.content_drafts (
  entity_type text primary key check (entity_type in ('profile', 'settings')),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Immutable snapshots of rows before significant updates or deletion.
create table if not exists public.content_versions (
  id          bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('project','profile','settings','skill','experience','education','certification','resume')),
  entity_id   text not null,
  version_no  integer not null,
  snapshot    jsonb not null,
  change_kind text not null check (change_kind in ('update', 'delete')),
  changed_by  uuid,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id, version_no)
);
create index if not exists content_versions_entity_idx on public.content_versions (entity_type, entity_id, version_no desc);

create table if not exists public.admin_activity_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_email text,
  action      text not null check (char_length(action) <= 80),
  entity_type text,
  entity_id   text,
  summary     text check (char_length(summary) <= 300),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_activity_logs_created_idx on public.admin_activity_logs (created_at desc);
create index if not exists admin_activity_logs_action_idx on public.admin_activity_logs (action, created_at desc);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('contact_message','publish_success','publish_failure','upload_failure','security','info')),
  title       text not null check (char_length(title) <= 200),
  body        text check (char_length(body) <= 1000),
  entity_type text,
  entity_id   text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_unread_idx on public.notifications (is_read, created_at desc);

-- Scheduled updates to already-published projects (applied by pg_cron).
create table if not exists public.scheduled_updates (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null default 'project' check (entity_type = 'project'),
  entity_id   uuid not null references public.projects (id) on delete cascade,
  payload     jsonb not null check (jsonb_typeof(payload) = 'object'),
  run_at      timestamptz not null,
  status      text not null default 'pending' check (status in ('pending', 'applied', 'failed', 'cancelled')),
  error       text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  applied_at  timestamptz
);
create index if not exists scheduled_updates_due_idx on public.scheduled_updates (run_at) where status = 'pending';

-- Privacy-conscious analytics: no IPs, no cookies, daily-rotating visitor hash.
create table if not exists public.analytics_events (
  id            bigint generated always as identity primary key,
  event_type    text not null constraint analytics_events_event_type_check
                  check (event_type in ('page_view','section_view','project_view','resume_download','contact_submit','outbound_click','assistant_question')),
  path          text check (char_length(path) <= 300),
  section       text check (char_length(section) <= 40),
  project_slug  text check (char_length(project_slug) <= 120),
  referrer_host text check (char_length(referrer_host) <= 255),
  device        text not null default 'unknown' check (device in ('mobile','tablet','desktop','unknown')),
  visitor_hash  text check (char_length(visitor_hash) <= 64),
  created_at    timestamptz not null default now()
);
create index if not exists analytics_events_created_idx on public.analytics_events (created_at);
create index if not exists analytics_events_type_created_idx on public.analytics_events (event_type, created_at);

-- Fixed-window rate limiting for Edge Functions (service role only).
create table if not exists private.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

-- -----------------------------------------------------------------------------
-- Upgrades for databases created before these features existed (no-ops otherwise)
-- -----------------------------------------------------------------------------
alter table public.site_settings add column if not exists assistant_enabled boolean not null default false;
alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
alter table public.analytics_events add constraint analytics_events_event_type_check
  check (event_type in ('page_view','section_view','project_view','resume_download','contact_submit','outbound_click','assistant_question'));
