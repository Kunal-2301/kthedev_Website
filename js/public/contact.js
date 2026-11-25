// Contact: "Let's build something." + contact.sh window + message form (submit-contact Edge Function).
// Server-side validation, spam filtering and rate limiting; the browser never writes to the database.
import { h } from '../core/dom.js';
import { functionUrl } from '../core/supabase.js';
import { CONFIG } from '../config.js';
import { win, cursor, socialButtons } from './layout.js';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

let turnstileLoading = null;
function loadTurnstile() {
  if (!CONFIG.turnstileSiteKey) return Promise.resolve(null);
  turnstileLoading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
  return turnstileLoading;
}

function field(name, label, control) {
  const err = h('p', { class: 'err', id: `${name}-error`, hidden: true });
  control.id = `cf-${name}`;
  control.name = name;
  control.setAttribute('aria-describedby', `${name}-error`);
  return { el: h('div', null, h('label', { class: 'lbl', for: `cf-${name}` }, label), control, err), err, control };
}

export function renderContact(site) {
  const p = site.profile;
  const startedAt = Date.now();
  let turnstileToken = '';

  const f = {
    name: field('name', '--name', h('input', { class: 'inp', type: 'text', autocomplete: 'name', maxlength: 100, required: true })),
    email: field('email', '--email', h('input', { class: 'inp', type: 'email', autocomplete: 'email', maxlength: 254, required: true, inputmode: 'email', spellcheck: 'false' })),
    subject: field('subject', '--subject (optional)', h('input', { class: 'inp', type: 'text', maxlength: 200 })),
    message: field('message', '--message', h('textarea', { class: 'inp', rows: 6, maxlength: 5000, required: true })),
  };
  const honeypot = h('div', { class: 'hp', aria: { hidden: 'true' } },
    h('label', { for: 'cf-company' }, 'Company (leave blank)'),
    h('input', { id: 'cf-company', name: 'company', type: 'text', tabindex: '-1', autocomplete: 'off' }));
  const statusBox = h('p', { class: 'form-status', role: 'status', aria: { live: 'polite' } });
  const submit = h('button', { class: 'btn btn-solid', type: 'submit' }, 'Send message');
  const turnstileBox = h('div');

  const setError = (k, msg) => {
    const { err, control } = f[k];
    err.hidden = !msg; err.textContent = msg ? `✗ ${msg}` : '';
    control.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };

  const form = h('form', { class: 'contact-form', novalidate: true, aria: { label: 'Contact form' } },
    h('div', { class: 'form-row' }, f.name.el, f.email.el), f.subject.el, f.message.el, honeypot, turnstileBox, statusBox,
    h('div', { class: 'form-foot' }, h('small', null, '# used only to reply to you'), submit));

  if (CONFIG.turnstileSiteKey) {
    loadTurnstile().then((ts) => ts?.render(turnstileBox, {
      sitekey: CONFIG.turnstileSiteKey, theme: 'dark', callback: (t) => { turnstileToken = t; }, 'expired-callback': () => { turnstileToken = ''; },
    }));
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(['name', 'email', 'subject', 'message'].map((k) => [k, f[k].control.value.trim()]));
    const errors = {};
    if (!v.name) errors.name = 'Please enter your name.';
    if (!EMAIL_RE.test(v.email)) errors.email = 'Please enter a valid email address.';
    if (v.message.length < 10) errors.message = 'Message must be at least 10 characters.';
    Object.keys(f).forEach((k) => setError(k, errors[k]));
    statusBox.className = 'form-status'; statusBox.textContent = '';
    if (Object.keys(errors).length) { f[Object.keys(errors)[0]].control.focus(); return; }

    submit.disabled = true;
    submit.replaceChildren(h('span', { class: 'spinner', aria: { hidden: 'true' } }), 'Sending…');
    try {
      const res = await fetch(functionUrl('submit-contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...v, company: form.company.value, elapsed_ms: Date.now() - startedAt, turnstile_token: turnstileToken }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (out.fields) Object.entries(out.fields).forEach(([k, m]) => f[k] && setError(k, m));
        throw new Error(out.error || 'Something went wrong.');
      }
      form.reset();
      statusBox.className = 'form-status ok';
      statusBox.textContent = '✓ message sent — I will get back to you soon.';
      if (window.turnstile) window.turnstile.reset(turnstileBox);
    } catch (e) {
      statusBox.className = 'form-status bad';
      statusBox.textContent = navigator.onLine === false
        ? '✗ you appear to be offline — your message is still in the form.'
        : `✗ ${e.message} Your message is still in the form.`;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send message';
    }
  });

  const email = p.email;
  return h('div', { class: 'contact-grid' },
    h('div', null,
      h('h2', { class: 'contact-title rv', id: 'contact-title' }, "Let's build something", h('span', { class: 'p-c' }, '.')),
      h('p', { class: 'contact-lede rv' }, 'Open to AI Engineer, Python Backend and Generative AI roles, internships and collaborations. Email is the fastest way to reach me.'),
      win('contact.sh',
        email && [h('p', { class: 'cmd' }, '$ echo $EMAIL'), h('a', { href: `mailto:${email}`, class: 'a-hover' }, email)],
        p.phone && [h('p', { class: 'cmd' }, '$ echo $PHONE'), h('a', { href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, p.phone)],
        p.location && [h('p', { class: 'cmd' }, '$ echo $LOCATION'), h('p', null, p.location)],
        h('p', { class: 'cmd' }, '$ open --links'),
        h('div', { class: 'contact-links' }, socialButtons(site)),
        h('p', { class: 'cmd' }, '$', cursor()))),
    win('send_message.sh', form));
}
