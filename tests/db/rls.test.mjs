// Database-level security and CMS behaviour tests.
// Runs the real migration files in PGlite (PostgreSQL compiled to WASM).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, rows, ADMIN_ID } from './harness.mjs';

let db;
before(async () => { db = await createDb(); });

const denied = async (who, sql, params) => {
  await assert.rejects(() => rows(db, who, sql, params), /permission denied|row-level security|Not authorized|not authorized|violates/i);
};
const affected = (who, sql, params) => as(db, who, async (tx) => (await tx.query(sql, params)).affectedRows ?? 0);

// ---------------------------------------------------------------- public reads
test('anon sees only published projects', async () => {
  await db.exec(`insert into public.projects (slug, title, status) values ('secret-draft', 'Secret Draft', 'draft')`);
  const slugs = (await rows(db, 'anon', 'select slug from public.projects')).map((r) => r.slug);
  assert.ok(!slugs.includes('secret-draft'));
  assert.equal(slugs.length, 4);
});

test('scheduled project is hidden until publish_at, visible after (even before cron runs)', async () => {
  await db.exec(`insert into public.projects (slug, title, status, publish_at) values
    ('future-proj', 'Future', 'scheduled', now() + interval '1 day'),
    ('due-proj', 'Due', 'scheduled', now() - interval '1 minute')`);
  const slugs = (await rows(db, 'anon', 'select slug from public.projects')).map((r) => r.slug);
  assert.ok(!slugs.includes('future-proj'));
  assert.ok(slugs.includes('due-proj'));
});

test('project past unpublish_at is hidden', async () => {
  await db.exec(`insert into public.projects (slug, title, status, unpublish_at) values ('expired', 'Expired', 'published', now() - interval '1 minute')`);
  const r = await rows(db, 'anon', `select slug from public.projects where slug = 'expired'`);
  assert.equal(r.length, 0);
});

test('images/technologies of draft projects are hidden from anon', async () => {
  await db.exec(`insert into public.project_images (project_id, kind, storage_path)
                 select id, 'screenshot', 'projects/x/a.webp' from public.projects where slug = 'secret-draft'`);
  const r = await rows(db, 'anon', `select * from public.project_images`);
  assert.equal(r.length, 0);
});

test('draft education entries are hidden from anon', async () => {
  const r = await rows(db, 'anon', 'select degree from public.education');
  assert.deepEqual(r.map((x) => x.degree), ['B.Tech']);
});

test('anon cannot read contact messages, drafts, versions, logs, analytics, admin list', async () => {
  for (const t of ['contact_messages']) await denied('anon', `select * from public.${t}`);
  for (const t of ['content_drafts', 'content_versions', 'admin_activity_logs', 'analytics_events', 'admin_users', 'notifications', 'scheduled_updates']) {
    assert.equal((await rows(db, 'anon', `select * from public.${t}`)).length, 0, t);
  }
});

test('profile draft is not exposed publicly', async () => {
  await as(db, 'admin', (tx) => tx.query(`insert into public.content_drafts (entity_type, data) values ('profile', '{"hero_headline":"UNPUBLISHED"}')`));
  const p = await rows(db, 'anon', 'select hero_headline from public.profiles');
  assert.notEqual(p[0].hero_headline, 'UNPUBLISHED');
  assert.equal((await rows(db, 'anon', 'select * from public.content_drafts')).length, 0);
});

// ---------------------------------------------------------------- unauthorized writes
test('anon cannot modify any portfolio content', async () => {
  await denied('anon', `insert into public.projects (slug, title) values ('hack', 'Hack')`);
  await denied('anon', `update public.profiles set full_name = 'Hacked'`);
  await denied('anon', `delete from public.skills`);
  await denied('anon', `insert into public.contact_messages (name, email, message) values ('a','a@b.co','hello there friend')`);
  await denied('anon', `insert into public.admin_users (user_id, email) values ('${ADMIN_ID}', 'x@y.z')`);
});

