// Project editor: tabs, technologies picker, media manager, publishing & scheduling.
// Saves atomically through the save_project RPC (row + technologies + images) with
// optimistic concurrency. Unsaved work is also backed up locally in this browser.
import { h, mount, formatDateTime, relativeTime, slugify, PROJECT_STATUS, debounce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { publicUrl } from '../../core/supabase.js';
import { db, data, run, rpc, upload, friendlyError } from '../api.js';
import { createForm, tabs, btn, busy, toast, toastError, confirmDialog, modal, statusBadge, linkSlug, errorState, pageHeader } from '../ui.js';
import { openHistory } from '../history.js';
import { projectStatusBadge } from './projects.js';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'file' },
  { id: 'details', label: 'Details', icon: 'edit' },
  { id: 'technologies', label: 'Technologies', icon: 'layers' },
  { id: 'media', label: 'Media', icon: 'image' },
  { id: 'links', label: 'Links', icon: 'link' },
  { id: 'seo', label: 'SEO', icon: 'search' },
  { id: 'publishing', label: 'Publishing', icon: 'send' },
];
const PROJECT_COLUMNS = ['slug', 'title', 'short_description', 'description_md', 'problem_md', 'solution_md', 'architecture_md',
  'implementation_md', 'key_features', 'challenges', 'category', 'project_status', 'github_url', 'demo_url', 'docs_url', 'resources',
  'metrics', 'cover_image_path', 'cover_alt', 'is_featured', 'status', 'publish_at', 'unpublish_at', 'seo_title', 'seo_description'];

