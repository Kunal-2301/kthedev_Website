// End-to-end CMS tests: real supabase-js client → local Supabase-compatible server →
// real migrations/RLS/RPCs in PGlite. Mirrors the queries the site and dashboard make.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { startServer, ADMIN, NON_ADMIN } from './server.mjs';

let srv; let anon; let admin;
const client = () => createClient(srv.url, 'test-publishable-key', { auth: { persistSession: false, autoRefreshToken: false } });
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

before(async () => {
  srv = await startServer({ port: 0 });
  anon = client();
  admin = client();
});
after(async () => { await srv?.close(); });

const ok = (res) => { assert.equal(res.error, null, res.error?.message); return res.data; };

// 1–5 ------------------------------------------------------------ authentication
test('1. unauthorized users cannot access administrative functions', async () => {
  const r = await anon.rpc('dashboard_stats');
  assert.ok(r.error, 'anon must be rejected');
  const ins = await anon.from('projects').insert({ slug: 'hack', title: 'Hack' });
  assert.ok(ins.error);
  const msgs = await anon.from('contact_messages').select('*');
  assert.ok(msgs.error || msgs.data.length === 0);
});

test('3. invalid credentials are rejected', async () => {
  const r = await client().auth.signInWithPassword({ email: ADMIN.email, password: 'wrong-password' });
  assert.ok(r.error);
  assert.match(r.error.message, /invalid login credentials/i);
});

test('2. valid administrator can log in and is recognised as admin', async () => {
  ok(await admin.auth.signInWithPassword(ADMIN));
  assert.equal(ok(await admin.rpc('is_admin')), true);
  ok(await admin.rpc('log_auth_event', { p_event: 'login' }));
});

test('non-admin account can sign in to Auth but is NOT an admin and cannot write', async () => {
  const u = client();
  ok(await u.auth.signInWithPassword(NON_ADMIN));
  assert.equal(ok(await u.rpc('is_admin')), false);
  const upd = await u.from('profiles').update({ full_name: 'Hacked' }).eq('id', 1).select();
  assert.ok(upd.error || upd.data.length === 0, 'update must not apply');
  const [{ full_name }] = ok(await anon.from('profiles').select('full_name'));
  assert.equal(full_name, 'Kunal Gupta');
});

test('5. logout invalidates the session token', async () => {
  const c = client();
  ok(await c.auth.signInWithPassword(ADMIN));
  const { data: { session } } = await c.auth.getSession();
  await c.auth.signOut();
  const res = await fetch(`${srv.url}/auth/v1/user`, { headers: { Authorization: `Bearer ${session.access_token}`, apikey: 'x' } });
  assert.equal(res.status, 401);
});

// 6–12, 22 ------------------------------------------------------- projects
let project;
test('6/8. create a project as a draft (not visible publicly)', async () => {
  const skills = ok(await admin.from('skills').select('id, name').in('name', ['Python', 'LangGraph', 'FastAPI']));
  project = ok(await admin.rpc('save_project', {
    p_id: null,
    p_data: { slug: 'advanced-rag', title: 'Advanced RAG Pipeline', short_description: 'Hybrid search + reranking.', status: 'draft',
      key_features: ['Hybrid search', 'Reranking'], metrics: [], resources: [], description_md: '# Overview\n\nText' },
    p_technologies: skills.map((s) => s.id),
    p_images: [],
    p_expected_revision: null,
  }));
  assert.equal(project.slug, 'advanced-rag');
  const pub = ok(await anon.from('projects').select('slug').eq('slug', 'advanced-rag'));
  assert.equal(pub.length, 0);
});

