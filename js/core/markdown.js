// Safe Markdown rendering: marked (parse) → DOMPurify (sanitize, strict allow-list).
// Requires js/vendor/marked.umd.js and js/vendor/purify.min.js.

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'h4',
  'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'];
const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'align'];

let hooked = false;
function setup() {
  if (hooked) return;
  hooked = true;
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:/i.test(href)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    }
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
      if (!/^https:/i.test(node.getAttribute('src') || '')) node.remove();
    }
  });
}

/** Returns a sanitized DocumentFragment. Raw HTML in Markdown is stripped. */
export function renderMarkdown(md) {
  setup();
  const source = String(md ?? '');
  // Headings in content start at h2 (h1 is the page title).
  const html = window.marked.parse(source, { gfm: true, breaks: false, async: false })
    .replace(/<h1(\s|>)/g, '<h2$1').replace(/<\/h1>/g, '</h2>');
  return window.DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    ADD_ATTR: ['target', 'rel', 'loading', 'decoding'],
    RETURN_DOM_FRAGMENT: true,
  });
}

/** Plain-text excerpt of Markdown (for meta descriptions). */
export function markdownToText(md, max = 160) {
  const frag = renderMarkdown(md);
  const text = (frag.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
