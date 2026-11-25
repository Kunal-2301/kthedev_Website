-- =============================================================================
-- Row Level Security
-- Principle: anon/authenticated visitors can READ published content only.
-- Every write requires public.is_admin(), enforced in the database itself.
-- =============================================================================

-- Enable RLS on every table in public (deny-by-default).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- Not FORCE: SECURITY DEFINER triggers (versions, logs) run as the owner.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
alter table private.rate_limits enable row level security;

-- Helper: (re)create a policy idempotently
create or replace function private.reset_policies(p_table text)
returns void language plpgsql as $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy %I on public.%I', p.policyname, p_table);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Content tables with publication status
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['projects', 'experience', 'education', 'certifications'] loop
    perform private.reset_policies(t);
    execute format($p$create policy "public read published" on public.%I for select to anon, authenticated
                     using (public.is_publicly_visible(status, %s, %s))$p$,
                   t,
                   case when t = 'projects' then 'publish_at' else 'null::timestamptz' end,
                   case when t = 'projects' then 'unpublish_at' else 'null::timestamptz' end);
    execute format('create policy "admin full access" on public.%I for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Project children follow the parent's visibility
select private.reset_policies('project_images');
create policy "public read published" on public.project_images for select to anon, authenticated
  using (exists (select 1 from public.projects p where p.id = project_id
                 and public.is_publicly_visible(p.status, p.publish_at, p.unpublish_at)));
create policy "admin full access" on public.project_images for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

select private.reset_policies('project_technologies');
create policy "public read published" on public.project_technologies for select to anon, authenticated
  using (exists (select 1 from public.projects p where p.id = project_id
                 and public.is_publicly_visible(p.status, p.publish_at, p.unpublish_at)));
create policy "admin full access" on public.project_technologies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Skills: visible skills, plus any skill used by a visible project
-- -----------------------------------------------------------------------------
select private.reset_policies('skill_categories');
create policy "public read visible" on public.skill_categories for select to anon, authenticated
  using (is_visible);
create policy "admin full access" on public.skill_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

select private.reset_policies('skills');
create policy "public read visible" on public.skills for select to anon, authenticated
  using (is_visible or exists (
    select 1 from public.project_technologies pt join public.projects p on p.id = pt.project_id
    where pt.skill_id = skills.id and public.is_publicly_visible(p.status, p.publish_at, p.unpublish_at)));
create policy "admin full access" on public.skills for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Singletons and navigation (live rows are public; drafts are separate)
-- -----------------------------------------------------------------------------
select private.reset_policies('profiles');
create policy "public read" on public.profiles for select to anon, authenticated using (true);
create policy "admin update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

select private.reset_policies('site_settings');
create policy "public read" on public.site_settings for select to anon, authenticated using (true);
create policy "admin update" on public.site_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

select private.reset_policies('nav_items');
create policy "public read visible" on public.nav_items for select to anon, authenticated using (is_visible);
create policy "admin full access" on public.nav_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Resumes: only the default active resume's metadata is public.
-- The file itself is in a private bucket and served via the "resume" function.
-- -----------------------------------------------------------------------------
select private.reset_policies('resumes');
create policy "public read default" on public.resumes for select to anon, authenticated
  using (is_default and is_active);
create policy "admin full access" on public.resumes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Admin-only tables
-- -----------------------------------------------------------------------------
-- Contact messages: NO insert policy — only the Edge Function (service role) inserts.
select private.reset_policies('contact_messages');
create policy "admin read" on public.contact_messages for select to authenticated using (public.is_admin());
create policy "admin update" on public.contact_messages for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.contact_messages for delete to authenticated using (public.is_admin());

select private.reset_policies('content_drafts');
create policy "admin full access" on public.content_drafts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Version history and activity logs are append-only (written by triggers).
select private.reset_policies('content_versions');
create policy "admin read" on public.content_versions for select to authenticated using (public.is_admin());

select private.reset_policies('admin_activity_logs');
create policy "admin read" on public.admin_activity_logs for select to authenticated using (public.is_admin());

select private.reset_policies('notifications');
create policy "admin read" on public.notifications for select to authenticated using (public.is_admin());
create policy "admin insert" on public.notifications for insert to authenticated with check (public.is_admin());
create policy "admin update" on public.notifications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.notifications for delete to authenticated using (public.is_admin());

select private.reset_policies('scheduled_updates');
create policy "admin full access" on public.scheduled_updates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

select private.reset_policies('analytics_events');
create policy "admin read" on public.analytics_events for select to authenticated using (public.is_admin());

-- Admins can see the admin list; nobody can modify it through the API.
select private.reset_policies('admin_users');
create policy "admin read" on public.admin_users for select to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Table privileges: belt and braces on top of RLS
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
revoke insert, update, delete on public.admin_users, public.content_versions, public.admin_activity_logs,
                                public.analytics_events from authenticated;
revoke insert, delete on public.profiles, public.site_settings from authenticated;
revoke all on private.rate_limits from anon, authenticated;

-- Hide internal columns. A column-level REVOKE does not override a table-level
-- grant, so replace the table grant with an explicit column list (no ip_hash).
revoke select on public.contact_messages from anon, authenticated;
grant select (id, name, email, subject, message, status, created_at, read_at) on public.contact_messages to authenticated;
