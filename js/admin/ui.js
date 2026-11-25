// Admin UI kit: toasts, dialogs, drawers, page chrome and a declarative form builder.
import { h, mount, safeUrl, slugify } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { renderMarkdown } from '../core/markdown.js';
import { publicUrl } from '../core/supabase.js';
import { upload, BUCKETS, friendlyError, signedUrl } from './api.js';

// ---------------------------------------------------------------- toasts
let toastBox;
export function toast(message, type = 'success', { timeout = 4500 } = {}) {
  toastBox ??= document.body.appendChild(h('div', { class: 'toasts', role: 'region', aria: { label: 'Notifications', live: 'polite' } }));
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'checkCircle'),
    h('div', { class: 'grow' }, message),
    h('button', { type: 'button', aria: { label: 'Dismiss' }, on: { click: () => el.remove() } }, icon('close', { size: 16 })));
  toastBox.append(el);
  if (timeout) setTimeout(() => el.remove(), type === 'error' ? timeout * 2 : timeout);
}
export const toastError = (e) => toast(friendlyError(e), 'error');

// ---------------------------------------------------------------- dialogs
export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button' }, confirmText);
    const cancel = h('button', { class: 'btn', type: 'button' }, cancelText);
    const dlg = h('dialog', { class: 'modal', aria: { labelledby: 'cd-title' } },
      h('div', { class: 'modal-body' }, h('h2', { id: 'cd-title' }, title), message && h('p', null, message)),
      h('div', { class: 'modal-foot' }, cancel, ok));
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    dlg.showModal();
    (danger ? cancel : ok).focus();
  });
}

