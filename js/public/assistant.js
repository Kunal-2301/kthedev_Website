// "Ask my portfolio" — terminal-style chat panel. Answers come from the `ask`
// Edge Function, grounded in published portfolio content with cited sources.
// Shown only when enabled in Website settings. Nothing typed here is stored.
import { h, mount, safeUrl } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { functionUrl } from '../core/supabase.js';
import { siteHref } from '../core/paths.js';
import { handleOf } from './layout.js';

const SUGGESTIONS = [
  'What GenAI projects has he built?',
  'What is his experience with Python backends?',
  'Tell me about his HCLTech internship.',
  'How can I contact him?',
];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Mount (or remove) the assistant to match the current settings; safe to call on every render. */
export function mountAssistant(site) {
  const existing = document.getElementById('ask-panel');
  if (!site.settings?.assistant_enabled) {
    existing?.remove();
    document.querySelector('.ask-launcher')?.remove();
    return;
  }
  if (existing) return;
  const p = site.profile;
  const handle = handleOf(p);
  const history = [];
  let busy = false;

  const log = h('div', { class: 'ask-log', role: 'log', aria: { live: 'polite', relevant: 'additions' } });
  const input = h('input', { class: 'inp', id: 'ask-input', type: 'text', maxlength: 400, autocomplete: 'off', spellcheck: 'true',
    placeholder: 'ask about projects, skills, experience…', aria: { label: `Ask a question about ${p.full_name}` } });
  const send = h('button', { class: 'btn btn-sm btn-solid', type: 'submit', aria: { label: 'Send question' } }, icon('send'));
  const form = h('form', { class: 'ask-form', on: { submit: (e) => { e.preventDefault(); ask(input.value); } } },
    h('label', { class: 'cmd', for: 'ask-input', aria: { hidden: 'true' } }, '$'), input, send);

  const chips = h('div', { class: 'ask-chips' }, SUGGESTIONS.map((q) =>
    h('button', { class: 'fbtn', type: 'button', on: { click: () => ask(q) } }, q)));

  const closeBtn = h('button', { class: 'ask-close', type: 'button', aria: { label: 'Close assistant' }, on: { click: () => setOpen(false) } }, icon('close'));
  const panel = h('section', { class: 'ask-panel win', id: 'ask-panel', role: 'dialog', aria: { modal: 'false', labelledby: 'ask-title' }, hidden: true },
    h('div', { class: 'win-bar' }, h('span', { class: 'dots', aria: { hidden: 'true' } }, h('i'), h('i'), h('i')),
      h('h2', { class: 'win-title', id: 'ask-title' }, `ask_${handle}.sh`), closeBtn),
    h('div', { class: 'ask-body' },
      h('p', { class: 'ask-intro' }, h('span', { class: 'p-c' }, '# '),
        `Ask me about ${p.full_name}'s projects, skills and experience. Answers come only from this portfolio, with sources.`),
      chips, log),
    form,
    h('p', { class: 'ask-note' }, 'AI-generated · may contain mistakes · questions are not stored'));

  const launcher = h('button', { class: 'ask-launcher', type: 'button', aria: { expanded: 'false', controls: 'ask-panel' },
    on: { click: () => setOpen(panel.hidden) } }, h('span', { class: 'p-c' }, '>'), ` ask ${handle}`, h('span', { class: 'cur', aria: { hidden: 'true' } }));

  function setOpen(open) {
    panel.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) input.focus(); else launcher.focus();
  }
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  function line(cls, ...kids) { const el = h('div', { class: `ask-line ${cls}` }, ...kids); log.append(el); log.scrollTop = log.scrollHeight; return el; }

  /** Render answer text safely: plain text, "- " lines become list items. */
  function renderAnswer(text) {
    const out = [];
    let list = null;
    for (const raw of text.split('\n')) {
      const l = raw.trim();
      if (!l) { list = null; continue; }
      if (/^[-•*]\s+/.test(l)) {
        if (!list) { list = h('ul', { class: 'arrow-list' }); out.push(list); }
        list.append(h('li', null, l.replace(/^[-•*]\s+/, '')));
      } else { list = null; out.push(h('p', null, l)); }
    }
    return out;
  }

  async function reveal(el, text) {
    const nodes = renderAnswer(text);
    if (reduced()) { mount(el, nodes); return; }
    // word-by-word "typing", rendered as text nodes only
    const words = text.split(/(\s+)/);
    const live = h('p');
    mount(el, live);
    for (let i = 0; i < words.length; i += 3) {
      live.textContent = words.slice(0, i + 3).join('');
      log.scrollTop = log.scrollHeight;
      await new Promise((r) => setTimeout(r, 18));
    }
    mount(el, nodes);
  }

  async function ask(raw) {
    const question = String(raw || '').trim();
    if (!question || busy) return;
    if (question.length > 400) { line('ask-err', '✗ Questions are limited to 400 characters.'); return; }
    busy = true;
    send.disabled = true;
    chips.hidden = true;
    input.value = '';
    line('ask-q', h('span', { class: 'p-c' }, '$ '), question);
    const pending = line('ask-a', h('span', { class: 'dim' }, 'thinking'), h('span', { class: 'cur', aria: { hidden: 'true' } }));
    try {
      const res = await fetch(functionUrl('ask'), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ question, history: history.slice(-6) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'The assistant could not answer right now.');
      await reveal(pending, out.answer);
      const sources = (out.sources || []).map((s) => ({ ...s, href: safeUrl(siteHref(s.url)) })).filter((s) => s.href);
      if (sources.length) {
        pending.append(h('p', { class: 'ask-sources' }, h('span', { class: 'dim' }, 'sources: '),
          sources.map((s) => h('a', { href: s.href, on: { click: () => { if (s.href.includes('#')) setOpen(false); } } }, `[${s.title}]`))));
      }
      history.push({ role: 'user', text: question }, { role: 'assistant', text: out.answer });
    } catch (e) {
      pending.remove();
      line('ask-err', `✗ ${navigator.onLine === false ? 'You appear to be offline.' : e.message}`);
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  document.body.append(launcher, panel);
}