test('signed-in non-admin cannot modify content (RLS, not just UI)', async () => {
  assert.equal(await affected('user', `update public.profiles set full_name = 'Hacked'`), 0);
  assert.equal(await affected('user', `delete from public.projects`), 0);
  await denied('user', `insert into public.projects (slug, title) values ('hack', 'Hack')`);
  await denied('user', `insert into public.admin_users (user_id, email) values ('22222222-2222-4222-8222-222222222222', 'me@x.co')`);
  await denied('user', `select public.save_project(null, '{"slug":"x","title":"x"}')`);
  await denied('user', `select public.dashboard_stats()`);
  await denied('user', `select public.restore_version(1)`);
  await denied('user', `select public.reorder_items('projects', array[]::uuid[])`);
  await denied('anon', `select public.analytics_summary(now() - interval '7 days', now())`);
  assert.equal((await rows(db, 'user', 'select id from public.contact_messages')).length, 0);
});

test('non-admin cannot call internal scheduler or rate-limit functions', async () => {
  await denied('anon', `select private.process_scheduled_content()`);
  await denied('user', `select public.hit_rate_limit('k', 1, 60)`);
  await denied('anon', `select public.run_scheduled_now()`);
});

test('activity log and version history are append-only even for admins', async () => {
  await denied('admin', `insert into public.admin_activity_logs (action) values ('fake')`);
  await denied('admin', `delete from public.content_versions`);
  await denied('admin', `update public.admin_activity_logs set action = 'x'`);
});

// ---------------------------------------------------------------- admin CRUD
let projectId;
test('admin creates a project with technologies and images atomically', async () => {
  const skills = await rows(db, 'admin', `select id from public.skills where name in ('Python','LangGraph') order by name`);
  const [p] = await rows(db, 'admin', `select * from public.save_project(null, $1, $2, $3)`, [
    JSON.stringify({ slug: 'multi-agent-research', title: 'Multi-Agent Research Assistant', status: 'draft',
      key_features: ['Planner agent', 'Critic agent'], metrics: [], resources: [{ label: 'Paper', url: 'https://example.com/paper' }] }),
    skills.map((s) => s.id),
    JSON.stringify([{ kind: 'screenshot', storage_path: 'projects/mar/1.webp', alt_text: 'UI' },
                    { kind: 'architecture', storage_path: 'projects/mar/arch.webp', alt_text: 'Diagram' }]),
  ]);
  projectId = p.id;
  assert.equal(p.status, 'draft');
  assert.deepEqual(p.key_features, ['Planner agent', 'Critic agent']);
  const techs = await rows(db, 'admin', 'select * from public.project_technologies where project_id = $1', [projectId]);
  assert.equal(techs.length, 2);
  const imgs = await rows(db, 'admin', 'select * from public.project_images where project_id = $1', [projectId]);
  assert.equal(imgs.length, 2);
  assert.equal((await rows(db, 'anon', `select * from public.projects where id = $1`, [projectId])).length, 0, 'draft invisible');
});

test('admin edits, publishes and unpublishes a project; changes appear publicly', async () => {
  const [cur] = await rows(db, 'admin', 'select revision from public.projects where id = $1', [projectId]);
  await rows(db, 'admin', `select public.save_project($1, $2, null, null, $3)`,
    [projectId, JSON.stringify({ slug: 'multi-agent-research', title: 'Multi-Agent Research Assistant v2', status: 'published' }), cur.revision]);
  let pub = await rows(db, 'anon', 'select title, published_at from public.projects where id = $1', [projectId]);
  assert.equal(pub[0].title, 'Multi-Agent Research Assistant v2');
  assert.ok(pub[0].published_at);
  // children untouched when null passed
  assert.equal((await rows(db, 'anon', 'select * from public.project_images where project_id = $1', [projectId])).length, 2);
  await rows(db, 'admin', `update public.projects set status = 'draft' where id = $1`, [projectId]);
  pub = await rows(db, 'anon', 'select title from public.projects where id = $1', [projectId]);
  assert.equal(pub.length, 0);
});

test('stale editor save is rejected (optimistic concurrency)', async () => {
  await assert.rejects(() => rows(db, 'admin', `select public.save_project($1, $2, null, null, 1)`,
    [projectId, JSON.stringify({ slug: 'multi-agent-research', title: 'Stale' })]), /changed elsewhere/);
});

