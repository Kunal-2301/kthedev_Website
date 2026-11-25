-- =============================================================================
-- Functions, triggers and RPCs
-- Every SECURITY DEFINER function pins search_path and checks authorization.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorization helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function private.require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end $$;

-- Single source of truth for "is this row public right now?"
-- Public visibility does not depend on the cron job having run yet.
create or replace function public.is_publicly_visible(p_status public.content_status, p_publish_at timestamptz, p_unpublish_at timestamptz)
returns boolean
language sql stable set search_path = ''
as $$
  select (p_status = 'published' or (p_status = 'scheduled' and p_publish_at is not null and p_publish_at <= now()))
     and (p_unpublish_at is null or p_unpublish_at > now());
$$;

-- -----------------------------------------------------------------------------
-- Validation helpers for JSON columns
-- -----------------------------------------------------------------------------
create or replace function private.valid_link_array(p jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(char_length(e->>'label'), 0) not between 1 and 80
       or coalesce(e->>'url', '') !~* '^https://[^\s<>"''`]+$'
       or char_length(e->>'url') > 2048);
$$;

create or replace function private.valid_metric_array(p jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 12 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(char_length(e->>'label'), 0) not between 1 and 60
       or coalesce(char_length(e->>'value'), 0) not between 1 and 40
       or coalesce(char_length(e->>'description'), 0) > 300);
$$;

do $$ begin
  alter table public.projects add constraint projects_resources_valid check (private.valid_link_array(resources));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.projects add constraint projects_metrics_valid check (private.valid_metric_array(metrics));
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Timestamps
-- -----------------------------------------------------------------------------
create or replace function private.touch_row()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','site_settings','nav_items','skill_categories','skills','projects',
                           'experience','education','certifications','resumes','content_drafts']
  loop
    execute format('drop trigger if exists touch_row on public.%I', t);
    execute format('create trigger touch_row before update on public.%I for each row execute function private.touch_row()', t);
  end loop;
end $$;

-- Projects: publication bookkeeping
create or replace function private.projects_before_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status in ('draft', 'archived') then
    new.publish_at := null;
  end if;
  return new;
end $$;

drop trigger if exists projects_before_write on public.projects;
create trigger projects_before_write before insert or update on public.projects
  for each row execute function private.projects_before_write();

-- -----------------------------------------------------------------------------
-- Version history (snapshot OLD row before significant update / delete)
-- -----------------------------------------------------------------------------
create or replace function private.capture_version()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_type   text := tg_argv[0];
  v_old    jsonb := to_jsonb(old);
  v_ignore text[] := array['updated_at', 'updated_by', 'sort_order'];
  v_next   integer;
