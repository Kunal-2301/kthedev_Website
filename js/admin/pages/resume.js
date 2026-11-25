// Resume manager: multiple versions, preview, replace, rename, default, activate, delete.
// Files are in the PRIVATE "resumes" bucket; the public button uses the resume Edge Function.
import { h, mount, formatDateTime, relativeTime } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { functionUrl } from '../../core/supabase.js';
import { db, data, run, rpc, upload, signedUrl, removeFiles, validateFile } from '../api.js';
import { pageHeader, btn, busy, emptyState, loadingRows, statusBadge, confirmDialog, toast, toastError, errorState,
         drawer, createForm, confirmDiscard, modal } from '../ui.js';
import { describeAction } from './activity.js';

const mb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function render({ root }) {
  const list = h('div');
  const historyBox = h('div');
  const publicLink = functionUrl('resume');

  async function load() {
    mount(list, loadingRows(3));
    try {
      const [rows, logs] = await Promise.all([
        data(db().from('resumes').select('*').order('is_default', { ascending: false }).order('created_at', { ascending: false })),
        data(db().from('admin_activity_logs').select('*').eq('entity_type', 'resume').order('created_at', { ascending: false }).limit(20)),
      ]);
      draw(rows);
      mount(historyBox, logs.length ? h('ul', { class: 'feed' }, logs.map((l) => h('li', null, h('span', { class: 'ico' }, icon('file')),
        h('div', null, describeAction(l), h('div', { class: 'who' }, l.actor_email || 'system')),
        h('span', { class: 'when', title: formatDateTime(l.created_at) }, relativeTime(l.created_at))))) :
        h('p', { class: 'small muted' }, 'No uploads yet.'));
    } catch (e) { mount(list, errorState(e, load)); }
  }

  async function preview(r) {
    try {
      const url = await signedUrl('resumes', r.storage_path, { expiresIn: 600 });
      modal({ title: r.title, wide: true, body: h('div', { class: 'stack' },
        h('iframe', { class: 'pdf-frame', src: url, title: `${r.title} PDF preview` }),
        h('p', { class: 'small muted' }, 'On iPhone/iPad the inline viewer may show only the first page — use “Open in new tab”.'),
        h('div', { class: 'row-gap' }, btn('Open in new tab', { icon: 'external', href: url }))) });
    } catch (e) { toastError(e); }
  }

  async function download(r) {
    try { location.href = await signedUrl('resumes', r.storage_path, { download: `${r.title.replace(/[^\w -]/g, '').trim() || 'resume'}.pdf` }); }
    catch (e) { toastError(e); }
  }

  function edit(r) {
    const form = createForm({ idPrefix: 'rs', values: r || { is_active: true }, sections: [{ fields: [
      { name: 'title', label: 'Name', required: true, max: 120, placeholder: 'e.g. AI Engineer Resume', full: true },
      { name: 'description', label: 'Description', type: 'textarea', max: 500, rows: 3, hint: 'Private note, e.g. which roles this version targets.' },
      !r && { name: 'file', label: 'PDF file', full: true, required: true, render: () => {
        const input = h('input', { type: 'file', accept: 'application/pdf', class: 'input', id: 'rs-file' });
        return { el: input, input, get: () => input.files[0] || null, set: () => { input.value = ''; } };
      }, hint: 'PDF up to 10 MB.' },
      !r && { name: 'make_default', label: 'Public', type: 'toggle', toggleLabel: 'Use as the public “Download resume” file' },
    ].filter(Boolean) }] });
    const save = btn(r ? 'Save' : 'Upload resume', { icon: r ? 'save' : 'upload', variant: 'primary' });
    const d = drawer({ title: r ? 'Edit resume details' : 'Upload a resume', body: form.el, footer: [btn('Cancel', { onClick: () => d.close() }), save],
      beforeClose: async () => !form.isDirty() || confirmDiscard() });
    save.addEventListener('click', () => busy(save, async () => {
      if (!form.validate().ok) return;
      const v = form.values();
      try {
        if (r) {
          await run(db().from('resumes').update({ title: v.title, description: v.description || null }).eq('id', r.id));
        } else {
          await validateFile('resumes', v.file);
          const path = await upload('resumes', 'resumes', v.file, { optimize: false });
          const [row] = await data(db().from('resumes').insert({ title: v.title, description: v.description || null, storage_path: path,
            original_name: v.file.name.slice(0, 255), file_size: v.file.size, is_active: true }).select('id'));
          if (v.make_default) await rpc('set_default_resume', { p_id: row.id });
        }
        form.markClean();
        await d.close(true);
        toast(r ? 'Resume details saved.' : 'Resume uploaded.');
        load();
      } catch (e) { toastError(e); }
    }, r ? 'Saving…' : 'Uploading…'));
  }

  function replace(r) {
    const input = h('input', { type: 'file', accept: 'application/pdf', class: 'sr-only', aria: { label: `Replacement PDF for ${r.title}` } });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      if (!(await confirmDialog({ title: `Replace the file for “${r.title}”?`,
        message: `${r.is_default ? 'Visitors will immediately download the new file. ' : ''}The previous file is kept so this change can be undone from version history.`,
        confirmText: 'Replace file' }))) return;
      try {
        const path = await upload('resumes', 'resumes', file, { optimize: false });
        await run(db().from('resumes').update({ storage_path: path, file_size: file.size, original_name: file.name.slice(0, 255) }).eq('id', r.id));
        toast('Resume file replaced.');
        load();
      } catch (e) { toastError(e); }
    });
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  }

  async function setDefault(r) {
    try { await rpc('set_default_resume', { p_id: r.id }); toast(`“${r.title}” is now the public resume.`); load(); }
    catch (e) { toastError(e); }
  }
  async function toggleActive(r) {
    if (r.is_default && r.is_active) return toast('Choose another public resume before deactivating this one.', 'error');
    try { await run(db().from('resumes').update({ is_active: !r.is_active }).eq('id', r.id)); load(); } catch (e) { toastError(e); }
  }
  async function remove(r) {
    if (r.is_default) return toast('This is the public resume. Set another default before deleting it.', 'error');
    if (!(await confirmDialog({ title: `Delete “${r.title}”?`, message: 'The record and its PDF file are permanently deleted.', confirmText: 'Delete', danger: true }))) return;
    try {
      await run(db().from('resumes').delete().eq('id', r.id));
      await removeFiles('resumes', [r.storage_path]).catch(() => {});
      toast('Resume deleted.');
      load();
    } catch (e) { toastError(e); }
  }

  function draw(rows) {
    if (!rows.length) {
      return mount(list, h('div', { class: 'card' }, emptyState({ icon: 'file', title: 'No resumes yet',
        text: 'Upload a PDF and set it as public to show the “Download resume” button on your site.',
        action: btn('Upload resume', { icon: 'upload', variant: 'primary', onClick: () => edit(null) }) })));
    }
    mount(list, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'Resume'), h('th', null, 'Status'), h('th', null, 'File'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { data: { label: 'Resume' } }, h('div', { class: 'cell-title' }, r.title), r.description && h('div', { class: 'cell-sub' }, r.description)),
        h('td', { data: { label: 'Status' } }, h('div', { class: 'row-gap' },
          r.is_default && statusBadge('published', 'Public default'), statusBadge(r.is_active ? 'active' : 'inactive'))),
        h('td', { data: { label: 'File' } }, h('div', null, mb(r.file_size)), h('div', { class: 'cell-sub' }, `Updated ${relativeTime(r.updated_at)}`)),
        h('td', null, h('div', { class: 'cell-actions' },
          btn('Preview', { icon: 'eye', size: 'sm', onClick: () => preview(r) }),
          btn('', { icon: 'download', size: 'sm', variant: 'ghost', title: 'Download', onClick: () => download(r) }),
          !r.is_default && r.is_active && btn('Set as public', { size: 'sm', variant: 'ghost', onClick: () => setDefault(r) }),
          btn('', { icon: 'upload', size: 'sm', variant: 'ghost', title: 'Replace file', onClick: () => replace(r) }),
          btn('', { icon: 'edit', size: 'sm', variant: 'ghost', title: 'Rename / describe', onClick: () => edit(r) }),
          btn(r.is_active ? 'Deactivate' : 'Activate', { size: 'sm', variant: 'ghost', onClick: () => toggleActive(r) }),
          btn('', { icon: 'trash', size: 'sm', variant: 'ghost', title: 'Delete', onClick: () => remove(r) })))))))));
  }

  const copy = btn('Copy link', { icon: 'copy', size: 'sm', onClick: async () => {
    try { await navigator.clipboard.writeText(publicLink); toast('Public resume link copied.'); } catch { toast(publicLink, 'info'); }
  } });

  mount(root,
    pageHeader({ title: 'Resume', desc: 'Keep several versions and choose which one the public “Download resume” button serves.',
      actions: [btn('Upload resume', { icon: 'upload', variant: 'primary', onClick: () => edit(null) })] }),
    h('div', { class: 'card card-pad', style: { marginBottom: '20px' } }, h('div', { class: 'row-gap', style: { justifyContent: 'space-between' } },
      h('div', null, h('strong', null, 'Public download link'),
        h('div', { class: 'small muted', style: { wordBreak: 'break-all' } }, publicLink),
        h('div', { class: 'small muted' }, 'Always serves the current public resume through a short-lived secure link, and counts downloads.')),
      copy)),
    list,
    h('section', { class: 'card mt-6' }, h('div', { class: 'card-head' }, h('h2', null, 'Upload history')), h('div', { class: 'card-body' }, historyBox)));
  load();
}