// ---------------------------------------------------------------- technologies picker
function techPicker(skills, categories, onSkillCreated) {
  let chosen = [];
  const byId = () => new Map(skills.map((s) => [s.id, s]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const input = h('input', { class: 'input', type: 'text', placeholder: 'Search technologies, e.g. LangGraph…', autocomplete: 'off',
    role: 'combobox', aria: { expanded: 'false', controls: 'tech-results', autocomplete: 'list' } });
  const results = h('div', { class: 'picker-results', id: 'tech-results', role: 'listbox', hidden: true });
  const list = h('div', { class: 'media-list' });
  const root = h('div', null, h('div', { class: 'picker' }, input, results),
    h('p', { class: 'hint', style: { marginTop: '6px' } }, 'Pick from your skills list, or create a new skill without leaving the editor. Order matters: the first five show on project cards.'),
    list);
  let active = 0;
  let options = [];

  const emit = () => root.dispatchEvent(new Event('input', { bubbles: true }));
  function add(id) { if (!chosen.includes(id)) chosen.push(id); input.value = ''; close(); drawChosen(); emit(); input.focus(); }
  function close() { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  function drawResults() {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const matches = skills.filter((s) => !chosen.includes(s.id) && s.name.toLowerCase().includes(q)).slice(0, 8);
    const exact = skills.some((s) => s.name.toLowerCase() === q);
    options = matches.map((s) => ({ label: s.name, sub: catName.get(s.category_id), run: () => add(s.id) }));
    if (!exact) options.push({ label: `Create “${input.value.trim()}”`, sub: 'New skill', run: () => createSkill(input.value.trim()) });
    active = Math.min(active, options.length - 1);
    mount(results, options.map((o, i) => h('button', { type: 'button', role: 'option', id: `tech-opt-${i}`, aria: { selected: String(i === active) },
      on: { mousedown: (e) => e.preventDefault(), click: o.run } }, h('span', null, o.label), h('small', null, o.sub || ''))));
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `tech-opt-${active}`);
  }
  input.addEventListener('input', () => { active = 0; drawResults(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % options.length; drawResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + options.length) % options.length; drawResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); options[active]?.run(); }
    else if (e.key === 'Escape') close();
  });

  function createSkill(name) {
    close();
    const cat = h('select', { class: 'select', id: 'ns-cat' }, categories.map((c) => h('option', { value: c.id }, c.name)));
    const level = h('select', { class: 'select', id: 'ns-level' },
      [['exploring', 'Currently exploring'], ['familiar', 'Familiar'], ['experienced', 'Experienced / used in projects']].map(([v, l]) => h('option', { value: v }, l)));
    const nameIn = h('input', { class: 'input', id: 'ns-name', value: name, maxlength: 60 });
    const save = btn('Create skill', { variant: 'primary' });
    const m = modal({ title: 'New skill', body: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { for: 'ns-name' }, 'Name'), nameIn),
      h('div', { class: 'field' }, h('label', { for: 'ns-cat' }, 'Category'), cat),
      h('div', { class: 'field' }, h('label', { for: 'ns-level' }, 'Experience'), level),
      h('p', { class: 'hint' }, 'The skill is added to your Skills list and is visible there by default.')),
    footer: [btn('Cancel', { onClick: () => m.close() }), save] });
    save.addEventListener('click', () => busy(save, async () => {
      try {
        const n = nameIn.value.trim();
        if (!n) throw new Error('Enter a name.');
        const [row] = await data(db().from('skills').insert({ name: n, category_id: cat.value, level: level.value,
          sort_order: 999 }).select('id, name, category_id, level'));
        skills.push(row);
        onSkillCreated?.(row);
        m.close();
        add(row.id);
        toast(`Skill “${row.name}” created.`);
      } catch (e) { toastError(e); }
    }));
  }

  function drawChosen() {
    const map = byId();
    mount(list, chosen.length ? chosen.map((id, i) => {
      const s = map.get(id);
      return h('div', { class: 'media-item', style: { gridTemplateColumns: 'minmax(0,1fr) auto' } },
        h('div', null, h('strong', null, s?.name || 'Unknown skill'), h('div', { class: 'small muted' }, catName.get(s?.category_id) || '')),
        h('div', { class: 'acts', style: { flexDirection: 'row' } },
          btn('', { icon: 'arrowUp', size: 'sm', variant: 'ghost', ariaLabel: `Move ${s?.name} up`, disabled: i === 0,
            onClick: () => { [chosen[i - 1], chosen[i]] = [chosen[i], chosen[i - 1]]; drawChosen(); emit(); } }),
          btn('', { icon: 'arrowDown', size: 'sm', variant: 'ghost', ariaLabel: `Move ${s?.name} down`, disabled: i === chosen.length - 1,
            onClick: () => { [chosen[i + 1], chosen[i]] = [chosen[i], chosen[i + 1]]; drawChosen(); emit(); } }),
          btn('', { icon: 'close', size: 'sm', variant: 'ghost', ariaLabel: `Remove ${s?.name}`,
            onClick: () => { chosen.splice(i, 1); drawChosen(); emit(); } })));
    }) : h('p', { class: 'small muted' }, 'No technologies selected yet.'));
  }
  drawChosen();
  return { el: root, input, get: () => [...chosen], set: (v) => { chosen = Array.isArray(v) ? [...v] : []; drawChosen(); } };
}

