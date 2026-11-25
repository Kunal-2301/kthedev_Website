// Runs the real browser modules (markdown.js, dom.js) with the vendored marked + DOMPurify inside jsdom.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

let renderMarkdown; let safeUrl; let h; let slugify; let formatRange;

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://example.com/' });
  for (const f of ['js/vendor/marked.umd.js', 'js/vendor/purify.min.js']) dom.window.eval(await readFile(new URL(`../../${f}`, import.meta.url), 'utf8'));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  ({ renderMarkdown } = await import('../../js/core/markdown.js'));
  ({ safeUrl, h, slugify, formatRange } = await import('../../js/core/dom.js'));
});

const html = (frag) => { const d = document.createElement('div'); d.append(frag); return d.innerHTML; };

test('markdown renders basic formatting', () => {
  const out = html(renderMarkdown('# Title\n\n**bold** and `code`\n\n- a\n- b'));
  assert.match(out, /<h2>Title<\/h2>/);   // h1 demoted (page has its own h1)
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<li>a<\/li>/);
});

const XSS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[click](javascript:alert(1))',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<svg onload=alert(1)>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
  '<form action="https://evil"><input></form>',
  '<a href="vbscript:msgbox(1)">x</a>',
];
for (const payload of XSS) {
  test(`markdown sanitizes: ${payload.slice(0, 40)}`, () => {
    const out = html(renderMarkdown(payload));
    assert.doesNotMatch(out, /<script|onerror|onload|javascript:|vbscript:|<iframe|<svg|style=|<form|data:image/i, out);
  });
}

test('external links get target=_blank + rel=noopener', () => {
  const out = html(renderMarkdown('[GitHub](https://github.com/Kunal-2301)'));
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
});

test('safeUrl allows only safe schemes', () => {
  assert.equal(safeUrl('https://x.com'), 'https://x.com');
  assert.equal(safeUrl('mailto:a@b.co'), 'mailto:a@b.co');
  assert.equal(safeUrl('project.html?slug=a'), 'project.html?slug=a');
  assert.equal(safeUrl('#about'), '#about');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.com']) assert.equal(safeUrl(bad), null, bad);
});

test('h() inserts CMS strings as text and drops unsafe hrefs', () => {
  const el = h('a', { href: 'javascript:alert(1)' }, '<img src=x onerror=alert(1)>');
  assert.equal(el.getAttribute('href'), null);
  assert.equal(el.innerHTML, '&lt;img src=x onerror=alert(1)&gt;');
  assert.throws(() => h('div', { onclick: 'alert(1)' }));
});

test('slugify and date ranges', () => {
  assert.equal(slugify('Multi-Agent  Research Assistant!'), 'multi-agent-research-assistant');
  assert.equal(slugify('Café RAG'), 'cafe-rag');
  assert.equal(formatRange('2025-05-01', '2025-07-31', false, 'month'), 'May 2025 – Jul 2025');
  assert.equal(formatRange('2024-01-01', null, true, 'year'), '2024 – Present');
});