test('12. upload images (validated) and attach them; remove one', async () => {
  const path = `projects/advanced-rag/screenshot/${crypto.randomUUID()}.png`;
  ok(await admin.storage.from('media').upload(path, PNG, { contentType: 'image/png' }));
  const bad = await admin.storage.from('media').upload('projects/x/evil.svg', Buffer.from('<svg onload=alert(1)>'), { contentType: 'image/svg+xml' });
  assert.ok(bad.error, 'SVG must be rejected by the bucket');
  const anonUp = await anon.storage.from('media').upload('projects/x/a.png', PNG, { contentType: 'image/png' });
  assert.ok(anonUp.error, 'anon upload must be rejected');
  const big = await admin.storage.from('media').upload('projects/x/big.png', Buffer.alloc(6 * 1024 * 1024), { contentType: 'image/png' });
  assert.ok(big.error, 'oversized upload must be rejected');

  const p2 = ok(await admin.rpc('save_project', { p_id: project.id, p_expected_revision: project.revision,
    p_data: { ...pick(project), title: 'Advanced RAG Pipeline' },
    p_technologies: null,
    p_images: [{ kind: 'screenshot', storage_path: path, alt_text: 'UI', caption: '' }, { kind: 'architecture', storage_path: path, alt_text: 'Diagram', caption: '' }] }));
  project = p2;
  let imgs = ok(await admin.from('project_images').select('*').eq('project_id', project.id));
  assert.equal(imgs.length, 2);
  project = ok(await admin.rpc('save_project', { p_id: project.id, p_expected_revision: project.revision, p_data: pick(project), p_technologies: null,
    p_images: [{ kind: 'screenshot', storage_path: path, alt_text: 'UI' }] }));
  imgs = ok(await admin.from('project_images').select('*').eq('project_id', project.id));
  assert.equal(imgs.length, 1);
  const pub = await fetch(`${srv.url}/storage/v1/object/public/media/${path}`);
  assert.equal(pub.status, 200);
});

test('7/9/22. edit and publish a project — appears on the public site with technologies & images', async () => {
  project = ok(await admin.rpc('save_project', { p_id: project.id, p_expected_revision: project.revision, p_technologies: null, p_images: null,
    p_data: { ...pick(project), title: 'Advanced RAG Pipeline v2', status: 'published' } }));
  const row = ok(await anon.from('projects')
    .select('*, project_technologies(sort_order, skill:skills(id, name, level)), project_images(id, kind, storage_path, alt_text, caption, sort_order)')
    .eq('slug', 'advanced-rag').maybeSingle());
  assert.equal(row.title, 'Advanced RAG Pipeline v2');
  assert.equal(row.project_technologies.length, 3);
  assert.ok(row.project_technologies.every((t) => t.skill?.name));
  assert.equal(row.project_images.length, 1);
});

test('10. unpublish a project — disappears publicly', async () => {
  ok(await admin.from('projects').update({ status: 'draft' }).eq('id', project.id));
  assert.equal(ok(await anon.from('projects').select('id').eq('id', project.id)).length, 0);
});

test('stale save is rejected with a clear conflict message', async () => {
  const r = await admin.rpc('save_project', { p_id: project.id, p_expected_revision: 1, p_data: pick(project), p_technologies: null, p_images: null });
  assert.ok(r.error);
  assert.match(r.error.message, /changed elsewhere/);
});

test('duplicate slug and unsafe URL are rejected', async () => {
  const dup = await admin.rpc('save_project', { p_id: null, p_data: { slug: 'skin-lesion-classification', title: 'Dup' }, p_technologies: [], p_images: [], p_expected_revision: null });
  assert.equal(dup.error?.code, '23505');
  const xss = await admin.rpc('save_project', { p_id: null, p_data: { slug: 'xss', title: 'X', demo_url: 'javascript:alert(1)' }, p_technologies: [], p_images: [], p_expected_revision: null });
  assert.ok(xss.error);
});

test('11. delete a project, then restore it from version history', async () => {
  ok(await admin.from('projects').delete().eq('id', project.id));
  const [v] = ok(await admin.from('content_versions').select('id').eq('entity_type', 'project').eq('entity_id', project.id).eq('change_kind', 'delete'));
  ok(await admin.rpc('restore_version', { p_version_id: v.id }));
  const back = ok(await admin.from('projects').select('status, title').eq('id', project.id).single());
  assert.equal(back.status, 'draft');
});

// 13–17, 19 --------------------------------------------------------- other content
test('13. add and edit skills (and categories)', async () => {
  const [cat] = ok(await admin.from('skill_categories').insert({ name: 'Agent Frameworks', slug: 'agent-frameworks', sort_order: 99 }).select());
  const [s] = ok(await admin.from('skills').insert({ name: 'CrewAI', category_id: cat.id, level: 'exploring', sort_order: 1 }).select());
  ok(await admin.from('skills').update({ level: 'familiar' }).eq('id', s.id));
  const pub = ok(await anon.from('skills').select('name, level').eq('id', s.id).single());
  assert.equal(pub.level, 'familiar');
  const dup = await admin.from('skills').insert({ name: 'crewai', category_id: cat.id }).select();
  assert.ok(dup.error);
  const ids = ok(await admin.from('skills').select('id').eq('category_id', cat.id).order('sort_order')).map((x) => x.id);
  ok(await admin.rpc('reorder_items', { p_table: 'skills', p_ids: ids.reverse() }));
});