export function modal({ title, body, footer, wide = false, onClose }) {
  const dlg = h('dialog', { class: `modal ${wide ? 'wide' : ''}`, aria: { label: title } },
    h('div', { class: 'drawer-head' }, h('h2', null, title),
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', aria: { label: 'Close' }, on: { click: () => close() } }, icon('close'))),
    h('div', { class: 'modal-body' }, body),
    footer && h('div', { class: 'modal-foot' }, footer));
  const close = () => { dlg.close(); dlg.remove(); onClose?.(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

/**
 * Slide-over editor. beforeClose() may return false to keep it open (unsaved changes).
 */
export function drawer({ title, body, footer, beforeClose }) {
  const titleEl = h('h2', null, title);
  const bodyEl = h('div', { class: 'drawer-body' }, body);
  const footEl = h('div', { class: 'drawer-foot' }, footer);
  const dlg = h('dialog', { class: 'drawer', aria: { label: title } },
    h('div', { class: 'drawer-head' }, titleEl,
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', aria: { label: 'Close' }, on: { click: () => api.close() } }, icon('close'))),
    bodyEl, footEl);
  const api = {
    el: dlg,
    async close(force = false) {
      if (!force && beforeClose && (await beforeClose()) === false) return false;
      dlg.close(); dlg.remove(); return true;
    },
    setTitle(t) { titleEl.textContent = t; },
    setFooter(...f) { mount(footEl, f); },
    setBody(...b) { mount(bodyEl, b); },
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); api.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return api;
}

export async function confirmDiscard() {
  return confirmDialog({ title: 'Discard unsaved changes?', message: 'Your edits on this form have not been saved.',
    confirmText: 'Discard changes', danger: true, cancelText: 'Keep editing' });
}

// ---------------------------------------------------------------- page chrome
export function pageHeader({ title, desc, crumbs = [], actions = [] }) {
  return h('div', { class: 'page-head' },
    h('div', null,
      crumbs.length > 0 && h('nav', { class: 'crumbs-admin', aria: { label: 'Breadcrumb' } },
        crumbs.map((c, i) => [i > 0 && icon('chevronRight'), c.href ? h('a', { href: c.href }, c.label) : h('span', { aria: { current: 'page' } }, c.label)])),
      h('h1', null, title),
      desc && h('p', { class: 'desc' }, desc)),
    actions.length > 0 && h('div', { class: 'page-actions' }, actions));
}

export function btn(label, { icon: ic, variant = '', onClick, type = 'button', href, size = '', title, ariaLabel, disabled } = {}) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, !label && 'btn-icon'].filter(Boolean).join(' ');
  const kids = [ic && icon(ic), label];
  if (href) return h('a', { class: cls, href, title, aria: { label: ariaLabel } }, kids);
  return h('button', { class: cls, type, title, disabled, aria: { label: ariaLabel || (!label ? title : null) }, on: onClick ? { click: onClick } : null }, kids);
}

/** Disable a button and show a spinner while an async action runs. */
export async function busy(button, fn, busyLabel) {
  const prev = Array.from(button.childNodes);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  mount(button, h('span', { class: 'spinner', aria: { hidden: 'true' } }), busyLabel || '');
  try { return await fn(); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); mount(button, prev); }
}

export function emptyState({ icon: ic = 'folder', title, text, action }) {
  return h('div', { class: 'empty' }, h('div', { class: 'icon-wrap' }, icon(ic)), h('h3', null, title), text && h('p', null, text), action);
}

export function errorState(err, retry) {
  return h('div', { class: 'card' }, h('div', { class: 'empty', role: 'alert' },
    h('div', { class: 'icon-wrap' }, icon('alert')), h('h3', null, 'Could not load this page'),
    h('p', null, friendlyError(err)), retry && btn('Retry', { icon: 'refresh', onClick: retry })));
}

export function loadingRows(n = 5) {
  return h('div', { class: 'table-wrap', aria: { busy: 'true', label: 'Loading' } },
    Array.from({ length: n }, () => h('div', { class: 'skeleton sk-row' })));
}

export function statusBadge(status, label) {
  const text = label || { published: 'Published', draft: 'Draft', scheduled: 'Scheduled', archived: 'Archived', visible: 'Visible',
    hidden: 'Hidden', unread: 'Unread', read: 'Read', pending: 'Pending', applied: 'Applied', failed: 'Failed', cancelled: 'Cancelled',
    active: 'Active', inactive: 'Inactive' }[status] || status;
  return h('span', { class: `status status-${status}` }, text);
}

export function pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  return h('div', { class: 'pager' }, h('span', null, `${from}–${to} of ${total}`),
    h('div', { class: 'btns' },
      btn('Previous', { size: 'sm', disabled: page <= 0, onClick: () => onPage(page - 1) }),
      btn('Next', { size: 'sm', disabled: page >= pages - 1, onClick: () => onPage(page + 1) })));
}

export function tabs(items, active, onSelect) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const buttons = items.map((it) => h('button', { class: 'tab', role: 'tab', type: 'button', id: `tab-${it.id}`,
    aria: { selected: String(it.id === active) }, tabindex: it.id === active ? '0' : '-1',
    on: { click: () => select(it.id) } }, it.icon && icon(it.icon, { size: 15 }), it.label, it.dot && h('span', { class: 'dot', aria: { label: 'has errors' } })));
  function select(id) {
    buttons.forEach((b, i) => { const on = items[i].id === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    onSelect(id);
  }
  bar.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[n].focus(); select(items[n].id);
  });
  mount(bar, buttons);
  bar.select = select;
  bar.markErrors = (ids) => buttons.forEach((b, i) => {
    b.querySelector('.dot')?.remove();
    if (ids.includes(items[i].id)) b.append(h('span', { class: 'dot', aria: { label: 'has errors' } }));
  });
  return bar;
}

