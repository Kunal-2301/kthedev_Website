// Profile and Website settings: edit → save draft → preview → publish.
// Drafts live in content_drafts (admin-only), so unpublished edits are never public.
import { h, mount, relativeTime } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { db, data, run, rpc } from '../api.js';
import { pageHeader, btn, busy, createForm, toast, toastError, confirmDialog, errorState } from '../ui.js';
import { openHistory } from '../history.js';

const SECTION_KEYS = ['about', 'skills', 'projects', 'experience', 'education', 'certifications', 'contact'];
const PHONE = /^[0-9+()\s.-]{4,40}$/;

const PAGES = {
  profile: {
    table: 'profiles', entity: 'profile', title: 'Profile',
    desc: 'Your name, headline, about text, contact details and photo. Edits are saved as a draft until you publish.',
    sections: [
      { title: 'Identity', fields: [
        { name: 'full_name', label: 'Name', required: true, max: 120 },
        { name: 'handle', label: 'Handle / brand', max: 40, pattern: /^[A-Za-z0-9_.-]{1,40}$/,
          patternMessage: 'Letters, numbers, dot, dash or underscore only.', hint: 'Shown as the big hero title and logo, e.g. kthedev.' },
        { name: 'designation', label: 'Professional designation', max: 200, emptyAs: '' },
        { name: 'location', label: 'Location', max: 120 },
        { name: 'availability', label: 'Availability line (optional)', max: 160, placeholder: 'e.g. Open to AI Engineer roles',
          hint: 'Shown with a green dot in the hero. Leave empty to hide.' },
        { name: 'avatar_path', label: 'Profile image', type: 'image', folder: 'profile', square: true, full: true },
      ] },
      { title: 'Hero', fields: [
        { name: 'tagline', label: 'Tagline', max: 160, full: true, placeholder: 'GenAI · Agentic AI · RAG · Python Backend',
          hint: 'Typed out in amber under your designation.' },
        { name: 'hero_headline', label: 'Headline', max: 200, full: true, emptyAs: '', hint: 'The text after the first full stop is highlighted in the accent colour.' },
        { name: 'hero_description', label: 'Supporting description', type: 'textarea', max: 600, rows: 3 },
        { name: 'intro', label: 'Short introduction', type: 'textarea', max: 600, rows: 3 },
        { name: 'focus_areas', label: 'Professional focus', type: 'list', rows: 6, maxItems: 20, hint: 'One per line. Shown beside the hero.' },
      ] },
      { title: 'About', fields: [
        { name: 'about_md', label: 'About me', type: 'markdown', max: 10000, rows: 12 },
      ] },
      { title: 'Contact & social', fields: [
        { name: 'email', label: 'Email', type: 'email', max: 254 },
        { name: 'phone', label: 'Phone', max: 40, pattern: PHONE, patternMessage: 'Use digits, spaces and + ( ) . - only.' },
        { name: 'github_url', label: 'GitHub URL', type: 'url', max: 2048 },
        { name: 'linkedin_url', label: 'LinkedIn URL', type: 'url', max: 2048 },
        { name: 'footer_text', label: 'Footer text', max: 300, full: true },
      ] },
      { title: 'SEO', fields: [
        { name: 'seo_title', label: 'SEO title', max: 120, hint: 'About 50–60 characters display fully in search results.' },
        { name: 'seo_description', label: 'SEO description', type: 'textarea', max: 320, rows: 3 },
      ] },
    ],
  },
  settings: {
    table: 'site_settings', entity: 'settings', title: 'Website settings',
    desc: 'Site title, SEO, sharing image, favicon and which sections are public.',
    sections: [
      { title: 'General & SEO', fields: [
        { name: 'site_title', label: 'Website title', required: true, max: 120 },
        { name: 'canonical_url', label: 'Canonical site URL', type: 'url', max: 2048, placeholder: 'https://kunal-2301.github.io',
          hint: 'Used for canonical links and structured data.' },
        { name: 'meta_description', label: 'Meta description', type: 'textarea', max: 320, rows: 3 },
        { name: 'keywords', label: 'Keywords', type: 'textarea', max: 500, rows: 2 },
      ] },
      { title: 'Sharing & icons', fields: [
        { name: 'og_image_path', label: 'Social sharing image', type: 'image', folder: 'site', hint: '1200×630 recommended.' },
        { name: 'favicon_path', label: 'Favicon', type: 'image', folder: 'site', square: true, hint: 'Square PNG, at least 180×180.' },
      ] },
      { title: 'Contact information', fields: [
        { name: 'contact_email', label: 'Contact email', type: 'email', max: 254 },
        { name: 'contact_phone', label: 'Contact phone', max: 40, pattern: PHONE, patternMessage: 'Use digits, spaces and + ( ) . - only.' },
      ] },
      { title: 'Public sections', description: 'Hidden sections are removed from the page and the navigation.', fields: [
        ...SECTION_KEYS.map((k) => ({ name: `section_${k}`, label: k, type: 'toggle', toggleLabel: `Show ${k[0].toUpperCase()}${k.slice(1)}` })),
      ] },
      { title: 'AI portfolio assistant', description: 'A chat panel that answers visitor questions using only your published content, with sources.', fields: [
        { name: 'assistant_enabled', label: 'Assistant', type: 'toggle', toggleLabel: 'Show the “ask” assistant on the site',
          hint: 'Requires the ask Edge Function and an ANTHROPIC_API_KEY secret (docs/SETUP.md §5). Each question costs roughly 2–4 US cents; limits: 10 per visitor per hour, 300 per day overall (configurable).' },
      ] },
      { title: 'Privacy', fields: [
        { name: 'analytics_enabled', label: 'Analytics', type: 'toggle', toggleLabel: 'Collect anonymous, cookieless analytics',
          hint: 'No cookies, no IP storage. Visitors with Do Not Track or Global Privacy Control are never counted.' },
      ] },
    ],
    fromRow: (r) => ({ ...r, ...Object.fromEntries(SECTION_KEYS.map((k) => [`section_${k}`, r.sections?.[k] !== false])) }),
    toRow: (v) => {
      const out = { ...v, sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, !!v[`section_${k}`]])) };
      SECTION_KEYS.forEach((k) => delete out[`section_${k}`]);
      return out;
    },
  },
};