test('invalid data is rejected by constraints', async () => {
  const bad = [
    { slug: 'Bad Slug!', title: 'x' },
    { slug: 'ok-slug', title: '' },
    { slug: 'ok-slug2', title: 'x', github_url: 'javascript:alert(1)' },
    { slug: 'ok-slug3', title: 'x', resources: [{ label: 'x', url: 'javascript:alert(1)' }] },
    { slug: 'ok-slug4', title: 'x', status: 'scheduled' },
    { slug: 'skin-lesion-classification', title: 'Duplicate slug' },
  ];
  for (const b of bad) {
    await assert.rejects(() => rows(db, 'admin', `select public.save_project(null, $1)`, [JSON.stringify(b)]), undefined, JSON.stringify(b));
  }
  await assert.rejects(() => rows(db, 'admin', `insert into public.skills (category_id, name) select category_id, 'python' from public.skills limit 1`), /duplicate/);
  await assert.rejects(() => rows(db, 'admin', `insert into public.project_images (project_id, kind, storage_path) values ($1, 'screenshot', '../../etc/passwd')`, [projectId]));
});

test('admin manages skills, experience and certifications', async () => {
  const [cat] = await rows(db, 'admin', `insert into public.skill_categories (name, slug) values ('AI Frameworks', 'ai-frameworks') returning id`);
  const [s] = await rows(db, 'admin', `insert into public.skills (category_id, name, level) values ($1, 'CrewAI', 'exploring') returning id`, [cat.id]);
  await rows(db, 'admin', `update public.skills set level = 'familiar', is_visible = false where id = $1`, [s.id]);
  assert.equal((await rows(db, 'anon', `select * from public.skills where id = $1`, [s.id])).length, 0, 'hidden skill');
  await rows(db, 'admin', `insert into public.experience (company, role_title, employment_type, start_date, status) values ('Acme', 'AI Engineer', 'full_time', '2026-07-01', 'published')`);
  assert.ok((await rows(db, 'anon', `select * from public.experience where company = 'Acme'`)).length === 1);
  await rows(db, 'admin', `insert into public.certifications (name, issuer, status, verify_url) values ('Test Cert', 'Org', 'published', 'https://example.com/v')`);
  assert.ok((await rows(db, 'anon', `select * from public.certifications where name = 'Test Cert'`)).length === 1);
  await assert.rejects(() => rows(db, 'admin', `insert into public.experience (company, role_title, start_date, end_date) values ('X', 'Y', '2026-01-01', '2025-01-01')`));
});

test('reorder updates sort_order without creating versions', async () => {
  const before = (await rows(db, 'admin', `select count(*)::int c from public.content_versions`))[0].c;
  const ids = (await rows(db, 'admin', `select id from public.certifications order by sort_order desc`)).map((r) => r.id);
  await rows(db, 'admin', `select public.reorder_items('certifications', $1)`, [ids]);
  const first = await rows(db, 'admin', `select id from public.certifications order by sort_order limit 1`);
  assert.equal(first[0].id, ids[0]);
  const after = (await rows(db, 'admin', `select count(*)::int c from public.content_versions`))[0].c;
  assert.equal(after, before);
});

// ---------------------------------------------------------------- drafts, versions, logs
test('profile draft → publish → version captured → restore', async () => {
  await rows(db, 'admin', `select public.publish_draft('profile')`);
  assert.equal((await rows(db, 'anon', 'select hero_headline from public.profiles'))[0].hero_headline, 'UNPUBLISHED');
  const versions = await rows(db, 'admin', `select id, snapshot from public.content_versions where entity_type = 'profile' order by version_no desc`);
  assert.ok(versions.length >= 1);
  assert.equal(versions[0].snapshot.hero_headline, 'Engineering Intelligent Systems. Building the Future with AI.');
  await rows(db, 'admin', `select public.restore_version($1)`, [versions[0].id]);
  assert.equal((await rows(db, 'anon', 'select hero_headline from public.profiles'))[0].hero_headline,
    'Engineering Intelligent Systems. Building the Future with AI.');
});

test('deleted project can be restored (as draft) with children', async () => {
  await rows(db, 'admin', `delete from public.projects where id = $1`, [projectId]);
  const [v] = await rows(db, 'admin', `select id from public.content_versions where entity_type = 'project' and entity_id = $1 and change_kind = 'delete'`, [projectId]);
  assert.ok(v);
  await rows(db, 'admin', `select public.restore_version($1)`, [v.id]);
  const [p] = await rows(db, 'admin', `select status, title from public.projects where id = $1`, [projectId]);
  assert.equal(p.status, 'draft');
  assert.equal((await rows(db, 'admin', `select * from public.project_images where project_id = $1`, [projectId])).length, 2);
  assert.equal((await rows(db, 'admin', `select * from public.project_technologies where project_id = $1`, [projectId])).length, 2);
});