// ---------------------------------------------------------------- media (screenshots + architecture diagrams)
function galleryControl(getFolder) {
  let items = [];
  const root = h('div', { class: 'stack' });
  const emit = () => root.dispatchEvent(new Event('input', { bubbles: true }));

  function group(kind, title, help) {
    const listEl = h('div', { class: 'media-list' });
    const fileIn = h('input', { type: 'file', class: 'sr-only', accept: 'image/png,image/jpeg,image/webp,image/avif,image/gif', multiple: true, tabindex: '-1',
      aria: { label: `Choose ${title.toLowerCase()} to upload` } });
    const progress = h('p', { class: 'small muted', aria: { live: 'polite' } });
    const zone = h('div', { class: 'dropzone', role: 'button', tabindex: '0' },
      icon('upload'), h('strong', null, `Add ${title.toLowerCase()}`), h('span', null, 'Click or drop images · PNG, JPG, WebP · large images are optimized automatically'));
    const pick = () => fileIn.click();
    zone.addEventListener('click', pick);
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag'); handle([...e.dataTransfer.files]); });
    fileIn.addEventListener('change', () => { const f = [...fileIn.files]; fileIn.value = ''; handle(f); });

    async function handle(files) {
      let done = 0;
      for (const file of files) {
        progress.textContent = `Uploading ${done + 1} of ${files.length}…`;
        try {
          const path = await upload('media', `${getFolder()}/${kind}`, file);
          items.push({ kind, storage_path: path, alt_text: '', caption: '' });
          draw(); emit();
        } catch (e) { toast(`${file.name}: ${friendlyError(e)}`, 'error'); }
        done += 1;
      }
      progress.textContent = files.length ? 'Upload complete. Add alt text, then save.' : '';
    }

    function draw() {
      const mine = items.filter((x) => x.kind === kind);
      mount(listEl, mine.map((it) => {
        const idx = items.indexOf(it);
        const siblings = () => items.filter((x) => x.kind === kind);
        const move = (dir) => {
          const s = siblings(); const i = s.indexOf(it); const j = i + dir;
          if (j < 0 || j >= s.length) return;
          const a = items.indexOf(s[i]); const b = items.indexOf(s[j]);
          [items[a], items[b]] = [items[b], items[a]];
          drawAll(); emit();
        };
        return h('div', { class: 'media-item' },
          h('img', { src: publicUrl('media', it.storage_path), alt: '' }),
          h('div', { class: 'fields' },
            h('label', { class: 'small', for: `alt-${idx}` }, 'Alt text (describes the image for screen readers)'),
            h('input', { class: 'input', id: `alt-${idx}`, value: it.alt_text, maxlength: 200, aria: { invalid: it.alt_text ? 'false' : 'true' },
              on: { input: (e) => { it.alt_text = e.target.value; e.target.setAttribute('aria-invalid', String(!e.target.value.trim())); } } }),
            h('label', { class: 'small', for: `cap-${idx}` }, 'Caption (optional)'),
            h('input', { class: 'input', id: `cap-${idx}`, value: it.caption || '', maxlength: 300, on: { input: (e) => { it.caption = e.target.value; } } })),
          h('div', { class: 'acts' },
            btn('', { icon: 'arrowUp', size: 'sm', variant: 'ghost', ariaLabel: 'Move up', onClick: () => move(-1) }),
            btn('', { icon: 'arrowDown', size: 'sm', variant: 'ghost', ariaLabel: 'Move down', onClick: () => move(1) }),
            btn('', { icon: 'trash', size: 'sm', variant: 'ghost', ariaLabel: 'Remove image', onClick: async () => {
              if (!(await confirmDialog({ title: 'Remove this image?', message: 'It is removed from the project when you save. The file is kept for version history.', confirmText: 'Remove' }))) return;
              items.splice(items.indexOf(it), 1); drawAll(); emit();
            } })));
      }));
    }
    return { el: h('section', { class: 'stack' }, h('div', null, h('h4', null, title), h('p', { class: 'small muted' }, help)), listEl, zone, fileIn, progress), draw };
  }

  const shots = group('screenshot', 'Screenshots', 'Shown as a gallery on the project page.');
  const arch = group('architecture', 'Architecture diagrams', 'Shown under the Architecture section.');
  const drawAll = () => { shots.draw(); arch.draw(); };
  mount(root, shots.el, arch.el);
  return {
    el: root,
    get: () => items.map((x) => ({ ...(x.id ? { id: x.id } : {}), kind: x.kind, storage_path: x.storage_path, alt_text: (x.alt_text || '').trim(), caption: (x.caption || '').trim() })),
    set: (v) => { items = (v || []).map((x) => ({ ...x })); drawAll(); },
    validate: (v) => (v.some((x) => !x.alt_text) ? 'Every image needs alt text (Media tab).' : null),
  };
}