export async function render({ root, params, app }) {
  const cfg = PAGES[params[0]];
  let live, draft;
  try {
    [live, draft] = await Promise.all([
      data(db().from(cfg.table).select('*').eq('id', 1).maybeSingle()),
      data(db().from('content_drafts').select('data, updated_at').eq('entity_type', cfg.entity).maybeSingle()),
    ]);
  } catch (e) {
    return mount(root, pageHeader({ title: cfg.title }), errorState(e, () => render({ root, params, app })));
  }
  if (!live) return mount(root, pageHeader({ title: cfg.title }), h('div', { class: 'alert alert-warning' }, icon('alert'),
    h('div', { class: 'grow' }, 'The database row is missing. Run database/seed.sql (see docs/SETUP.md).')));

  const fromRow = cfg.fromRow || ((r) => r);
  const toRow = cfg.toRow || ((v) => v);
  const fieldNames = cfg.sections.flatMap((s) => s.fields.map((f) => f.name));
  const form = createForm({ sections: cfg.sections, values: fromRow({ ...live, ...(draft?.data || {}) }), idPrefix: cfg.entity });

  const banner = h('div');
  const dirtyEl = h('span', { class: 'dirty-flag', hidden: true }, 'Unsaved changes');
  const saveBtn = btn('Save draft', { icon: 'save' });
  const previewBtn = btn('Preview', { icon: 'eye', variant: 'ghost' });
  const publishBtn = btn('Publish', { icon: 'send', variant: 'primary' });
  const historyBtn = btn('', { icon: 'history', variant: 'ghost', title: 'Version history', ariaLabel: 'Version history',
    onClick: () => openHistory({ entityType: cfg.entity, entityId: 1, table: cfg.table, title: cfg.title, onRestored: () => render({ root, params, app }) }) });

  function drawBanner() {
    mount(banner, draft ? h('div', { class: 'alert alert-warning', style: { marginBottom: '16px' } }, icon('edit'),
      h('div', { class: 'grow' }, `Unpublished draft saved ${relativeTime(draft.updated_at)}. Visitors still see the published version.`),
      btn('Discard draft', { size: 'sm', variant: 'ghost', onClick: discard }))
      : h('div', { class: 'alert alert-success', style: { marginBottom: '16px' } }, icon('checkCircle'),
        h('div', { class: 'grow' }, 'Everything here is published.')));
    dirtyEl.hidden = !form.isDirty();
  }

  const payload = () => Object.fromEntries(Object.entries(toRow(form.values())).filter(([k]) => fieldNames.includes(k) || k === 'sections'));

  async function saveDraft({ quiet } = {}) {
    if (!form.validate().ok) { toast('Please fix the highlighted fields.', 'error'); return false; }
    try {
      const [row] = await data(db().from('content_drafts').upsert({ entity_type: cfg.entity, data: payload() }).select('data, updated_at'));
      draft = row;
      form.markClean();
      drawBanner();
      if (!quiet) toast('Draft saved. Not visible to visitors until you publish.');
      return true;
    } catch (e) { toastError(e); return false; }
  }

  async function discard() {
    if (!(await confirmDialog({ title: 'Discard the draft?', message: 'Your unpublished edits will be lost. The published version stays as it is.', confirmText: 'Discard draft', danger: true }))) return;
    try {
      await run(db().from('content_drafts').delete().eq('entity_type', cfg.entity));
      draft = null;
      form.setValues(fromRow(live)); form.markClean(); drawBanner();
      toast('Draft discarded.');
    } catch (e) { toastError(e); }
  }

  saveBtn.addEventListener('click', () => busy(saveBtn, () => saveDraft(), 'Saving…'));
  previewBtn.addEventListener('click', async () => {
    if ((form.isDirty() || !draft) && !(await saveDraft({ quiet: true }))) return;
    app.navigate(`/preview?path=index.html&back=${encodeURIComponent(`/${params[0]}`)}`);
  });
  publishBtn.addEventListener('click', () => busy(publishBtn, async () => {
    if ((form.isDirty() || !draft) && !(await saveDraft({ quiet: true }))) return;
    if (!(await confirmDialog({ title: `Publish ${cfg.title.toLowerCase()}?`, message: 'Changes go live on your portfolio immediately. The current version is kept in history.', confirmText: 'Publish' }))) return;
    try {
      await rpc('publish_draft', { p_entity: cfg.entity });
      live = await data(db().from(cfg.table).select('*').eq('id', 1).single());
      draft = null;
      form.markClean(); drawBanner();
      toast('Published — your site is updated.');
    } catch (e) { toastError(e); }
  }, 'Publishing…'));

  form.el.addEventListener('input', () => { dirtyEl.hidden = !form.isDirty(); });
  form.el.addEventListener('change', () => { dirtyEl.hidden = !form.isDirty(); });
  app.setGuard(() => form.isDirty());

  mount(root,
    pageHeader({ title: cfg.title, desc: cfg.desc }),
    h('div', { class: 'editor-bar' }, h('div', { class: 'title' }, dirtyEl), historyBtn, previewBtn, saveBtn, publishBtn),
    banner, h('div', { class: 'card card-pad' }, form.el));
  drawBanner();
}
