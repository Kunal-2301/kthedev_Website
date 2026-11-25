// E2E: "ask my portfolio" assistant (offline emulation) and static per-project SEO pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { startServer, ADMIN } from './server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let srv; let admin;
const ask = (body) => fetch(`${srv.url}/functions/v1/ask`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
const ok = (r) => { assert.equal(r.error, null, r.error?.message); return r.data; };

before(async () => {
  srv = await startServer({ port: 0 });
  admin = createClient(srv.url, 'test-publishable-key', { auth: { persistSession: false } });
  ok(await admin.auth.signInWithPassword(ADMIN));
  ok(await admin.from('projects').insert({ slug: 'secret-draft', title: 'Secret Draft', short_description: 'TOP SECRET unpublished LangChain work', status: 'draft' }));
});
after(async () => { await srv?.close(); });

// ---------------------------------------------------------------- assistant
test('assistant is off by default', async () => {
  const r = await ask({ question: 'What has he built?' });
  assert.equal(r.status, 503);
});

test('admin enables the assistant; answers cite published content only', async () => {
  ok(await admin.from('site_settings').update({ assistant_enabled: true }).eq('id', 1));
  const r = await ask({ question: 'What has he built with LangChain?' });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.match(out.answer, /local test mode/);
  assert.ok(out.sources.some((s) => s.url === 'projects/document-qa-chatbot/'), JSON.stringify(out.sources));
  assert.doesNotMatch(JSON.stringify(out), /TOP SECRET|secret-draft/, 'draft content must never reach the assistant');
});

test('assistant input validation and per-visitor rate limit', async () => {
  assert.equal((await ask({ question: '' })).status, 422);
  assert.equal((await ask({ question: 'x'.repeat(401) })).status, 422);
  const statuses = [];
  for (let i = 0; i < 10; i++) statuses.push((await ask({ question: `Python question ${i}` })).status);
  assert.ok(statuses.includes(429), `expected 429 in ${statuses}`);
});

test('assistant usage is counted (no question text stored)', async () => {
  const s = ok(await admin.rpc('analytics_summary', { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 6e4).toISOString(), p_tz: 'UTC' }));
  assert.ok(s.assistant_questions >= 1);
  const events = ok(await admin.from('analytics_events').select('*').eq('event_type', 'assistant_question'));
  assert.ok(events.every((e) => !JSON.stringify(e).includes('LangChain')));
});

// ---------------------------------------------------------------- SEO pages
test('static project page has real metadata and pre-rendered content', async () => {
  const res = await fetch(`${srv.url}/projects/document-qa-chatbot/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>AI-Powered Document Q&amp;A Chatbot — Kunal Gupta<\/title>/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${srv.url}/projects/document-qa-chatbot/">`));
  assert.match(html, /<meta property="og:image" content="[^"]+og-image\.png">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /"@type":"CreativeWork"/);
  assert.match(html, /Retrieval-Augmented Generation/);           // case-study text pre-rendered
  assert.match(html, /<li>LangChain<\/li>/);                        // technologies
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /src="\.\.\/\.\.\/js\/public\/project\.js"/); // hydrates into the full page
});

test('static page escapes CMS content (no HTML/script injection)', async () => {
  ok(await admin.from('projects').update({ title: '</title><script>alert(1)</script> Chat', short_description: '"><img src=x onerror=alert(1)>' }).eq('slug', 'document-qa-chatbot'));
  const html = await (await fetch(`${srv.url}/projects/document-qa-chatbot/`)).text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('unpublished slug falls back to 404.html, which redirects to the dynamic page', async () => {
  const res = await fetch(`${srv.url}/projects/secret-draft/`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /\/js\/404\.js/);
  assert.doesNotMatch(html, /TOP SECRET/);
  const js = await readFile(path.join(root, 'js/404.js'), 'utf8');
  const re = new RegExp(/\^\(\.\*\\\/\)projects\\\/\(\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\)\\\/\?\$/.source);
  assert.match(js, re);
});

test('build-seo generates sitemap + one page per published project', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'seo-'));
  try {
    await promisify(execFile)(process.execPath, [path.join(root, 'scripts/build-seo.mjs')], {
      env: { ...process.env, SUPABASE_URL: srv.url, SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key', SITE_URL: 'https://example.dev', OUT_DIR: out },
    });
    const pages = await readdir(path.join(out, 'projects'));
    assert.deepEqual(pages.sort(), ['document-qa-chatbot', 'manufacturing-erp-system', 'skin-lesion-classification', 'yolov8-smoke-cigarette-detection']);
    const sitemap = await readFile(path.join(out, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/example\.dev\/projects\/skin-lesion-classification\/<\/loc>/);
    assert.doesNotMatch(sitemap, /secret-draft/);
    const page = await readFile(path.join(out, 'projects/skin-lesion-classification/index.html'), 'utf8');
    assert.match(page, /<link rel="canonical" href="https:\/\/example\.dev\/projects\/skin-lesion-classification\/">/);
  } finally { await rm(out, { recursive: true, force: true }); }
});