// ---------------------------------------------------------------- page
export async function render({ root, params, app }) {
  const isNew = params[0] === 'new';
  let projectId = isNew ? null : params[0];
  let revision = null;
  let saved = null; // last saved row

  let skills, categories, existingCats, project = null;
  try {
    const [s, c, cats, p] = await Promise.all([
      data(db().from('skills').select('id, name, category_id, level').order('name')),
      data(db().from('skill_categories').select('id, name').order('sort_order')),
      data(db().from('projects').select('category')),
      isNew ? null : data(db().from('projects')
        .select('*, project_technologies(skill_id, sort_order), project_images(id, kind, storage_path, alt_text, caption, sort_order)')
        .eq('id', projectId).maybeSingle()),
    ]);
    skills = s; categories = c; existingCats = [...new Set(cats.map((x) => x.category).filter(Boolean))].sort();
    project = p;
  } catch (e) {
    mount(root, pageHeader({ title: 'Project', crumbs: [{ label: 'Projects', href: '#/projects' }] }), errorState(e, () => render({ root, params, app })));
    return;
  }
  if (!isNew && !project) {
    mount(root, pageHeader({ title: 'Project not found', crumbs: [{ label: 'Projects', href: '#/projects' }] }),
      h('div', { class: 'card' }, h('div', { class: 'empty' }, h('p', null, 'It may have been deleted. Deleted projects can be restored from Activity logs → Version history.'),
        btn('Back to projects', { href: '#/projects' }))));
    return;
  }

  const toValues = (p) => p ? {
    ...Object.fromEntries(PROJECT_COLUMNS.map((k) => [k, p[k]])),
    technologies: (p.project_technologies || []).sort((a, b) => a.sort_order - b.sort_order).map((t) => t.skill_id),
    gallery: (p.project_images || []).sort((a, b) => (a.kind === b.kind ? a.sort_order - b.sort_order : a.kind === 'screenshot' ? -1 : 1)),
  } : { status: 'draft', project_status: 'completed', is_featured: false, key_features: [], challenges: [], metrics: [], resources: [], technologies: [], gallery: [] };

  revision = project?.revision ?? null;
  saved = project;
  const folder = () => `projects/${slugify(form?.get('slug') || 'new') || 'new'}`;

  const sections = [
    { tab: 'overview', title: 'Basic information', fields: [
      { name: 'title', label: 'Project name', required: true, max: 120, placeholder: 'e.g. Multi-Agent Research Assistant' },
      { name: 'slug', label: 'Slug', required: true, max: 120, pattern: SLUG_RE, patternMessage: 'Use lowercase letters, numbers and single hyphens (e.g. advanced-rag-pipeline).',
        hint: 'Used in the page URL: project.html?slug=…' },
      { name: 'category', label: 'Category', max: 60, placeholder: 'e.g. Generative AI', hint: 'Projects can be filtered by category on the site.' },
      { name: 'project_status', label: 'Project status', type: 'select', options: Object.entries(PROJECT_STATUS).map(([value, label]) => ({ value, label })) },
      { name: 'short_description', label: 'Short description', type: 'textarea', max: 300, rows: 3, required: true,
        hint: 'One or two sentences for project cards and search results.' },
      { name: 'is_featured', label: 'Featured', type: 'toggle', toggleLabel: 'Feature this project (shown first)' },
    ] },
    { tab: 'details', title: 'Case study', description: 'Markdown is supported. Raw HTML is removed for security.', fields: [
      { name: 'description_md', label: 'Detailed description', type: 'markdown', max: 50000, rows: 10 },
      { name: 'problem_md', label: 'Problem statement', type: 'markdown', max: 20000, rows: 6 },
      { name: 'solution_md', label: 'Solution', type: 'markdown', max: 20000, rows: 6 },
      { name: 'architecture_md', label: 'Architecture', type: 'markdown', max: 20000, rows: 6, hint: 'Upload diagrams in the Media tab; they appear under this section.' },
      { name: 'implementation_md', label: 'Implementation details', type: 'markdown', max: 30000, rows: 8 },
      { name: 'key_features', label: 'Key features', type: 'list', rows: 5, maxItems: 40, hint: 'One per line.' },
      { name: 'challenges', label: 'Technical challenges', type: 'list', rows: 5, maxItems: 40, hint: 'One per line.' },
    ] },
    { tab: 'details', title: 'Results & metrics', description: 'Optional. Only add measured results you can stand behind — nothing is shown if left empty.', fields: [
      { name: 'metrics', label: 'Metrics', type: 'metrics', addLabel: 'Add metric', maxItems: 12 },
    ] },
    { tab: 'technologies', title: 'Technology stack', fields: [
      { name: 'technologies', label: 'Technologies', full: true, render: () => techPicker(skills, categories) },
    ] },
    { tab: 'media', title: 'Cover image', fields: [
      { name: 'cover_image_path', label: 'Cover image', type: 'image', bucket: 'media', folder: 'projects/covers', full: true,
        hint: '16:9 works best (e.g. 1600×900).' },
      { name: 'cover_alt', label: 'Cover alt text', max: 200, full: true,
        validate: (v, all) => (all.cover_image_path && !v ? 'Describe the cover image for screen readers.' : null) },
    ] },
    { tab: 'media', title: 'Gallery', fields: [
      { name: 'gallery', label: 'Images', full: true, render: () => galleryControl(folder) },
    ] },
    { tab: 'links', title: 'External links', fields: [
      { name: 'github_url', label: 'GitHub repository', type: 'url', max: 2048, placeholder: 'https://github.com/…' },
      { name: 'demo_url', label: 'Live demo', type: 'url', max: 2048, placeholder: 'https://…' },
      { name: 'docs_url', label: 'Documentation', type: 'url', max: 2048, placeholder: 'https://…' },
      { name: 'resources', label: 'Related resources', type: 'links', addLabel: 'Add resource', maxItems: 20, hint: 'Blog posts, papers, videos…' },
    ] },
    { tab: 'seo', title: 'Search & sharing', description: 'Leave empty to use the project name and short description.', fields: [
      { name: 'seo_title', label: 'SEO title', max: 120, hint: 'About 50–60 characters display fully in Google.' },
      { name: 'seo_description', label: 'SEO description', type: 'textarea', max: 320, rows: 3, hint: 'About 150–160 characters display fully.' },
    ] },
    { tab: 'publishing', title: 'Visibility', fields: [
      { name: 'status', label: 'Status', type: 'radio', options: [
        { value: 'draft', label: 'Draft', description: 'Private. Only visible to you in preview.' },
        { value: 'published', label: 'Published', description: 'Live on your portfolio.' },
        { value: 'scheduled', label: 'Scheduled', description: 'Goes live automatically at a set time.' },
        { value: 'archived', label: 'Archived', description: 'Hidden, kept for reference.' },
      ] },
      { name: 'publish_at', label: 'Publish at', type: 'datetime',
        validate: (v, all) => (all.status === 'scheduled' && !v ? 'Choose when to publish.'
          : all.status === 'scheduled' && new Date(v) <= new Date() ? 'Choose a time in the future.' : null),
        hint: 'Used when status is Scheduled. Your local time zone.' },
      { name: 'unpublish_at', label: 'Unpublish at (optional)', type: 'datetime',
        validate: (v, all) => (v && all.publish_at && new Date(v) <= new Date(all.publish_at) ? 'Must be after the publish time.' : null),
        hint: 'Automatically returns the project to draft at this time.' },
    ] },
  ];

  const form = createForm({ sections, values: toValues(project), idPrefix: 'p' });
  linkSlug(form, 'title', 'slug', isNew);
  const catInput = form.controls.get('category').input;
  catInput.setAttribute('list', 'category-options');
  form.el.append(h('datalist', { id: 'category-options' }, existingCats.map((c) => h('option', { value: c }))));

  // Tabs: show only the sections that belong to the selected tab
  const panels = h('div', { class: 'card card-pad' }, form.el);
  let currentTab = 'overview';
  const showTab = (id) => {
    currentTab = id;
    form.el.querySelectorAll('.form-section').forEach((s) => { s.hidden = s.dataset.tab !== id; });
    panels.querySelectorAll('[data-extra-tab]').forEach((x) => { x.hidden = x.dataset.extraTab !== id; });
  };
  const tabBar = tabs(TABS, 'overview', showTab);
  form.el.addEventListener('invalid-fields', (e) => { tabBar.markErrors(e.detail.tabs); tabBar.select(e.detail.tabs[0]); });

  // SEO snippet preview
  const snippet = h('div', { class: 'card card-pad', data: { extraTab: 'seo' }, style: { marginTop: '16px' } });
  const drawSnippet = () => {
    const v = form.values();
    mount(snippet, h('p', { class: 'small muted' }, 'Search result preview'),
      h('div', { style: { color: 'var(--info)', fontSize: '18px', marginTop: '6px' } }, (v.seo_title || v.title || 'Project title').slice(0, 65)),
      h('div', { class: 'small', style: { color: 'var(--success)' } }, `…/project.html?slug=${v.slug || 'slug'}`),
      h('div', { class: 'small muted' }, (v.seo_description || v.short_description || '').slice(0, 160)));
  };
  panels.append(snippet);

  // Scheduled updates for live projects
  const schedBox = h('div', { class: 'card card-pad', data: { extraTab: 'publishing' }, style: { marginTop: '16px' } });
  async function drawSchedule() {
    if (!projectId) return mount(schedBox, h('p', { class: 'small muted' }, 'Save the project first to schedule future updates.'));
    const pending = await data(db().from('scheduled_updates').select('id, run_at, status, error, created_at').eq('entity_id', projectId)
      .in('status', ['pending', 'failed']).order('run_at')).catch(() => []);
    const when = h('input', { class: 'input', type: 'datetime-local', id: 'sched-at', style: { maxWidth: '260px' } });
    const go = btn('Schedule current changes', { icon: 'clock' });
    go.addEventListener('click', () => busy(go, async () => {
      if (!when.value || new Date(when.value) <= new Date()) return toast('Choose a future date and time.', 'error');
      if (!form.validate().ok) return;
      const v = form.values();
      const payload = { project: { ...buildProject(v), status: saved.status === 'scheduled' ? 'scheduled' : saved.status }, technologies: v.technologies, images: v.gallery };
      try {
        await run(db().from('scheduled_updates').insert({ entity_id: projectId, payload, run_at: new Date(when.value).toISOString() }));
        // keep the live version as-is: revert the form to the saved state
        form.setValues(toValues(saved)); form.markClean(); clearBackup(); updateBar();
        toast('Update scheduled. The live project is unchanged until then.');
        drawSchedule();
      } catch (e) { toastError(e); }
    }));
    mount(schedBox,
      h('h3', null, 'Schedule an update'),
      h('p', { class: 'small muted', style: { margin: '4px 0 12px' } },
        'Edit the project in the other tabs, then schedule those edits instead of saving them now. The live page stays unchanged until the chosen time; the database applies the update even if this dashboard is closed.'),
      h('div', { class: 'row-gap' }, h('label', { for: 'sched-at', class: 'sr-only' }, 'Apply update at'), when, go),
      pending.length > 0 && h('ul', { class: 'feed mt-4' }, pending.map((u) => h('li', null,
        h('span', { class: 'ico' }, icon(u.status === 'failed' ? 'alert' : 'clock')),
        h('div', null, h('div', null, `${u.status === 'failed' ? 'Failed' : 'Pending'} update · ${formatDateTime(u.run_at)}`),
          u.error && h('div', { class: 'small', style: { color: 'var(--danger)' } }, u.error)),
        btn('Cancel', { size: 'sm', variant: 'ghost', onClick: async () => {
          if (!(await confirmDialog({ title: 'Cancel this scheduled update?', confirmText: 'Cancel update', cancelText: 'Keep' }))) return;
          try { await run(db().from('scheduled_updates').update({ status: 'cancelled' }).eq('id', u.id)); drawSchedule(); }
          catch (e) { toastError(e); }
        } })))));
  }
  panels.append(schedBox);

  // Danger zone
  const danger = h('div', { class: 'card card-pad', data: { extraTab: 'publishing' }, style: { marginTop: '16px', borderColor: 'var(--danger-soft)' } },
    h('h3', null, 'Delete project'),
    h('p', { class: 'small muted', style: { margin: '4px 0 12px' } }, 'Removes the project from the CMS and the public site. A snapshot is kept in version history.'),
    btn('Delete project', { icon: 'trash', variant: 'danger', onClick: async () => {
      if (!projectId) return;
      if (!(await confirmDialog({ title: `Delete “${form.get('title')}”?`, message: 'This cannot be undone from this page, but the project can be restored from Activity logs → Version history.', confirmText: 'Delete project', danger: true }))) return;
      try {
        await run(db().from('projects').delete().eq('id', projectId));
        form.markClean(); clearBackup();
        toast('Project deleted.');
        app.navigate('/projects');
      } catch (e) { toastError(e); }
    } }));
  if (projectId) panels.append(danger);

  // ---------------------------------------------------------------- local backup (never lose typed work)
  const backupKey = () => `kg:draft:project:${projectId || 'new'}`;
  const clearBackup = () => { try { localStorage.removeItem(backupKey()); localStorage.removeItem('kg:draft:project:new'); } catch { /* */ } };
  const backup = debounce(() => {
    if (!form.isDirty()) return;
    try { localStorage.setItem(backupKey(), JSON.stringify({ at: Date.now(), values: form.values() })); } catch { /* quota */ }
  }, 800);
  let restoreBanner = null;
  try {
    const b = JSON.parse(localStorage.getItem(backupKey()) || 'null');
    if (b && (!project || b.at > new Date(project.updated_at).getTime()) && JSON.stringify(b.values) !== JSON.stringify(form.values())) {
      restoreBanner = h('div', { class: 'alert alert-info', style: { marginBottom: '16px' } }, icon('history'),
        h('div', { class: 'grow' }, `Unsaved changes from ${relativeTime(b.at)} were found in this browser.`),
        btn('Restore', { size: 'sm', onClick: () => { form.setValues(b.values); restoreBanner.remove(); updateBar(); toast('Unsaved changes restored. Review and save.', 'info'); } }),
        btn('Discard', { size: 'sm', variant: 'ghost', onClick: () => { clearBackup(); restoreBanner.remove(); } }));
    }
  } catch { /* ignore */ }

  // ---------------------------------------------------------------- top bar & save
  const titleEl = h('h1');
  const statusEl = h('span');
  const dirtyEl = h('span', { class: 'dirty-flag', hidden: true }, 'Unsaved changes');
  const saveBtn = btn('Save', { icon: 'save' });
  const publishBtn = btn('Publish now', { icon: 'send', variant: 'primary' });
  const previewBtn = btn('Preview', { icon: 'eye', variant: 'ghost' });
  const historyBtn = btn('', { icon: 'history', variant: 'ghost', title: 'Version history', ariaLabel: 'Version history' });

  function updateBar() {
    const v = form.values();
    titleEl.textContent = v.title || 'Untitled project';
    mount(statusEl, saved ? projectStatusBadge(saved) : statusBadge('draft', 'New · not saved'));
    dirtyEl.hidden = !form.isDirty();
    publishBtn.hidden = saved?.status === 'published' && v.status === 'published';
    saveBtn.lastChild.textContent = saved?.status === 'published' && v.status === 'published' ? 'Update live project' : 'Save';
    historyBtn.hidden = !projectId;
  }

  function buildProject(v) {
    const out = Object.fromEntries(PROJECT_COLUMNS.map((k) => [k, v[k] ?? null]));
    out.short_description = out.short_description || '';
    for (const k of ['description_md', 'problem_md', 'solution_md', 'architecture_md', 'implementation_md']) out[k] = out[k] || '';
    if (out.status !== 'scheduled') out.publish_at = null;
    return out;
  }

  async function save(statusOverride) {
    if (statusOverride) form.set('status', statusOverride);
    const { ok } = form.validate();
    if (!ok) { toast('Please fix the highlighted fields.', 'error'); return false; }
    tabBar.markErrors([]);
    const v = form.values();
    try {
      const row = await rpc('save_project', {
        p_id: projectId, p_data: buildProject(v), p_technologies: v.technologies, p_images: v.gallery, p_expected_revision: revision,
      });
      const wasNew = !projectId;
      projectId = row.id;
      revision = row.revision;
      saved = row;
      // reload images to get their ids (keeps ids stable for history)
      const imgs = await data(db().from('project_images').select('id, kind, storage_path, alt_text, caption, sort_order').eq('project_id', projectId)).catch(() => null);
      if (imgs) form.set('gallery', imgs.sort((a, b) => (a.kind === b.kind ? a.sort_order - b.sort_order : a.kind === 'screenshot' ? -1 : 1)));
      form.markClean();
      clearBackup();
      if (wasNew) { history.replaceState(null, '', `#/projects/${projectId}`); panels.append(danger); showTab(currentTab); drawSchedule(); }
      updateBar();
      const live = row.status === 'published';
      toast(live ? 'Saved — changes are live on your portfolio.' : row.status === 'scheduled'
        ? `Saved — scheduled for ${formatDateTime(row.publish_at)}.` : 'Draft saved. Not visible to visitors.');
      return true;
    } catch (e) {
      if (e.code === '40001') {
        const reload = await confirmDialog({ title: 'This project changed elsewhere',
          message: `${e.message} Your edits are backed up in this browser and can be restored after reloading.`, confirmText: 'Reload latest', cancelText: 'Stay here' });
        if (reload) { backup(); form.markClean(); app.navigate('/projects'); setTimeout(() => app.navigate(`/projects/${projectId}`), 0); }
      } else toastError(e);
      return false;
    }
  }

  // busy() restores the button's previous label when it finishes, so refresh labels afterwards
  saveBtn.addEventListener('click', () => busy(saveBtn, () => save(), 'Saving…').then(updateBar));
  publishBtn.addEventListener('click', () => busy(publishBtn, () => save('published'), 'Publishing…').then(updateBar));
  previewBtn.addEventListener('click', async () => {
    if (!projectId || form.isDirty()) {
      const ok = await confirmDialog({ title: 'Save before previewing?', message: 'The preview shows the saved version. Save your changes first (status is kept as is).', confirmText: 'Save & preview' });
      if (!ok || !(await save())) return;
    }
    app.navigate(`/preview?path=${encodeURIComponent(`project.html?slug=${saved.slug}`)}&back=${encodeURIComponent(`/projects/${projectId}`)}`);
  });
  historyBtn.addEventListener('click', () => openHistory({ entityType: 'project', entityId: projectId, table: 'projects', title: form.get('title'),
    onRestored: () => { form.markClean(); app.navigate('/projects'); setTimeout(() => app.navigate(`/projects/${projectId}`), 0); } }));

  form.el.addEventListener('input', () => { updateBar(); backup(); drawSnippet(); tabBar.markErrors([]); });
  form.el.addEventListener('change', () => { updateBar(); backup(); });
  // Cmd/Ctrl+S saves
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveBtn.click(); } };
  document.addEventListener('keydown', onKey);

  app.setGuard(() => form.isDirty());

  mount(root,
    h('nav', { class: 'crumbs-admin', aria: { label: 'Breadcrumb' } }, h('a', { href: '#/projects' }, 'Projects'), icon('chevronRight'),
      h('span', { aria: { current: 'page' } }, isNew ? 'New project' : 'Edit')),
    h('div', { class: 'editor-bar' },
      h('div', { class: 'title' }, titleEl, h('div', { class: 'row-gap', style: { marginTop: '4px' } }, statusEl, dirtyEl)),
      historyBtn, previewBtn, saveBtn, publishBtn),
    restoreBanner, tabBar, panels);
  showTab('overview');
  drawSnippet();
  drawSchedule();
  updateBar();
  return () => document.removeEventListener('keydown', onKey);
}
