// Admin data layer: one authenticated Supabase client, friendly errors, uploads.
// Authorization is enforced by Postgres RLS + is_admin(); nothing here is trusted.
import { authClient } from '../core/supabase.js';

export const db = () => authClient({ detectSessionInUrl: true });

export class ApiError extends Error {
  constructor(message, { code, cause, sessionExpired } = {}) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.sessionExpired = !!sessionExpired;
  }
}

const CONSTRAINT_MESSAGES = {
  projects_slug_key: 'Another project already uses this slug. Choose a different one.',
  projects_scheduled_has_date: 'Choose a publish date and time for scheduled content.',
  projects_unpublish_after_publish: 'The unpublish time must be after the publish time.',
  projects_resources_valid: 'Each related resource needs a label and an https:// URL.',
  projects_metrics_valid: 'Each metric needs a label (≤60 chars) and a value (≤40 chars).',
  skills_name_uq: 'A skill with this name already exists.',
  skill_categories_name_uq: 'A category with this name already exists.',
  skill_categories_slug_key: 'A category with this slug already exists.',
  experience_dates_valid: 'The end date must be after the start date.',
  experience_current_valid: 'A current role cannot have an end date.',
  education_years_valid: 'The end year must be after the start year.',
  certifications_dates_valid: 'The expiry date must be after the issue date.',
  resumes_default_must_be_active: 'The public default resume must be active. Choose another default first.',
  resumes_single_default_uq: 'Only one resume can be the public default.',
  nav_target_valid: 'Section links need a section; external links need a URL.',
  skills_category_id_fkey: 'This category still contains skills. Move or delete them first.',
};

/** Convert Supabase/PostgREST/Storage/network errors into a sentence for humans. */
export function friendlyError(err) {
  if (!err) return 'Unknown error.';
  if (err instanceof ApiError) return err.message;
  const msg = String(err.message || err.error_description || err.error || err);
  const code = err.code || err.statusCode;
  if (err.name === 'TypeError' && /fetch|network|load failed/i.test(msg)) {
    return 'Network error — check your connection. Your changes have not been lost.';
  }
  if (code === 'PGRST301' || /JWT expired|invalid jwt|refresh token/i.test(msg)) return 'Your session has expired. Please sign in again.';
  if (code === '42501' || /row-level security|permission denied|not authorized/i.test(msg)) {
    return 'You are not authorized to perform this action.';
  }
  for (const [name, text] of Object.entries(CONSTRAINT_MESSAGES)) if (msg.includes(name) || err.details?.includes?.(name)) return text;
  if (code === '23505') {
    const m = /Key \((\w+)\)/.exec(err.details || '') || /\((\w+)\)/.exec(msg);
    return m ? `This ${m[1].replace(/_/g, ' ')} is already in use.` : 'This entry already exists.';
  }
  if (code === '23503') return 'This item is referenced by other content and cannot be removed.';
  if (code === '23514' || /domain https_url/.test(msg)) {
    if (/https_url|safe_link/.test(msg)) return 'Links must start with https:// (or mailto: for email links).';
    if (/email_address/.test(msg)) return 'Please enter a valid email address.';
    if (/slug_text/.test(msg)) return 'Slugs may only contain lowercase letters, numbers and single hyphens.';
    if (/storage_path/.test(msg)) return 'Invalid file path.';
    return 'Some values are invalid. Please review the highlighted fields.';
  }
  if (code === '22001') return 'One of the values is too long.';
  if (code === '40001' || code === '22023' || code === 'P0002') return msg;
  if (/Payload too large|exceeded the maximum allowed size/i.test(msg)) return 'File is too large.';
  if (/mime type .* is not supported|invalid_mime_type/i.test(msg)) return 'This file type is not allowed.';
  return msg.length < 200 ? msg : 'Something went wrong. Please try again.';
}

function isSessionError(err) {
  return err?.code === 'PGRST301' || /JWT expired|invalid jwt/i.test(err?.message || '');
}

let onSessionExpired = () => {};
export function setSessionExpiredHandler(fn) { onSessionExpired = fn; }