test('14. add experience', async () => {
  const [e] = ok(await admin.from('experience').insert({ company: 'Acme AI', role_title: 'AI Engineer', employment_type: 'full_time',
    start_date: '2026-07-01', is_current: true, responsibilities: ['Built RAG services'], status: 'published', sort_order: 0 }).select());
  const pub = ok(await anon.from('experience').select('*').order('sort_order'));
  assert.equal(pub[0].id, e.id);
  const bad = await admin.from('experience').insert({ company: 'X', role_title: 'Y', start_date: '2026-01-01', end_date: '2025-01-01' });
  assert.ok(bad.error);
});

test('15. add a certification with an uploaded PDF', async () => {
  const path = `certificates/${crypto.randomUUID()}.pdf`;
  ok(await admin.storage.from('certificates').upload(path, PDF, { contentType: 'application/pdf' }));
  ok(await admin.from('certifications').insert({ name: 'Test Cert', issuer: 'Org', file_path: path, file_kind: 'pdf', status: 'published' }));
  assert.equal(ok(await anon.from('certifications').select('id').eq('name', 'Test Cert')).length, 1);
});

test('16. update profile via draft → not public → publish → public', async () => {
  ok(await admin.from('content_drafts').upsert({ entity_type: 'profile', data: { hero_headline: 'New headline. Draft.', full_name: 'Kunal Gupta' } }).select());
  let p = ok(await anon.from('profiles').select('hero_headline').single());
  assert.notEqual(p.hero_headline, 'New headline. Draft.');
  ok(await admin.rpc('publish_draft', { p_entity: 'profile' }));
  p = ok(await anon.from('profiles').select('hero_headline').single());
  assert.equal(p.hero_headline, 'New headline. Draft.');
});

test('17. upload, replace and switch the public resume; download via function', async () => {
  const p1 = `resumes/${crypto.randomUUID()}.pdf`;
  const p2 = `resumes/${crypto.randomUUID()}.pdf`;
  ok(await admin.storage.from('resumes').upload(p1, PDF, { contentType: 'application/pdf' }));
  ok(await admin.storage.from('resumes').upload(p2, PDF, { contentType: 'application/pdf' }));
  const [r1] = ok(await admin.from('resumes').insert({ title: 'AI Engineer', storage_path: p1, file_size: PDF.length }).select());
  const [r2] = ok(await admin.from('resumes').insert({ title: 'Backend', storage_path: p2, file_size: PDF.length }).select());
  ok(await admin.rpc('set_default_resume', { p_id: r1.id }));
  ok(await admin.from('resumes').update({ storage_path: p2 }).eq('id', r1.id)); // replace file
  ok(await admin.rpc('set_default_resume', { p_id: r2.id }));
  const pub = ok(await anon.from('resumes').select('id, title'));
  assert.deepEqual(pub.map((r) => r.title), ['Backend']);
  // private bucket: anon cannot sign; function redirects to a signed URL
  const sign = await anon.storage.from('resumes').createSignedUrl(p1, 60);
  assert.ok(sign.error);
  const res = await fetch(`${srv.url}/functions/v1/resume`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const file = await fetch(new URL(res.headers.get('location'), srv.url));
  assert.equal(file.status, 200);
  assert.equal((await file.arrayBuffer()).byteLength, PDF.length);
});

test('18/19. contact submissions: validation, spam filter, rate limit; admin can filter and manage', async () => {
  const post = (b) => fetch(`${srv.url}/functions/v1/submit-contact`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) });
  const bad = await post({ name: '', email: 'nope', message: 'short' });
  assert.equal(bad.status, 422);
  const fields = (await bad.json()).fields;
  assert.ok(fields.name && fields.email && fields.message);
  const spam = await post({ name: 'Bot', email: 'b@x.co', message: 'Buy cheap things now!!!', company: 'filled', elapsed_ms: 9000 });
  assert.equal(spam.status, 200);
  const good = await post({ name: 'Recruiter', email: 'r@corp.com', subject: 'AI role', message: 'Would love to chat about a role.', elapsed_ms: 9000 });
  assert.equal(good.status, 200);
  const msgs = ok(await admin.from('contact_messages').select('id, name, status').eq('status', 'unread'));
  assert.deepEqual(msgs.map((m) => m.name), ['Recruiter'], 'spam must not be stored');
  const { count } = await admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'unread');
  assert.equal(count, 1);
  ok(await admin.from('contact_messages').update({ status: 'archived' }).eq('id', msgs[0].id));
  const search = ok(await admin.from('contact_messages').select('id').or('name.ilike.%recruit%,subject.ilike.%recruit%'));
  assert.equal(search.length, 1);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await post({ name: 'R', email: 'r@x.co', message: 'Hello there again!', elapsed_ms: 9000 })).status);
  assert.ok(statuses.includes(429), `rate limit expected, got ${statuses}`);
  const notes = ok(await admin.from('notifications').select('kind').eq('kind', 'contact_message'));
  assert.ok(notes.length >= 1);
});

