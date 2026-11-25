import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContact, validateEvent, deviceFromUA, referrerHost, isBot, safeFileName } from '../../supabase/functions/_shared/logic.js';

test('contact: valid payload passes and is trimmed', () => {
  const r = validateContact({ name: '  Ada  ', email: 'ADA@Example.com ', subject: 'Hi', message: 'Hello there, nice site!', elapsed_ms: 8000 });
  assert.equal(r.ok, true);
  assert.equal(r.spam, false);
  assert.deepEqual(r.value, { name: 'Ada', email: 'ada@example.com', subject: 'Hi', message: 'Hello there, nice site!' });
});

test('contact: field errors', () => {
  const r = validateContact({ name: '', email: 'not-an-email', message: 'short' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.name && r.errors.email && r.errors.message);
  assert.equal(validateContact(null).ok, false);
  assert.equal(validateContact({ name: 'x'.repeat(101), email: 'a@b.co', message: 'long enough message' }).ok, false);
  assert.equal(validateContact({ name: 'x', email: 'a@b.co', message: 'y'.repeat(5001) }).ok, false);
});

test('contact: spam signals (honeypot, too fast, link stuffing)', () => {
  const base = { name: 'x', email: 'a@b.co', message: 'hello there friend' };
  assert.equal(validateContact({ ...base, company: 'Acme' }).spam, true);
  assert.equal(validateContact({ ...base, elapsed_ms: 400 }).spam, true);
  assert.equal(validateContact({ ...base, message: 'http://a http://b http://c http://d http://e http://f' }).spam, true);
  assert.equal(validateContact({ ...base, elapsed_ms: 9000 }).spam, false);
});

test('analytics events: whitelist only, no personal data survives', () => {
  assert.deepEqual(validateEvent({ type: 'page_view', path: '/index.html?email=a@b.co#x', ip: '1.2.3.4' }),
    { event_type: 'page_view', path: '/index.html', section: null, project_slug: null });
  assert.equal(validateEvent({ type: 'drop_table' }), null);
  assert.equal(validateEvent({ type: 'section_view', section: 'evil' }), null);
  assert.equal(validateEvent({ type: 'project_view', slug: '../../etc' }), null);
  assert.equal(validateEvent({ type: 'project_view', slug: 'advanced-rag' }).project_slug, 'advanced-rag');
});

test('device classification', () => {
  assert.equal(deviceFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1'), 'mobile');
  assert.equal(deviceFromUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.equal(deviceFromUA('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit Safari'), 'tablet');
  assert.equal(deviceFromUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'), 'mobile');
  assert.equal(deviceFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'), 'desktop');
  assert.equal(deviceFromUA(''), 'unknown');
});

test('referrer host: external host only, never full URL', () => {
  assert.equal(referrerHost('https://www.linkedin.com/in/someone?trk=abc'), 'linkedin.com');
  assert.equal(referrerHost('https://kunal-2301.github.io/project.html', ['kunal-2301.github.io']), null);
  assert.equal(referrerHost('javascript:alert(1)'), null);
  assert.equal(referrerHost(''), null);
});

test('bot detection and safe filenames', () => {
  assert.equal(isBot('Googlebot/2.1'), true);
  assert.equal(isBot('Mozilla/5.0 (Macintosh) Safari'), false);
  assert.equal(safeFileName('Kunal-Gupta-AI Engineer <script>'), 'Kunal-Gupta-AI-Engineer-script.pdf');
  assert.equal(safeFileName('../../etc/passwd'), 'etcpasswd.pdf');
  assert.equal(safeFileName(''), 'resume.pdf');
});