// ---------------------------------------------------------------- form builder
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const HTTPS_RE = /^https:\/\/[^\s<>"'`]+$/i;

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function baseValidate(f, v) {
  const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (f.required && empty) return `${f.label} is required.`;
  if (empty) return null;
  if (typeof v === 'string') {
    if (f.max && v.length > f.max) return `${f.label} must be ${f.max} characters or fewer.`;
    if (f.min && v.length < f.min) return `${f.label} must be at least ${f.min} characters.`;
    if (f.type === 'url' && !HTTPS_RE.test(v)) return 'Enter a full URL starting with https://';
    if (f.type === 'email' && !EMAIL_RE.test(v)) return 'Enter a valid email address.';
    if (f.pattern && !f.pattern.test(v)) return f.patternMessage || `${f.label} is not in the expected format.`;
  }
  if (Array.isArray(v) && f.maxItems && v.length > f.maxItems) return `At most ${f.maxItems} items.`;
  return null;
}

function counter(f, input) {
  if (!f.max || !['text', 'textarea', 'url', 'email', 'markdown'].includes(f.type || 'text')) return null;
  const c = h('span', { class: 'counter', aria: { hidden: 'true' } });
  const upd = () => { c.textContent = `${input.value.length}/${f.max}`; };
  input.addEventListener('input', upd);
  input.addEventListener('kg-sync', upd);
  upd();
  return c;
}

function markdownControl(f, id) {
  const ta = h('textarea', { class: 'textarea', id, rows: f.rows || 10, maxlength: f.max, placeholder: f.placeholder });
  const preview = h('div', { class: 'md-preview prose', hidden: true, aria: { live: 'polite' } });
  const write = h('button', { class: 'btn btn-sm', type: 'button', aria: { pressed: 'true' } }, 'Write');
  const prev = h('button', { class: 'btn btn-sm', type: 'button', aria: { pressed: 'false' } }, 'Preview');
  const show = (p) => {
    write.setAttribute('aria-pressed', String(!p)); prev.setAttribute('aria-pressed', String(p));
    ta.hidden = p; preview.hidden = !p;
    if (p) mount(preview, ta.value.trim() ? renderMarkdown(ta.value) : h('p', { class: 'muted' }, 'Nothing to preview.'));
  };
  write.addEventListener('click', () => show(false));
  prev.addEventListener('click', () => show(true));
  const wrap = (before, after = before, block = false) => () => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || 'text';
    const ins = block ? `${before}${sel}` : `${before}${sel}${after}`;
    ta.setRangeText(ins, s, e, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  };
  const tool = (label, fn, title) => h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title, aria: { label: title }, on: { click: fn } }, label);
  const bar = h('div', { class: 'md-bar' }, write, prev, h('span', { class: 'sep' }),
    tool('B', wrap('**'), 'Bold'), tool('I', wrap('_'), 'Italic'), tool('H', wrap('\n## ', '', true), 'Heading'),
    tool('•', wrap('\n- ', '', true), 'Bulleted list'), tool('</>', wrap('`'), 'Inline code'), tool('Link', wrap('[', '](https://)'), 'Link'));
  return { el: h('div', { class: 'md-wrap' }, bar, ta, preview), input: ta, get: () => ta.value, set: (v) => { ta.value = v ?? ''; show(false); } };
}

function repeater(f, { columns, empty }) {
  let rows = [];
  const list = h('div', { class: 'repeater' });
  const addBtn = btn(f.addLabel || 'Add', { icon: 'plus', size: 'sm', onClick: () => { rows.push(empty()); draw(); list.querySelector('.rep-row:last-child input')?.focus(); list.dispatchEvent(new Event('input', { bubbles: true })); } });
  function draw() {
    mount(list, rows.map((r, i) => h('div', { class: `rep-row ${columns.length === 3 ? 'three' : ''}` },
      columns.map((c) => h('div', { class: 'field' },
        h('label', { class: 'sr-only', for: `${f.name}-${i}-${c.key}` }, `${c.label} ${i + 1}`),
        h('input', { class: 'input', id: `${f.name}-${i}-${c.key}`, placeholder: c.label, value: r[c.key] || '', maxlength: c.max,
          type: c.type || 'text', inputmode: c.type === 'url' ? 'url' : null,
          on: { input: (e) => { rows[i][c.key] = e.target.value; } } }))),
      btn('', { icon: 'trash', variant: 'ghost', ariaLabel: `Remove row ${i + 1}`,
        onClick: () => { rows.splice(i, 1); draw(); list.dispatchEvent(new Event('input', { bubbles: true })); } }))),
      rows.length >= (f.maxItems || 20) ? null : addBtn);
  }
  draw();
  return {
    el: list,
    get: () => rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, (r[c.key] || '').trim()])))
      .filter((r) => Object.values(r).some(Boolean))
      .map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => v || columns.find((c) => c.key === k)?.required))),
    set: (v) => { rows = Array.isArray(v) ? v.map((x) => ({ ...x })) : []; draw(); },
    validate: (v) => {
      for (const [i, r] of v.entries()) {
        for (const c of columns) {
          if (c.required && !r[c.key]) return `Row ${i + 1}: ${c.label} is required.`;
          if (c.max && (r[c.key] || '').length > c.max) return `Row ${i + 1}: ${c.label} is too long (max ${c.max}).`;
          if (c.type === 'url' && r[c.key] && !HTTPS_RE.test(r[c.key])) return `Row ${i + 1}: URL must start with https://`;
        }
      }
      return null;
    },
  };
}