/** Await a Supabase query builder; throw ApiError with a friendly message on failure. */
export async function run(promiseLike) {
  let res;
  try { res = await promiseLike; }
  catch (e) { throw new ApiError(friendlyError(e), { cause: e }); }
  if (res.error) {
    const expired = isSessionError(res.error);
    if (expired) onSessionExpired();
    throw new ApiError(friendlyError(res.error), { code: res.error.code, cause: res.error, sessionExpired: expired });
  }
  return res;
}
export const data = async (q) => (await run(q)).data;
export const rpc = (fn, args) => data(db().rpc(fn, args));

export const reorder = (table, ids) => rpc('reorder_items', { p_table: table, p_ids: ids });

// ---------------------------------------------------------------- uploads
export const BUCKETS = {
  media: { maxBytes: 5 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'], label: 'PNG, JPG, WebP, AVIF or GIF up to 5 MB' },
  certificates: { maxBytes: 10 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], label: 'PDF, PNG, JPG or WebP up to 10 MB' },
  resumes: { maxBytes: 10 * 1024 * 1024, types: ['application/pdf'], label: 'PDF up to 10 MB' },
};

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'application/pdf': 'pdf' };

/** Check magic bytes so a renamed file can't masquerade as another type. */
async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const s = (i, str) => [...str].every((c, j) => b[i + j] === c.charCodeAt(0));
  if (b[0] === 0x89 && s(1, 'PNG')) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'image/webp';
  if (s(0, 'GIF8')) return 'image/gif';
  if (s(4, 'ftypavif') || s(4, 'ftypavis')) return 'image/avif';
  if (s(0, '%PDF')) return 'application/pdf';
  return null;
}

export async function validateFile(bucket, file) {
  const rules = BUCKETS[bucket];
  if (!file) throw new ApiError('No file selected.');
  const type = await sniff(file);
  if (!type || !rules.types.includes(type)) throw new ApiError(`Unsupported file. Allowed: ${rules.label}.`);
  if (file.size > rules.maxBytes * (type.startsWith('image/') && bucket === 'media' ? 6 : 1)) {
    throw new ApiError(`File is too large. Allowed: ${rules.label}.`);
  }
  return type;
}

/** Downscale large images in the browser and re-encode (WebP where supported). */
export async function optimizeImage(file, type, { maxDim = 1920, quality = 0.85 } = {}) {
  if (type === 'image/gif' || type === 'image/avif') return { blob: file, type };
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { return { blob: file, type }; }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 400 * 1024) { bitmap.close?.(); return { blob: file, type }; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const toBlob = (t) => new Promise((r) => canvas.toBlob(r, t, quality));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(type === 'image/png' ? 'image/png' : 'image/jpeg'); // Safari fallback
  if (!blob || blob.size >= file.size) return { blob: file, type };
  return { blob, type: blob.type };
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * Validate + (optionally) optimize + upload. Returns the storage path.
 * File names are generated (never derived from user input) to prevent path tricks.
 */
export async function upload(bucket, folder, file, { optimize = true, maxDim } = {}) {
  try {
    let type = await validateFile(bucket, file);
    let blob = file;
    if (optimize && type.startsWith('image/') && bucket !== 'resumes') ({ blob, type } = await optimizeImage(file, type, { maxDim }));
    if (blob.size > BUCKETS[bucket].maxBytes) throw new ApiError(`File is too large even after optimization. Allowed: ${BUCKETS[bucket].label}.`);
    const safeFolder = String(folder || 'misc').toLowerCase().replace(/[^a-z0-9/_-]/g, '-').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    const path = `${safeFolder}/${uuid()}.${EXT[type]}`;
    await run(db().storage.from(bucket).upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false }));
    return path;
  } catch (e) {
    const message = friendlyError(e);
    db().from('notifications').insert({ kind: 'upload_failure', title: 'Upload failed', body: `${file?.name || 'File'}: ${message}`.slice(0, 1000) })
      .then(() => {}, () => {});
    throw e instanceof ApiError ? e : new ApiError(message, { cause: e });
  }
}

export async function signedUrl(bucket, path, { download, expiresIn = 300 } = {}) {
  const res = await run(db().storage.from(bucket).createSignedUrl(path, expiresIn, download ? { download } : undefined));
  return res.data.signedUrl;
}

export async function removeFiles(bucket, paths) {
  const list = paths.filter(Boolean);
  if (list.length) await run(db().storage.from(bucket).remove(list));
}

export async function currentUser() {
  const { data } = await db().auth.getUser();
  return data.user;
}