test('activity log records actions with the acting administrator', async () => {
  const logs = await rows(db, 'admin', `select action, actor_email from public.admin_activity_logs order by id`);
  const actions = logs.map((l) => l.action);
  for (const a of ['project.created', 'project.published', 'project.unpublished', 'project.deleted', 'skill.created',
                   'profile.updated', 'certification.created', 'version.restored']) {
    assert.ok(actions.includes(a), `missing ${a}`);
  }
  const created = await rows(db, 'admin', `select actor_email, actor_id from public.admin_activity_logs where action = 'project.created' and entity_id = $1`, [projectId]);
  assert.equal(created[0].actor_email, 'admin@example.com');
  assert.equal(created[0].actor_id, ADMIN_ID);
  // rows written outside an API session (fixtures, cron) are attributed to "system"
  assert.ok(logs.filter((l) => l.action === 'project.created' && l.actor_email === 'system').length > 0);
  await rows(db, 'admin', `select public.log_auth_event('login')`);
  await rows(db, 'user', `select public.log_auth_event('login')`);
  const auth = await rows(db, 'admin', `select action from public.admin_activity_logs where action like 'auth.%'`);
  assert.deepEqual(auth.map((a) => a.action).sort(), ['auth.login', 'auth.unauthorized_access']);
});

// ---------------------------------------------------------------- scheduling
test('scheduler publishes due projects, unpublishes expired ones and applies scheduled updates', async () => {
  const [p] = await rows(db, 'admin', `select * from public.save_project(null, $1)`,
    [JSON.stringify({ slug: 'sched-test', title: 'Sched', status: 'scheduled', publish_at: new Date(Date.now() + 3600e3).toISOString() })]);
  // simulate time passing
  await db.query(`update public.projects set publish_at = now() - interval '1 second' where id = $1`, [p.id]);
  await db.query(`update public.projects set status = 'published', unpublish_at = now() - interval '1 second' where slug = 'expired'`);
  await db.query(`insert into public.scheduled_updates (entity_id, payload, run_at) values ($1, $2, now() - interval '1 second')`,
    [p.id, JSON.stringify({ project: { slug: 'sched-test', title: 'Sched (updated)', status: 'published' } })]);
  await db.query(`insert into public.scheduled_updates (entity_id, payload, run_at) values ($1, $2, now() - interval '1 second')`,
    [p.id, JSON.stringify({ project: { slug: 'INVALID SLUG', title: 'x' } })]);
  const [{ process_scheduled_content: res }] = (await db.query(`select private.process_scheduled_content()`)).rows;
  assert.equal(res.published, 2); // sched-test + due-proj
  assert.equal(res.unpublished, 1);
  assert.equal(res.updates_applied, 1);
  assert.equal(res.failed, 1);
  const [after] = await rows(db, 'anon', `select title, status from public.projects where id = $1`, [p.id]);
  assert.equal(after.title, 'Sched (updated)');
  const failed = await rows(db, 'admin', `select status, error from public.scheduled_updates where status = 'failed'`);
  assert.equal(failed.length, 1);
  const notes = await rows(db, 'admin', `select kind from public.notifications`);
  assert.ok(notes.some((n) => n.kind === 'publish_failure'));
  assert.ok(notes.some((n) => n.kind === 'publish_success'));
});

test('cron job is registered', async () => {
  const jobs = await db.query(`select jobname from cron.job`);
  assert.ok(jobs.rows.some((j) => j.jobname === 'process-scheduled-content'));
});

// ---------------------------------------------------------------- contact, resumes, analytics
test('contact message inserted by service role notifies admin; admin can triage', async () => {
  await rows(db, 'service', `insert into public.contact_messages (name, email, subject, message) values ('Recruiter', 'r@corp.com', 'Role', 'We would like to talk to you.')`);
  const notes = await rows(db, 'admin', `select * from public.notifications where kind = 'contact_message'`);
  assert.equal(notes.length, 1);
  const [m] = await rows(db, 'admin', `select id, status from public.contact_messages`);
  assert.equal(m.status, 'unread');
  await rows(db, 'admin', `update public.contact_messages set status = 'archived' where id = $1`, [m.id]);
  // the salted IP hash used for rate limiting is not readable even by admins
  await assert.rejects(() => rows(db, 'admin', 'select ip_hash from public.contact_messages'), /permission denied/);
  await assert.rejects(() => rows(db, 'admin', 'select * from public.contact_messages'), /permission denied/);
  await assert.rejects(() => rows(db, 'service', `insert into public.contact_messages (name, email, message) values ('x', 'not-an-email', 'hello there friend')`));
  await assert.rejects(() => rows(db, 'service', `insert into public.contact_messages (name, email, message) values ('x', 'a@b.co', 'short')`));
});