/** Image / file upload control storing a storage path. */
export function uploadControl({ bucket = 'media', folder = 'misc', square = false, accept, allowPdf = false, onKind }) {
  let value = null;
  let kind = null;
  const preview = h('div', { class: `upload-preview ${square ? 'square' : ''}` });
  const input = h('input', { type: 'file', class: 'sr-only', accept: accept || BUCKETS[bucket].types.join(','), tabindex: '-1', aria: { label: 'Choose file to upload' } });
  const status = h('span', { class: 'small muted', aria: { live: 'polite' } });
  const chooseBtn = btn('Upload', { icon: 'upload', size: 'sm', onClick: () => input.click() });
  const removeBtn = btn('Remove', { icon: 'trash', size: 'sm', variant: 'ghost', onClick: () => { setVal(null, null); root.dispatchEvent(new Event('input', { bubbles: true })); } });
  const root = h('div', { class: 'upload' }, preview, h('div', { class: 'stack', style: { gap: '6px' } },
    h('div', { class: 'upload-btns' }, chooseBtn, removeBtn), h('span', { class: 'small muted' }, BUCKETS[bucket].label), status), input);

  async function draw() {
    removeBtn.hidden = !value;
    chooseBtn.lastChild.textContent = value ? 'Replace' : 'Upload';
    if (!value) return mount(preview, icon(allowPdf ? 'file' : 'image'));
    if (kind === 'pdf') return mount(preview, h('div', { class: 'stack', style: { justifyItems: 'center', gap: '4px' } }, icon('file'), h('span', { class: 'small' }, 'PDF')));
    const src = bucket === 'resumes' ? await signedUrl(bucket, value).catch(() => null) : publicUrl(bucket, value);
    mount(preview, h('img', { src, alt: 'Uploaded image preview' }));
  }
  function setVal(v, k) { value = v || null; kind = k || (v && /\.pdf$/i.test(v) ? 'pdf' : v ? 'image' : null); onKind?.(kind); draw(); }

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    chooseBtn.disabled = true;
    status.textContent = 'Uploading…';
    mount(preview, h('span', { class: 'spinner' }));
    try {
      const path = await upload(bucket, folder, file);
      setVal(path, /\.pdf$/.test(path) ? 'pdf' : 'image');
      status.textContent = 'Uploaded. Remember to save.';
      root.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      status.textContent = '';
      toastError(e);
      draw();
    } finally { chooseBtn.disabled = false; }
  });
  draw();
  return { el: root, get: () => value, set: (v) => setVal(v), getKind: () => kind, focus: () => chooseBtn.focus() };
}

/**
 * createForm({ sections: [{ title, description, fields: [...] }], values })
 * Field: { name, label, type, required, max, hint, options, placeholder, full, rows, pattern, patternMessage,
 *          validate(v, all), bucket, folder, square, render(form) (custom) }
 */