begin
  if tg_op = 'UPDATE' and (v_old - v_ignore) = (to_jsonb(new) - v_ignore) then
    return new;  -- reorder / touch only: not a significant change
  end if;

  if v_type = 'project' then
    v_old := v_old || jsonb_build_object(
      '_technologies', coalesce((select jsonb_agg(pt.skill_id order by pt.sort_order)
                                 from public.project_technologies pt where pt.project_id = old.id), '[]'::jsonb),
      '_images', coalesce((select jsonb_agg(jsonb_build_object('id', pi.id, 'kind', pi.kind, 'storage_path', pi.storage_path,
                                                               'alt_text', pi.alt_text, 'caption', pi.caption) order by pi.kind, pi.sort_order)
                           from public.project_images pi where pi.project_id = old.id), '[]'::jsonb));
  end if;

  perform pg_advisory_xact_lock(hashtext(v_type || ':' || old.id::text));
  select coalesce(max(version_no), 0) + 1 into v_next
    from public.content_versions where entity_type = v_type and entity_id = old.id::text;

  insert into public.content_versions (entity_type, entity_id, version_no, snapshot, change_kind, changed_by)
  values (v_type, old.id::text, v_next, v_old, lower(tg_op), auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values ('projects','project'), ('profiles','profile'), ('site_settings','settings'),
                                 ('skills','skill'), ('experience','experience'), ('education','education'),
                                 ('certifications','certification'), ('resumes','resume')) v(tbl, typ)
  loop
    execute format('drop trigger if exists capture_version on public.%I', r.tbl);
    execute format('create trigger capture_version before update or delete on public.%I
                    for each row execute function private.capture_version(%L)', r.tbl, r.typ);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Activity log (AFTER triggers + explicit RPC for auth events)
-- -----------------------------------------------------------------------------
create or replace function private.write_log(p_action text, p_entity_type text, p_entity_id text, p_summary text, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.admin_activity_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(),
          coalesce((select email from public.admin_users where user_id = auth.uid()), case when auth.uid() is null then 'system' end),
          p_action, p_entity_type, p_entity_id, left(p_summary, 300), coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function private.log_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_type   text := tg_argv[0];
  v_row    jsonb;
  v_old    jsonb;
  v_action text;
  v_label  text;
  v_ignore text[] := array['updated_at', 'updated_by', 'sort_order', 'revision'];
begin
  if tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    v_action := case when v_type = 'resume' then 'uploaded' else 'created' end;
  elsif tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_action := 'deleted';
  else
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    if (v_old - v_ignore) = (v_row - v_ignore) then
      return null;  -- ignore pure reorders
    end if;
    v_action := 'updated';
    if (v_row ? 'status') and (v_row->>'status') is distinct from (v_old->>'status') then
      v_action := case v_row->>'status'
                    when 'published' then 'published'
                    when 'scheduled' then 'scheduled'
                    when 'archived'  then 'archived'
                    when 'read'      then 'read'
                    else 'unpublished' end;
    elsif v_type = 'resume' and (v_row->>'storage_path') is distinct from (v_old->>'storage_path') then
      v_action := 'replaced';
    elsif v_type = 'resume' and (v_row->>'is_default')::boolean and not coalesce((v_old->>'is_default')::boolean, false) then
      v_action := 'set_default';
    end if;
  end if;

  v_label := coalesce(v_row->>'title', v_row->>'name', v_row->>'label', v_row->>'role_title',
                      v_row->>'degree', v_row->>'full_name', v_row->>'site_title', v_row->>'subject', '');
  if v_type = 'experience' then v_label := v_label || ' @ ' || coalesce(v_row->>'company', ''); end if;

  perform private.write_log(v_type || '.' || v_action, v_type, v_row->>'id', v_label);
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values ('projects','project'), ('profiles','profile'), ('site_settings','settings'),
                                 ('skills','skill'), ('skill_categories','skill_category'), ('experience','experience'),
                                 ('education','education'), ('certifications','certification'), ('resumes','resume'),
                                 ('nav_items','navigation')) v(tbl, typ)
  loop
    execute format('drop trigger if exists log_activity on public.%I', r.tbl);
    execute format('create trigger log_activity after insert or update or delete on public.%I
                    for each row execute function private.log_activity(%L)', r.tbl, r.typ);
  end loop;
end $$;

-- Authentication events, called by the admin client after sign-in / sign-out.
create or replace function public.log_auth_event(p_event text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if public.is_admin() then
    if p_event not in ('login', 'logout', 'password_changed', 'session_expired') then
      raise exception 'Invalid event' using errcode = '22023';
    end if;
    perform private.write_log('auth.' || p_event, 'auth', auth.uid()::text, null);
  else
    -- A signed-in but non-admin account tried to use the dashboard.
    perform private.write_log('auth.unauthorized_access', 'auth', auth.uid()::text,
                              (select email from auth.users where id = auth.uid()));
    insert into public.notifications (kind, title, body)
    values ('security', 'Unauthorized dashboard access attempt',
            'A non-administrator account signed in and was denied access.');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Notifications for new contact messages
-- -----------------------------------------------------------------------------
create or replace function private.notify_contact_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (kind, title, body, entity_type, entity_id)
  values ('contact_message', 'New message from ' || left(new.name, 80),
          left(coalesce(nullif(new.subject, ''), new.message), 200), 'contact_message', new.id::text);
  return null;
end $$;

drop trigger if exists notify_contact_message on public.contact_messages;
create trigger notify_contact_message after insert on public.contact_messages
  for each row execute function private.notify_contact_message();

-- -----------------------------------------------------------------------------
-- Project save (atomic: row + technologies + images, optimistic concurrency)
-- -----------------------------------------------------------------------------
create or replace function private.apply_project(p_id uuid, p_data jsonb, p_technologies uuid[], p_images jsonb, p_expected_revision integer)
returns public.projects
language plpgsql security definer set search_path = ''
as $$
declare
  r     public.projects;
  v_row public.projects;
  v_img jsonb;
  v_i   integer := 0;
begin
  r := jsonb_populate_record(null::public.projects, p_data);

  if p_id is null then
    insert into public.projects (slug, title, short_description, description_md, problem_md, solution_md,
      architecture_md, implementation_md, key_features, challenges, category, project_status, github_url,
      demo_url, docs_url, resources, metrics, cover_image_path, cover_alt, is_featured, sort_order, status,
      publish_at, unpublish_at, seo_title, seo_description)
    values (r.slug, r.title, coalesce(r.short_description, ''), coalesce(r.description_md, ''), coalesce(r.problem_md, ''),
      coalesce(r.solution_md, ''), coalesce(r.architecture_md, ''), coalesce(r.implementation_md, ''),
      coalesce(r.key_features, '{}'), coalesce(r.challenges, '{}'), r.category, coalesce(r.project_status, 'completed'),
      r.github_url, r.demo_url, r.docs_url, coalesce(r.resources, '[]'::jsonb), coalesce(r.metrics, '[]'::jsonb),
      r.cover_image_path, r.cover_alt, coalesce(r.is_featured, false),
      coalesce(r.sort_order, (select coalesce(max(sort_order), 0) + 1 from public.projects)),
      coalesce(r.status, 'draft'), r.publish_at, r.unpublish_at, r.seo_title, r.seo_description)
    returning * into v_row;
  else
    update public.projects p set
      slug = r.slug, title = r.title, short_description = coalesce(r.short_description, ''),
      description_md = coalesce(r.description_md, ''), problem_md = coalesce(r.problem_md, ''),
      solution_md = coalesce(r.solution_md, ''), architecture_md = coalesce(r.architecture_md, ''),
      implementation_md = coalesce(r.implementation_md, ''), key_features = coalesce(r.key_features, '{}'),
      challenges = coalesce(r.challenges, '{}'), category = r.category,
      project_status = coalesce(r.project_status, 'completed'), github_url = r.github_url, demo_url = r.demo_url,
      docs_url = r.docs_url, resources = coalesce(r.resources, '[]'::jsonb), metrics = coalesce(r.metrics, '[]'::jsonb),
      cover_image_path = r.cover_image_path, cover_alt = r.cover_alt, is_featured = coalesce(r.is_featured, false),
      status = coalesce(r.status, p.status), publish_at = r.publish_at, unpublish_at = r.unpublish_at,
      seo_title = r.seo_title, seo_description = r.seo_description, revision = p.revision + 1
    where p.id = p_id and (p_expected_revision is null or p.revision = p_expected_revision)
    returning * into v_row;

    if not found then
      if exists (select 1 from public.projects where id = p_id) then
        raise exception 'This project was changed elsewhere (another tab or a scheduled update). Reload to get the latest version.'
          using errcode = '40001';
      end if;
      raise exception 'Project not found' using errcode = 'P0002';
    end if;
  end if;

  -- Technologies (relational, ordered)
  if p_technologies is not null then
    delete from public.project_technologies where project_id = v_row.id;
    insert into public.project_technologies (project_id, skill_id, sort_order)
    select v_row.id, t.skill_id, t.ord::integer
    from unnest(p_technologies) with ordinality as t(skill_id, ord)
    on conflict do nothing;
  end if;

  -- Images (ordered per kind)
  if p_images is not null then
    if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 40 then
      raise exception 'Invalid images payload' using errcode = '22023';
    end if;
    delete from public.project_images where project_id = v_row.id;
    for v_img in select * from jsonb_array_elements(p_images) loop
      v_i := v_i + 1;
      insert into public.project_images (id, project_id, kind, storage_path, alt_text, caption, sort_order)
      values (coalesce((v_img->>'id')::uuid, gen_random_uuid()), v_row.id, v_img->>'kind', v_img->>'storage_path',
              coalesce(v_img->>'alt_text', ''), nullif(v_img->>'caption', ''), v_i);
    end loop;
  end if;

  return v_row;
end $$;

create or replace function public.save_project(p_id uuid, p_data jsonb, p_technologies uuid[] default null,
                                               p_images jsonb default null, p_expected_revision integer default null)
returns public.projects
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Invalid project payload' using errcode = '22023';
  end if;
  if (p_data->>'status') = 'scheduled' and (p_data->>'publish_at')::timestamptz <= now() then
    raise exception 'Scheduled publish time must be in the future' using errcode = '22023';
  end if;
  return private.apply_project(p_id, p_data, p_technologies, p_images, p_expected_revision);
end $$;

-- -----------------------------------------------------------------------------
-- Ordering
-- -----------------------------------------------------------------------------
create or replace function public.reorder_items(p_table text, p_ids uuid[])
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_table not in ('projects','skills','skill_categories','experience','education','certifications','nav_items') then
    raise exception 'Table not orderable' using errcode = '22023';
  end if;
  execute format('update public.%I t set sort_order = o.ord from unnest($1) with ordinality as o(id, ord) where t.id = o.id', p_table)
    using p_ids;
end $$;

-- -----------------------------------------------------------------------------
-- Singleton drafts (profile / settings): publish draft → live row
-- -----------------------------------------------------------------------------
create or replace function public.publish_draft(p_entity text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_data  jsonb;
  v_table text;
  v_cols  text;
  v_sel   text;
begin
  perform private.require_admin();
  v_table := case p_entity when 'profile' then 'profiles' when 'settings' then 'site_settings' end;
  if v_table is null then raise exception 'Unknown entity' using errcode = '22023'; end if;

  select data into v_data from public.content_drafts where entity_type = p_entity for update;
  if not found then raise exception 'There is no draft to publish' using errcode = 'P0002'; end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols, v_sel
  from information_schema.columns
  where table_schema = 'public' and table_name = v_table
    and column_name not in ('id', 'created_at', 'updated_at', 'updated_by')
    and v_data ? column_name;

  if v_cols is not null then
    execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where t.id = 1',
                   v_table, v_cols, v_sel, v_table) using v_data;
  end if;
  delete from public.content_drafts where entity_type = p_entity;
end $$;

-- -----------------------------------------------------------------------------
-- Version restore
-- -----------------------------------------------------------------------------
create or replace function public.restore_version(p_version_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v       public.content_versions;
  v_table text;
  v_cols  text;
  v_sel   text;
  v_n     integer;
  v_skip  text[] := array['id','created_at','created_by','updated_at','updated_by','revision',
                          'status','publish_at','unpublish_at','published_at','is_default'];
begin
  perform private.require_admin();
  select * into v from public.content_versions where id = p_version_id;
  if not found then raise exception 'Version not found' using errcode = 'P0002'; end if;

  v_table := case v.entity_type
    when 'project' then 'projects' when 'profile' then 'profiles' when 'settings' then 'site_settings'
    when 'skill' then 'skills' when 'experience' then 'experience' when 'education' then 'education'
    when 'certification' then 'certifications' when 'resume' then 'resumes' end;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols, v_sel
  from information_schema.columns
  where table_schema = 'public' and table_name = v_table and column_name <> all (v_skip);

  -- Existing row: restore content, keep current publication state.
  execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r)%s where t.id::text = $2',
                 v_table, v_cols, v_sel, v_table,
                 case when v_table = 'projects' then ', revision = t.revision + 1' else '' end)
    using v.snapshot, v.entity_id;
  get diagnostics v_n = row_count;

  -- Deleted row: re-create it (content tables come back as draft).
  if v_n = 0 then
    execute format('insert into public.%I (id, %s) select r.id, %s from jsonb_populate_record(null::public.%I, $1) r',
                   v_table, v_cols, v_sel, v_table) using v.snapshot;
    if v_table in ('projects','experience','education','certifications') then
      execute format('update public.%I set status = ''draft'' where id::text = $1', v_table) using v.entity_id;
    end if;
  end if;

  if v.entity_type = 'project' then
    delete from public.project_technologies where project_id = v.entity_id::uuid;
    insert into public.project_technologies (project_id, skill_id, sort_order)
    select v.entity_id::uuid, s.id, t.ord
    from jsonb_array_elements_text(coalesce(v.snapshot->'_technologies', '[]'::jsonb)) with ordinality t(skill_id, ord)
    join public.skills s on s.id = t.skill_id::uuid;

    delete from public.project_images where project_id = v.entity_id::uuid;
    insert into public.project_images (project_id, kind, storage_path, alt_text, caption, sort_order)
    select v.entity_id::uuid, i->>'kind', i->>'storage_path', coalesce(i->>'alt_text', ''), i->>'caption', ord
    from jsonb_array_elements(coalesce(v.snapshot->'_images', '[]'::jsonb)) with ordinality t(i, ord);
  end if;

  perform private.write_log('version.restored', v.entity_type, v.entity_id,
                            'Restored version ' || v.version_no, jsonb_build_object('version_id', v.id));
end $$;

-- -----------------------------------------------------------------------------
-- Resumes
-- -----------------------------------------------------------------------------
create or replace function public.set_default_resume(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if not exists (select 1 from public.resumes where id = p_id and is_active) then
    raise exception 'Only an active resume can be the public default' using errcode = '22023';
  end if;
  update public.resumes set is_default = false where is_default and id <> p_id;
  update public.resumes set is_default = true where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
-- Scheduled publishing (invoked every minute by pg_cron — see cron.sql)
-- -----------------------------------------------------------------------------
create or replace function private.process_scheduled_content()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r          record;
  v_pub      integer := 0;
  v_unpub    integer := 0;
  v_applied  integer := 0;
  v_failed   integer := 0;
begin
  -- 1. Scheduled projects that are now due → published
  for r in select id, title from public.projects
           where status = 'scheduled' and publish_at <= now() for update skip locked loop
    begin
      update public.projects set status = 'published', published_at = coalesce(published_at, now()) where id = r.id;
      insert into public.notifications (kind, title, entity_type, entity_id)
      values ('publish_success', 'Scheduled project published: ' || r.title, 'project', r.id::text);
      v_pub := v_pub + 1;
    exception when others then
      insert into public.notifications (kind, title, body, entity_type, entity_id)
      values ('publish_failure', 'Scheduled publishing failed: ' || r.title, left(sqlerrm, 1000), 'project', r.id::text);
      v_failed := v_failed + 1;
    end;
  end loop;

  -- 2. Published projects past their unpublish time → draft
  for r in select id, title from public.projects
           where status in ('published', 'scheduled') and unpublish_at <= now() for update skip locked loop
    begin
      update public.projects set status = 'draft', unpublish_at = null where id = r.id;
      insert into public.notifications (kind, title, entity_type, entity_id)
      values ('info', 'Project automatically unpublished: ' || r.title, 'project', r.id::text);
      v_unpub := v_unpub + 1;
    exception when others then
      insert into public.notifications (kind, title, body, entity_type, entity_id)
      values ('publish_failure', 'Scheduled unpublishing failed: ' || r.title, left(sqlerrm, 1000), 'project', r.id::text);
      v_failed := v_failed + 1;
    end;
  end loop;

  -- 3. Scheduled content updates
  for r in select * from public.scheduled_updates
           where status = 'pending' and run_at <= now() order by run_at for update skip locked loop
    begin
      perform private.apply_project(
        r.entity_id,
        r.payload->'project',
        case when r.payload ? 'technologies'
             then array(select jsonb_array_elements_text(r.payload->'technologies'))::uuid[] end,
        r.payload->'images',
        null);
      update public.scheduled_updates set status = 'applied', applied_at = now(), error = null where id = r.id;
      insert into public.notifications (kind, title, entity_type, entity_id)
      values ('publish_success', 'Scheduled update applied: ' || coalesce(r.payload->'project'->>'title', 'project'),
              'project', r.entity_id::text);
      v_applied := v_applied + 1;
    exception when others then
      update public.scheduled_updates set status = 'failed', error = left(sqlerrm, 1000) where id = r.id;
      insert into public.notifications (kind, title, body, entity_type, entity_id)
      values ('publish_failure', 'Scheduled update failed', left(sqlerrm, 1000), 'project', r.entity_id::text);
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('published', v_pub, 'unpublished', v_unpub, 'updates_applied', v_applied, 'failed', v_failed);
end $$;

-- Admin "run now" button (the cron job does not depend on this).
create or replace function public.run_scheduled_now()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.process_scheduled_content();
end $$;

-- -----------------------------------------------------------------------------
-- Dashboard statistics (real counts only)
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'projects_total',      (select count(*) from public.projects),
    'projects_published',  (select count(*) from public.projects where public.is_publicly_visible(status, publish_at, unpublish_at)),
    'projects_draft',      (select count(*) from public.projects where status = 'draft'),
    'projects_scheduled',  (select count(*) from public.projects where status = 'scheduled' and publish_at > now()),
    'skills_total',        (select count(*) from public.skills),
    'experience_total',    (select count(*) from public.experience),
    'education_total',     (select count(*) from public.education),
    'certifications_total',(select count(*) from public.certifications),
    'messages_unread',     (select count(*) from public.contact_messages where status = 'unread'),
    'resumes_total',       (select count(*) from public.resumes),
    'default_resume',      (select title from public.resumes where is_default),
    'pending_updates',     (select count(*) from public.scheduled_updates where status = 'pending'),
    'has_profile_draft',   exists (select 1 from public.content_drafts where entity_type = 'profile'),
    'has_settings_draft',  exists (select 1 from public.content_drafts where entity_type = 'settings')
  );
end $$;

-- -----------------------------------------------------------------------------
-- Analytics summary (admin only). Visitor hashes rotate daily, so "unique
-- visitors" are counted per day; there is no cross-day tracking by design.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_summary(p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform private.require_admin();
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then p_tz := 'UTC'; end if;

  with ev as (
    select e.*, (e.created_at at time zone p_tz)::date as day
    from public.analytics_events e
    where e.created_at >= p_from and e.created_at < p_to
  ),
  days as (
    select d::date as day
    from generate_series((p_from at time zone p_tz)::date, ((p_to - interval '1 second') at time zone p_tz)::date, interval '1 day') d
  )
  select jsonb_build_object(
    'page_views',          (select count(*) from ev where event_type = 'page_view'),
    'visitor_days',        (select count(distinct (visitor_hash, day)) from ev where event_type = 'page_view' and visitor_hash is not null),
    'resume_downloads',    (select count(*) from ev where event_type = 'resume_download'),
    'project_views',       (select count(*) from ev where event_type = 'project_view'),
    'outbound_clicks',     (select count(*) from ev where event_type = 'outbound_click'),
    'assistant_questions', (select count(*) from ev where event_type = 'assistant_question'),
    'contact_submissions', (select count(*) from public.contact_messages where created_at >= p_from and created_at < p_to),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day,
                       'views', (select count(*) from ev where ev.day = d.day and event_type = 'page_view'),
                       'visitors', (select count(distinct visitor_hash) from ev where ev.day = d.day and event_type = 'page_view'))
                     order by d.day), '[]'::jsonb) from days d),
    'top_projects', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select project_slug as key, count(*) as count from ev
        where event_type = 'project_view' and project_slug is not null
        group by project_slug order by count(*) desc limit 10) x),
    'top_sections', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select section as key, count(*) as count from ev
        where event_type = 'section_view' and section is not null
        group by section order by count(*) desc limit 10) x),
    'referrers', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(referrer_host, 'Direct / none') as key, count(*) as count from ev
        where event_type = 'page_view'
        group by 1 order by count(*) desc limit 10) x),
    'devices', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select device as key, count(*) as count from ev
        where event_type = 'page_view'
        group by device order by count(*) desc) x)
  ) into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Rate limiting (service role only — used by Edge Functions)
-- -----------------------------------------------------------------------------
create or replace function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits   integer;
begin
  insert into private.rate_limits as rl (key, window_start, hits) values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end $$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
-- Pure validators used by CHECK constraints are evaluated as the writing role.
grant execute on function private.valid_link_array(jsonb), private.valid_metric_array(jsonb)
  to anon, authenticated, service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_project(uuid, jsonb, uuid[], jsonb, integer)',
    'public.reorder_items(text, uuid[])',
    'public.publish_draft(text)',
    'public.restore_version(bigint)',
    'public.set_default_resume(uuid)',
    'public.run_scheduled_now()',
    'public.dashboard_stats()',
    'public.analytics_summary(timestamptz, timestamptz, text)',
    'public.log_auth_event(text)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_publicly_visible(public.content_status, timestamptz, timestamptz) to anon, authenticated;
grant usage on schema private to service_role;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