// 20 ----------------------------------------------------------------- RLS spot checks over HTTP
test('20. RLS over the API: drafts, logs and versions are never readable anonymously', async () => {
  for (const t of ['content_drafts', 'content_versions', 'admin_activity_logs', 'notifications', 'analytics_events', 'admin_users']) {
    const r = await anon.from(t).select('*');
    assert.ok(r.error || r.data.length === 0, t);
  }
  const del = await anon.from('projects').delete().neq('slug', 'x').select();
  assert.ok(del.error || del.data.length === 0);
  assert.equal(ok(await anon.from('projects').select('id')).length, 4);
});

test('expired session is rejected and signals re-authentication', async () => {
  const c = client();
  ok(await c.auth.signInWithPassword(ADMIN));
  await fetch(`${srv.url}/__test/expire`);
  const r = await c.from('contact_messages').select('id');
  assert.equal(r.error?.code, 'PGRST301');
  ok(await admin.auth.signInWithPassword(ADMIN)); // restore for later tests
});

test('scheduled publishing via server-side job + dashboard counts + analytics summary', async () => {
  const future = new Date(Date.now() + 3600e3).toISOString();
  const p = ok(await admin.rpc('save_project', { p_id: null, p_data: { slug: 'mcp-server', title: 'MCP Server', status: 'scheduled', publish_at: future },
    p_technologies: [], p_images: [], p_expected_revision: null }));
  assert.equal(ok(await anon.from('projects').select('id').eq('id', p.id)).length, 0);
  await srv.db.query(`update public.projects set publish_at = now() - interval '1 second' where id = $1`, [p.id]);
  const r = await (await fetch(`${srv.url}/__test/cron`)).json();
  assert.ok(r.published >= 1);
  assert.equal(ok(await anon.from('projects').select('status').eq('id', p.id).single()).status, 'published');
  const stats = ok(await admin.rpc('dashboard_stats'));
  assert.ok(stats.projects_total >= 6);
  await fetch(`${srv.url}/functions/v1/track`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'Mozilla/5.0 (iPhone) Mobile Safari' },
    body: JSON.stringify({ type: 'page_view', path: '/', referrer: 'https://www.linkedin.com/feed' }) });
  const s = ok(await admin.rpc('analytics_summary', { p_from: new Date(Date.now() - 7 * 864e5).toISOString(), p_to: new Date(Date.now() + 60e3).toISOString(), p_tz: 'Asia/Kolkata' }));
  assert.equal(s.page_views, 1);
  assert.deepEqual(s.referrers[0], { key: 'linkedin.com', count: 1 });
  assert.deepEqual(s.devices[0], { key: 'mobile', count: 1 });
});

test('activity log captured the whole session', async () => {
  const actions = ok(await admin.from('admin_activity_logs').select('action').order('id')).map((a) => a.action);
  for (const a of ['auth.login', 'project.created', 'project.published', 'project.unpublished', 'project.deleted', 'version.restored',
    'skill.created', 'experience.created', 'certification.created', 'profile.updated', 'resume.uploaded', 'resume.replaced', 'resume.set_default']) {
    assert.ok(actions.includes(a), `missing ${a}`);
  }
});

function pick(p) {
  const keys = ['slug', 'title', 'short_description', 'description_md', 'problem_md', 'solution_md', 'architecture_md', 'implementation_md',
    'key_features', 'challenges', 'category', 'project_status', 'github_url', 'demo_url', 'docs_url', 'resources', 'metrics',
    'cover_image_path', 'cover_alt', 'is_featured', 'status', 'publish_at', 'unpublish_at', 'seo_title', 'seo_description'];
  return Object.fromEntries(keys.map((k) => [k, p[k]]));
}