test('only the default active resume is public; single default enforced', async () => {
  const [a] = await rows(db, 'admin', `insert into public.resumes (title, storage_path, file_size) values ('AI Engineer', 'resumes/a.pdf', 1000) returning id`);
  const [b] = await rows(db, 'admin', `insert into public.resumes (title, storage_path, file_size, is_active) values ('Backend', 'resumes/b.pdf', 1000, true) returning id`);
  assert.equal((await rows(db, 'anon', `select * from public.resumes`)).length, 0);
  await rows(db, 'admin', `select public.set_default_resume($1)`, [a.id]);
  await rows(db, 'admin', `select public.set_default_resume($1)`, [b.id]);
  const pub = await rows(db, 'anon', `select id from public.resumes`);
  assert.deepEqual(pub.map((r) => r.id), [b.id]);
  await rows(db, 'admin', `update public.resumes set is_active = false where id = $1`, [a.id]);
  await assert.rejects(() => rows(db, 'admin', `select public.set_default_resume($1)`, [a.id]), /active/);
  await assert.rejects(() => rows(db, 'admin', `update public.resumes set is_active = false where id = $1`, [b.id]));
});

test('analytics summary aggregates real events only', async () => {
  await rows(db, 'service', `insert into public.analytics_events (event_type, path, device, visitor_hash, referrer_host) values
    ('page_view', '/', 'desktop', 'h1', 'linkedin.com'), ('page_view', '/', 'mobile', 'h2', null),
    ('page_view', '/', 'mobile', 'h2', null), ('project_view', '/project', 'mobile', 'h2', null),
    ('resume_download', null, 'desktop', 'h1', null)`);
  await rows(db, 'service', `update public.analytics_events set project_slug = 'document-qa-chatbot' where event_type = 'project_view'`);
  const [{ analytics_summary: s }] = await rows(db, 'admin', `select public.analytics_summary(now() - interval '7 days', now() + interval '1 minute', 'Asia/Kolkata')`);
  assert.equal(s.page_views, 3);
  assert.equal(s.visitor_days, 2);
  assert.equal(s.resume_downloads, 1);
  assert.equal(s.contact_submissions, 1);
  assert.equal(s.top_projects[0].key, 'document-qa-chatbot');
  assert.ok(s.daily.length >= 7);
  await denied('anon', `insert into public.analytics_events (event_type) values ('page_view')`);
});

test('rate limiter allows N hits per window', async () => {
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await rows(db, 'service', `select public.hit_rate_limit('ip:abc', 3, 3600) ok`))[0].ok);
  assert.deepEqual(results, [true, true, true, false]);
});

test('dashboard stats are real counts', async () => {
  const [{ dashboard_stats: s }] = await rows(db, 'admin', `select public.dashboard_stats()`);
  const [{ c }] = await rows(db, 'admin', `select count(*)::int c from public.projects`);
  assert.equal(s.projects_total, c);
});

test('storage: only admins can write to CMS buckets', async () => {
  await denied('anon', `insert into storage.objects (bucket_id, name) values ('media', 'x.png')`);
  await denied('user', `insert into storage.objects (bucket_id, name) values ('media', 'x.png')`);
  await rows(db, 'admin', `insert into storage.objects (bucket_id, name) values ('media', 'projects/x.webp')`);
  await denied('admin', `insert into storage.objects (bucket_id, name) values ('media', '../evil.png')`);
  assert.equal((await rows(db, 'user', `select * from storage.objects where bucket_id = 'resumes'`)).length, 0);
  const buckets = await db.query(`select id, public from storage.buckets order by id`);
  assert.deepEqual(buckets.rows.map((b) => [b.id, b.public]), [['certificates', true], ['media', true], ['resumes', false]]);
});