export function createForm({ sections, values = {}, idPrefix = 'f' }) {
  const controls = new Map();
  let snapshot = '';
  const el = h('form', { novalidate: true, on: { submit: (e) => e.preventDefault() } });

  for (const sec of sections) {
    const grid = h('div', { class: 'form-grid' });
    for (const f of sec.fields) {
      const id = `${idPrefix}-${f.name}`;
      const type = f.type || 'text';
      const err = h('p', { class: 'error', id: `${id}-err`, hidden: true, role: 'alert' });
      let ctl;
      if (f.render) ctl = f.render();
      else if (type === 'markdown') ctl = markdownControl(f, id);
      else if (type === 'textarea' || type === 'list') {
        const ta = h('textarea', { class: 'textarea', id, rows: f.rows || 4, maxlength: type === 'textarea' ? f.max : null, placeholder: f.placeholder });
        ctl = type === 'list'
          ? { el: ta, input: ta, get: () => ta.value.split('\n').map((s) => s.trim()).filter(Boolean), set: (v) => { ta.value = (v || []).join('\n'); } }
          : { el: ta, input: ta, get: () => ta.value.trim(), set: (v) => { ta.value = v ?? ''; } };
      } else if (type === 'select') {
        const sel = h('select', { class: 'select', id }, f.allowEmpty && h('option', { value: '' }, f.emptyLabel || '—'),
          (f.options || []).map((o) => h('option', { value: o.value ?? o }, o.label ?? o)));
        ctl = { el: sel, input: sel, get: () => sel.value || null, set: (v) => { sel.value = v ?? ''; }, setOptions: (opts) => {
          const cur = sel.value;
          mount(sel, f.allowEmpty && h('option', { value: '' }, f.emptyLabel || '—'), opts.map((o) => h('option', { value: o.value }, o.label)));
          sel.value = cur;
        } };
      } else if (type === 'toggle') {
        const cb = h('input', { type: 'checkbox', id, role: 'switch' });
        ctl = { el: h('label', { class: 'toggle', for: id }, cb, f.toggleLabel || f.label), input: cb, get: () => cb.checked, set: (v) => { cb.checked = !!v; } };
      } else if (type === 'radio') {
        const name = `${id}-r`;
        const inputs = f.options.map((o) => h('input', { type: 'radio', name, value: o.value }));
        ctl = { el: h('div', { class: 'radio-cards', role: 'radiogroup', aria: { label: f.label } }, f.options.map((o, i) =>
          h('label', { class: 'radio-card' }, inputs[i], h('strong', null, o.label), o.description && h('span', null, o.description)))),
          input: inputs[0], get: () => inputs.find((x) => x.checked)?.value ?? null, set: (v) => inputs.forEach((x) => { x.checked = x.value === v; }) };
      } else if (type === 'image' || type === 'file') {
        ctl = uploadControl({ bucket: f.bucket || 'media', folder: f.folder, square: f.square, allowPdf: type === 'file' });
      } else if (type === 'links') {
        ctl = repeater(f, { columns: [{ key: 'label', label: 'Label', required: true, max: 80 }, { key: 'url', label: 'https://…', required: true, type: 'url', max: 2048 }],
          empty: () => ({ label: '', url: '' }) });
      } else if (type === 'metrics') {
        ctl = repeater(f, { columns: [{ key: 'label', label: 'Metric (e.g. Accuracy)', required: true, max: 60 },
          { key: 'value', label: 'Value (e.g. 94%)', required: true, max: 40 }, { key: 'description', label: 'How it was measured', max: 300 }],
        empty: () => ({ label: '', value: '', description: '' }) });
      } else {
        const inputType = { url: 'url', email: 'email', number: 'number', date: 'date', datetime: 'datetime-local' }[type] || 'text';
        const inp = h('input', { class: 'input', id, type: inputType, maxlength: f.max, placeholder: f.placeholder, autocomplete: f.autocomplete || 'off',
          inputmode: type === 'url' ? 'url' : type === 'email' ? 'email' : null, min: f.minValue, max: f.maxValue, step: f.step,
          spellcheck: type === 'url' || type === 'email' || f.name === 'slug' ? 'false' : null });
        ctl = {
          el: inp, input: inp,
          get: () => {
            const v = inp.value.trim();
            if (type === 'number') return v === '' ? null : Number(v);
            if (type === 'datetime') return v ? new Date(v).toISOString() : null;
            return v || (f.emptyAs !== undefined ? f.emptyAs : null);
          },
          set: (v) => { inp.value = type === 'datetime' ? toLocalInput(v) : (v ?? ''); },
        };
      }
      if (ctl.input) {
        ctl.input.setAttribute('aria-describedby', `${id}-err${f.hint ? ` ${id}-hint` : ''}`);
        if (f.required) ctl.input.setAttribute('aria-required', 'true');
      }
      const showLabel = type !== 'toggle';
      const wrapper = h('div', { class: ['field', (f.full || ['markdown', 'textarea', 'list', 'links', 'metrics', 'radio'].includes(type)) && 'full'] },
        showLabel && h('label', { class: 'field-label', for: ctl.input && !['radio'].includes(type) ? id : null },
          f.label, f.required && h('span', { class: 'req', aria: { hidden: 'true' } }, '*'), ctl.input && counter(f, ctl.input)),
        ctl.el,
        f.hint && h('p', { class: 'hint', id: `${id}-hint` }, f.hint),
        err);
      ctl.err = err;
      ctl.field = f;
      ctl.wrapper = wrapper;
      ctl.section = sec;
      controls.set(f.name, ctl);
      grid.append(wrapper);
    }
    el.append(h('section', { class: 'form-section', data: { tab: sec.tab || '' } },
      (sec.title || sec.description) && h('header', null, sec.title && h('h3', null, sec.title), sec.description && h('p', null, sec.description)),
      grid));
  }

  const form = {
    el,
    controls,
    get(name) { return controls.get(name)?.get(); },
    set(name, v) { controls.get(name)?.set(v); },
    values() {
      const out = {};
      for (const [k, c] of controls) {
        out[k] = c.get();
        if (c.getKind && c.field.kindField) out[c.field.kindField] = c.getKind();
      }
      return out;
    },
    setValues(v) { for (const [k, c] of controls) { c.set(v[k]); c.input?.dispatchEvent(new Event('kg-sync')); } },
    setError(name, msg) {
      const c = controls.get(name);
      if (!c) return;
      c.err.hidden = !msg;
      c.err.textContent = msg || '';
      c.input?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    },
    validate() {
      const vals = form.values();
      const errors = {};
      for (const [k, c] of controls) {
        const v = vals[k];
        const msg = baseValidate(c.field, v) || c.validate?.(v) || c.field.validate?.(v, vals) || null;
        form.setError(k, msg);
        if (msg) errors[k] = msg;
      }
      const first = Object.keys(errors)[0];
      if (first) {
        const c = controls.get(first);
        el.dispatchEvent(new CustomEvent('invalid-fields', { detail: { errors, tabs: [...new Set(Object.keys(errors).map((k) => controls.get(k).section.tab))] } }));
        setTimeout(() => { (c.input || c.el).focus?.(); c.wrapper.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 0);
      }
      return { ok: !first, errors };
    },
    markClean() { snapshot = JSON.stringify(form.values()); },
    isDirty() { return JSON.stringify(form.values()) !== snapshot; },
  };
  form.setValues(values);
  form.markClean();
  return form;
}

/** Auto-fill a slug from a title until the slug is edited by hand. */
export function linkSlug(form, from = 'title', to = 'slug', enabled = true) {
  const src = form.controls.get(from)?.input;
  const dst = form.controls.get(to)?.input;
  if (!src || !dst) return;
  let manual = !enabled || !!dst.value;
  dst.addEventListener('input', () => { manual = true; });
  src.addEventListener('input', () => { if (!manual) dst.value = slugify(src.value); });
}

export const linkOut = (url, label) => (safeUrl(url) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label || url) : null);
