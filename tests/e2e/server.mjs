// Local Supabase-compatible test server (for development QA and E2E tests only).
//
// Serves the static site AND emulates the subset of Supabase HTTP APIs this project uses:
//   PostgREST  /rest/v1/*      (select/embeds/filters/order/range/count, insert/update/upsert/delete, rpc)
//   GoTrue     /auth/v1/*      (password login, refresh, user, logout, recover)
//   Storage    /storage/v1/*   (upload with bucket size/MIME limits, public + signed downloads, delete)
//   Functions  /functions/v1/* (submit-contact, track, resume — using the same shared logic)
// Every database operation runs the REAL migration SQL in PGlite under the caller's
// role (anon / authenticated + JWT sub), so RLS policies and RPCs behave as in production.
//
//   node tests/e2e/server.mjs [port]    → http://localhost:8787  (admin: admin@example.com / correct-horse-battery)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createDb, as, ADMIN_ID, USER_ID } from '../db/harness.mjs';
import { validateContact, validateEvent, deviceFromUA, referrerHost, isBot, safeFileName } from '../../supabase/functions/_shared/logic.js';
import { validateQuestion, buildCorpus, offlineAnswer } from '../../supabase/functions/_shared/assistant.js';
import { normalizeProject, renderProjectPage } from '../../scripts/seo-pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };
export const NON_ADMIN = { email: 'user@example.com', password: 'user-password-123' };
const ANON_KEY = 'test-publishable-key';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const qi = (s) => { if (!IDENT.test(s)) throw httpErr(400, 'PGRST100', `Invalid identifier: ${s}`); return `"${s}"`; };
function httpErr(status, code, message, details = null) { const e = new Error(message); e.status = status; e.pg = { code, message, details, hint: null }; return e; }

// ---------------------------------------------------------------- relationships (PostgREST embedding)
const REL = {
  projects: { project_technologies: { many: true, fk: 'project_id', pk: 'id' }, project_images: { many: true, fk: 'project_id', pk: 'id' } },
  project_technologies: { skills: { many: false, local: 'skill_id', pk: 'id' } },
};

function splitTop(s, sep = ',') {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function selectList(table, alias, sel) {
  const items = splitTop(sel || '*');
  return items.map((item) => {
    if (item === '*') return `${alias}.*`;
    const embed = /^(?:([a-z_]+):)?([a-z_]+)\((.*)\)$/s.exec(item);
    if (embed) {
      const [, as_, rel, inner] = embed;
      const r = REL[table]?.[rel];
      if (!r) throw httpErr(400, 'PGRST200', `No relationship ${table} → ${rel}`);
      const c = `${alias}_${rel}`;
      const cols = selectList(rel, c, inner);
      const name = qi(as_ || rel);
      return r.many
        ? `(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select ${cols} from public.${qi(rel)} ${c} where ${c}.${qi(r.fk)} = ${alias}.${qi(r.pk)}) x) as ${name}`
        : `(select row_to_json(x) from (select ${cols} from public.${qi(rel)} ${c} where ${c}.${qi(r.pk)} = ${alias}.${qi(r.local)}) x) as ${name}`;
    }
    const json = /^([a-z_]+)((?:->>?[a-z_]+)+)$/.exec(item);
    if (json) {
      const parts = [...json[2].matchAll(/(->>?)([a-z_]+)/g)];
      return `${alias}.${qi(json[1])}${parts.map(([, op, k]) => `${op}'${k}'`).join('')} as ${qi(parts.at(-1)[2])}`;
    }
    const [a, col] = item.includes(':') ? item.split(':') : [null, item];
    return `${alias}.${qi(col)}${a ? ` as ${qi(a)}` : ''}`;
  }).join(', ');
}

function condition(col, expr, params, alias = 't') {
  let negate = false;
  if (expr.startsWith('not.')) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot); const raw = expr.slice(dot + 1);
  const c = `${alias}.${qi(col)}`;
  const p = (v) => { params.push(v); return `$${params.length}`; };
  let sql;
  switch (op) {
    case 'eq': sql = `${c} = ${p(raw)}`; break;
    case 'neq': sql = `${c} <> ${p(raw)}`; break;
    case 'gt': sql = `${c} > ${p(raw)}`; break;
    case 'gte': sql = `${c} >= ${p(raw)}`; break;
    case 'lt': sql = `${c} < ${p(raw)}`; break;
    case 'lte': sql = `${c} <= ${p(raw)}`; break;
    case 'like': sql = `${c}::text like ${p(raw.replace(/\*/g, '%'))}`; break;
    case 'ilike': sql = `${c}::text ilike ${p(raw.replace(/\*/g, '%'))}`; break;
    case 'is': sql = `${c} is ${({ null: 'null', true: 'true', false: 'false' })[raw] || 'null'}`; break;
    case 'in': {
      const vals = splitTop(raw.replace(/^\(|\)$/g, '')).map((x) => x.replace(/^"|"$/g, ''));
      sql = vals.length ? `${c}::text = any(${p(vals)}::text[])` : 'false';
      break;
    }
    default: throw httpErr(400, 'PGRST100', `Unsupported operator ${op}`);
  }
  return negate ? `not (${sql})` : sql;
}

function whereClause(sp, params, alias = 't') {
  const conds = [];
  for (const [k, v] of sp) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const inner = splitTop(v.replace(/^\(|\)$/g, '')).map((part) => {
        const m = /^([a-z_]+)\.(.+)$/.exec(part);
        return condition(m[1], m[2], params, alias);
      });
      conds.push(`(${inner.join(' or ')})`);
    } else conds.push(condition(k, v, params, alias));
  }
  return conds.length ? ` where ${conds.join(' and ')}` : '';
}

function orderClause(sp) {
  const o = sp.get('order');
  if (!o) return '';
  return ` order by ${o.split(',').map((part) => {
    const [col, dir, nulls] = part.split('.');
    return `t.${qi(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`;
  }).join(', ')}`;
}

// ---------------------------------------------------------------- auth tokens
const sessions = new Map(); // access_token -> { who, user }
const refreshTokens = new Map();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function issue(who) {
  const user = who === 'admin'
    ? { id: ADMIN_ID, email: ADMIN.email } : { id: USER_ID, email: NON_ADMIN.email };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp, session_id: crypto.randomUUID() })}.sig${crypto.randomBytes(8).toString('hex')}`;
  const refresh = crypto.randomBytes(16).toString('hex');
  const fullUser = { ...user, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString(), email_confirmed_at: '2026-01-01T00:00:00Z' };
  sessions.set(access, { who, user: fullUser, exp });
  refreshTokens.set(refresh, who);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: refresh, user: fullUser };
}
function whoFrom(req) {
  const auth = req.headers.authorization || '';
  const tok = auth.replace(/^Bearer\s+/i, '');
  const s = sessions.get(tok);
  if (s) {
    if (s.exp * 1000 < Date.now()) throw httpErr(401, 'PGRST301', 'JWT expired');
    return s.who;
  }
  if (tok && tok !== ANON_KEY && tok.split('.').length === 3) throw httpErr(401, 'PGRST301', 'JWT expired');
  return 'anon';
}
export function expireAllSessions() { for (const s of sessions.values()) s.exp = 0; }

// ---------------------------------------------------------------- server
export async function startServer({ port = 8787, seed = true } = {}) {
  const db = await createDb({ seed });
  await db.exec(`insert into auth.users (id, email) values ('${crypto.randomUUID()}', 'other@example.com') on conflict do nothing`);
  const files = new Map(); // `${bucket}/${path}` -> { buf, type }
  const signed = new Map();
  const log = [];

  const asRole = (who, fn) => as(db, who, fn);
  const typeCache = new Map();
  async function colTypes(table) {
    if (!typeCache.has(table)) {
      const r = (await db.query(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows;
      typeCache.set(table, Object.fromEntries(r.map((x) => [x.column_name, x.data_type])));
    }
    return typeCache.get(table);
  }
  async function argTypes(fn) {
    const key = `fn:${fn}`;
    if (!typeCache.has(key)) {
      const r = (await db.query(`select proargnames as names, oidvectortypes(proargtypes) as types from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = $1`, [fn])).rows[0];
      typeCache.set(key, r ? Object.fromEntries((r.names || []).map((nm, i) => [nm, r.types.split(', ')[i]])) : {});
    }
    return typeCache.get(key);
  }
  const toParam = (v, type) => (v === undefined ? null : /json/.test(type || '') && v !== null ? JSON.stringify(v) : v);
  const pgError = (e) => (e.pg ? e : httpErr(
    e.code === '42501' ? 403 : e.code === '23505' ? 409 : e.code === 'P0002' ? 404 : 400,
    e.code || 'XX000', e.message, e.detail || null));

  async function handleRest(req, res, url, body) {
    const who = whoFrom(req);
    const parts = url.pathname.replace('/rest/v1/', '').split('/');
    const sp = url.searchParams;
    const accept = req.headers.accept || '';
    const wantObject = accept.includes('vnd.pgrst.object');
    const prefer = req.headers.prefer || '';

    if (parts[0] === 'rpc') {
      const fn = parts[1]; qi(fn);
      const args = body ? JSON.parse(body) : {};
      const keys = Object.keys(args);
      const types = await argTypes(fn);
      const params = keys.map((k) => toParam(args[k], types[k]));
      const sql = `select * from public.${qi(fn)}(${keys.map((k, i) => `${qi(k)} => $${i + 1}`).join(', ')})`;
      const out = await asRole(who, async (tx) => (await tx.query(sql, params)).rows);
      const result = out.length === 1 && Object.keys(out[0]).length === 1 && fn in out[0] ? out[0][fn] : out.length === 1 ? out[0] : out;
      return send(res, 200, result ?? null);
    }

    const table = parts[0]; qi(table);
    const params = [];
    if (req.method === 'GET' || req.method === 'HEAD') {
      const where = whereClause(sp, params);
      const limit = sp.get('limit') ? ` limit ${Number(sp.get('limit'))}` : '';
      const offset = sp.get('offset') ? ` offset ${Number(sp.get('offset'))}` : '';
      const sql = `select ${selectList(table, 't', sp.get('select'))} from public.${qi(table)} t${where}${orderClause(sp)}${limit}${offset}`;
      const { rows, count } = await asRole(who, async (tx) => {
        const r = (await tx.query(sql, params)).rows;
        let c = null;
        if (prefer.includes('count=exact')) c = Number((await tx.query(`select count(*) from public.${qi(table)} t${where}`, params)).rows[0].count);
        return { rows: r, count: c };
      });
      const from = Number(sp.get('offset') || 0);
      const headers = { 'Content-Range': `${rows.length ? `${from}-${from + rows.length - 1}` : '*'}/${count ?? '*'}` };
      if (req.method === 'HEAD') return send(res, 200, null, headers);
      if (wantObject) {
        if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
        return send(res, 200, rows[0], headers);
      }
      return send(res, 200, rows, headers);
    }

    const returning = prefer.includes('return=representation') ? ` returning ${selectList(table, 't', sp.get('select'))}` : '';
    const ctypes = await colTypes(table);
    let sql;
    if (req.method === 'POST') {
      const rowsIn = [].concat(JSON.parse(body));
      const cols = [...new Set(rowsIn.flatMap(Object.keys))];
      cols.forEach(qi);
      const values = rowsIn.map((r) => `(${cols.map((c) => { params.push(toParam(r[c], ctypes[c])); return `$${params.length}`; }).join(', ')})`);
      const upsert = prefer.includes('resolution=merge-duplicates');
      const conflict = sp.get('on_conflict') || (table === 'content_drafts' ? 'entity_type' : 'id');
      sql = `insert into public.${qi(table)} as t (${cols.map(qi).join(', ')}) values ${values.join(', ')}` +
        (upsert ? ` on conflict (${qi(conflict)}) do update set ${cols.filter((c) => c !== conflict).map((c) => `${qi(c)} = excluded.${qi(c)}`).join(', ')}` : '') + returning;
    } else if (req.method === 'PATCH') {
      const patch = JSON.parse(body);
      const sets = Object.entries(patch).map(([k, v]) => { params.push(toParam(v, ctypes[k])); return `${qi(k)} = $${params.length}`; });
      const where = whereClause(sp, params);
      sql = `update public.${qi(table)} as t set ${sets.join(', ')}${where}${returning}`;
    } else if (req.method === 'DELETE') {
      const where = whereClause(sp, params);
      sql = `delete from public.${qi(table)} as t${where}${returning}`;
    } else return send(res, 405, { message: 'Method not allowed' });
    const rows = await asRole(who, async (tx) => (await tx.query(sql, params)).rows);
    if (!returning) return send(res, req.method === 'POST' ? 201 : 204, null);
    return send(res, req.method === 'POST' ? 201 : 200, wantObject ? rows[0] : rows);
  }

  async function handleAuth(req, res, url, body) {
    const p = url.pathname.replace('/auth/v1/', '');
    const b = body ? JSON.parse(body) : {};
    if (p === 'token' && url.searchParams.get('grant_type') === 'password') {
      if (b.email === ADMIN.email && b.password === ADMIN.password) return send(res, 200, issue('admin'));
      if (b.email === NON_ADMIN.email && b.password === NON_ADMIN.password) return send(res, 200, issue('user'));
      return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
    }
    if (p === 'token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const who = refreshTokens.get(b.refresh_token);
      if (!who) return send(res, 400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
      refreshTokens.delete(b.refresh_token);
      return send(res, 200, issue(who));
    }
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const s = sessions.get(tok);
    if (p === 'user' && req.method === 'GET') return s ? send(res, 200, s.user) : send(res, 401, { code: 'bad_jwt', message: 'invalid JWT' });
    if (p === 'user' && req.method === 'PUT') return s ? send(res, 200, s.user) : send(res, 401, { message: 'invalid JWT' });
    if (p === 'logout') {
      if (s) { sessions.delete(tok); if (url.searchParams.get('scope') !== 'local') for (const [k, w] of refreshTokens) if (w === s.who) refreshTokens.delete(k); }
      return send(res, 204, null);
    }
    if (p === 'recover') return send(res, 200, {});
    if (p === 'settings') return send(res, 200, { external: {}, disable_signup: true });
    return send(res, 404, { message: 'not found' });
  }

  async function handleStorage(req, res, url, raw) {
    const p = decodeURIComponent(url.pathname.replace('/storage/v1/', ''));
    let m;
    if ((m = /^object\/public\/([a-z-]+)\/(.+)$/.exec(p)) && req.method === 'GET') {
      const [b] = (await db.query('select public from storage.buckets where id = $1', [m[1]])).rows;
      const f = files.get(`${m[1]}/${m[2]}`);
      if (!b?.public || !f) return send(res, 404, { message: 'Object not found' });
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache' }); return res.end(f.buf);
    }
    if ((m = /^object\/sign\/([a-z-]+)\/(.+)$/.exec(p))) {
      if (req.method === 'GET') {
        const ok = signed.get(url.searchParams.get('token'));
        const f = files.get(`${m[1]}/${m[2]}`);
        if (!ok || ok.exp < Date.now() || ok.key !== `${m[1]}/${m[2]}` || !f) return send(res, 400, { message: 'Invalid signature' });
        const dl = url.searchParams.get('download');
        res.writeHead(200, { 'Content-Type': f.type, ...(dl !== null ? { 'Content-Disposition': `attachment; filename="${dl || 'file'}"` } : {}) });
        return res.end(f.buf);
      }
      const who = whoFrom(req);
      const visible = await asRole(who, async (tx) => (await tx.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [m[1], m[2]])).rows.length);
      if (!visible && who !== 'service') return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      const token = crypto.randomBytes(12).toString('hex');
      const { expiresIn = 60 } = raw.length ? JSON.parse(raw.toString()) : {};
      signed.set(token, { key: `${m[1]}/${m[2]}`, exp: Date.now() + expiresIn * 1000 });
      return send(res, 200, { signedURL: `/object/sign/${m[1]}/${encodeURI(m[2])}?token=${token}` });
    }
    if ((m = /^object\/([a-z-]+)\/(.+)$/.exec(p)) && req.method === 'POST') {
      const who = whoFrom(req);
      const [bucket] = (await db.query('select * from storage.buckets where id = $1', [m[1]])).rows;
      if (!bucket) return send(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      let buf = raw; let type = req.headers['content-type'] || 'application/octet-stream';
      if (type.startsWith('multipart/form-data')) {
        const boundary = type.split('boundary=')[1];
        const text = raw.toString('latin1');
        const part = text.split(`--${boundary}`).find((s) => /filename=|name=""/.test(s) || /Content-Type/i.test(s));
        const headerEnd = part.indexOf('\r\n\r\n');
        const ct = /Content-Type:\s*([^\r\n]+)/i.exec(part.slice(0, headerEnd));
        type = ct ? ct[1].trim() : type;
        buf = Buffer.from(part.slice(headerEnd + 4, part.lastIndexOf('\r\n')), 'latin1');
      }
      if (bucket.allowed_mime_types && !bucket.allowed_mime_types.includes(type)) return send(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
      if (bucket.file_size_limit && buf.length > Number(bucket.file_size_limit)) return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      try {
        await asRole(who, (tx) => tx.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [m[1], m[2]]));
      } catch { return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }); }
      files.set(`${m[1]}/${m[2]}`, { buf, type });
      return send(res, 200, { Key: `${m[1]}/${m[2]}`, Id: crypto.randomUUID() });
    }
    if ((m = /^object\/([a-z-]+)$/.exec(p)) && req.method === 'DELETE') {
      const who = whoFrom(req);
      const { prefixes = [] } = JSON.parse(raw.toString() || '{}');
      const deleted = await asRole(who, async (tx) => (await tx.query('delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name', [m[1], prefixes])).rows);
      deleted.forEach((d) => files.delete(`${m[1]}/${d.name}`));
      return send(res, 200, deleted.map((d) => ({ name: d.name })));
    }
    return send(res, 404, { message: 'Not found' });
  }

  async function handleFunctions(req, res, url, body) {
    const name = url.pathname.replace('/functions/v1/', '');
    const ua = req.headers['user-agent'] || '';
    const visitor = crypto.createHash('sha256').update(`salt:${new Date().toISOString().slice(0, 10)}:${req.socket.remoteAddress}:${ua}`).digest('hex').slice(0, 32);
    const ipHash = crypto.createHash('sha256').update(`salt:ip:${req.socket.remoteAddress}`).digest('hex').slice(0, 32);
    if (req.method === 'OPTIONS') return send(res, 204, null);
    if (name === 'submit-contact') {
      let b; try { b = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
      const v = validateContact(b);
      if (!v.ok) return send(res, 422, { error: 'Please correct the highlighted fields.', fields: v.errors });
      const ok = await asRole('service', async (tx) => (await tx.query('select public.hit_rate_limit($1, 5, 3600) ok', [`contact:${ipHash}`])).rows[0].ok);
      if (!ok) return send(res, 429, { error: 'Too many messages. Please try again later or email me directly.' });
      if (v.spam) return send(res, 200, { ok: true });
      await asRole('service', (tx) => tx.query('insert into public.contact_messages (name, email, subject, message, ip_hash) values ($1,$2,$3,$4,$5)',
        [v.value.name, v.value.email, v.value.subject, v.value.message, ipHash]));
      await asRole('service', (tx) => tx.query(`insert into public.analytics_events (event_type, path) values ('contact_submit', '/')`));
      return send(res, 200, { ok: true });
    }
    if (name === 'track') {
      if (isBot(ua) && !ua.includes('Chrome')) return send(res, 204, null);
      const ev = validateEvent(JSON.parse(body || '{}'));
      if (!ev) return send(res, 400, { error: 'Invalid event' });
      await asRole('service', (tx) => tx.query('insert into public.analytics_events (event_type, path, section, project_slug, referrer_host, device, visitor_hash) values ($1,$2,$3,$4,$5,$6,$7)',
        [ev.event_type, ev.path, ev.section, ev.project_slug, referrerHost(JSON.parse(body).referrer, ['localhost']), deviceFromUA(ua), visitor]));
      return send(res, 204, null);
    }
    if (name === 'resume') {
      const [r] = await asRole('service', async (tx) => (await tx.query('select * from public.resumes where is_default and is_active')).rows);
      if (!r) return send(res, 404, { error: 'No resume is currently published.' });
      const token = crypto.randomBytes(12).toString('hex');
      signed.set(token, { key: `resumes/${r.storage_path}`, exp: Date.now() + 120_000 });
      await asRole('service', (tx) => tx.query(`insert into public.analytics_events (event_type, path, visitor_hash) values ('resume_download', '/resume', $1)`, [visitor]));
      res.writeHead(302, { Location: `/storage/v1/object/sign/resumes/${r.storage_path}?token=${token}&download=${encodeURIComponent(safeFileName(`Kunal-Gupta-${r.title}`))}` });
      return res.end();
    }
    if (name === 'ask') {
      // Offline emulation of supabase/functions/ask: same validation, flags, limits and
      // retrieval over PUBLISHED content (read as anon), but no LLM call (no cost locally).
      const anon = (sql, params) => asRole('anon', async (tx) => (await tx.query(sql, params)).rows);
      const [settings] = await anon('select assistant_enabled from public.site_settings where id = 1');
      if (!settings?.assistant_enabled) return send(res, 503, { error: 'The assistant is currently unavailable.' });
      let b; try { b = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
      const v = validateQuestion(b);
      if (!v.ok) return send(res, 422, { error: v.error });
      const ok = await asRole('service', async (tx) => (await tx.query('select public.hit_rate_limit($1, 10, 3600) ok', [`ask:h:${ipHash}`])).rows[0].ok);
      if (!ok) return send(res, 429, { error: 'You have reached the question limit for now. Please try again later, or use the contact form.' });
      const [profile] = await anon('select * from public.profiles');
      const projects = (await anon(`select p.*, coalesce((select json_agg(s.name order by pt.sort_order) from public.project_technologies pt
        join public.skills s on s.id = pt.skill_id where pt.project_id = p.id), '[]') technologies from public.projects p order by sort_order`));
      const docs = buildCorpus({
        profile, projects,
        categories: await anon('select id, name from public.skill_categories where is_visible'),
        skills: await anon('select name, category_id, level from public.skills where is_visible'),
        experience: await anon('select * from public.experience order by sort_order'),
        education: await anon('select * from public.education order by sort_order'),
        certifications: await anon('select * from public.certifications order by sort_order'),
      });
      await asRole('service', (tx) => tx.query(`insert into public.analytics_events (event_type, path, visitor_hash) values ('assistant_question', '/', $1)`, [visitor]));
      return send(res, 200, offlineAnswer(docs, v.question));
    }
    return send(res, 404, { error: 'Unknown function' });
  }

  function send(res, status, payload, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(payload === null || payload === undefined ? '' : JSON.stringify(payload));
  }

  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };

  async function handleStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    const pm = /^\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(?:index\.html)?$/.exec(p);
    if (pm) {
      // Same output as the deploy-time SEO build; unpublished slugs fall through to 404.html like GitHub Pages.
      const anon = (sql, params) => asRole('anon', async (tx) => (await tx.query(sql, params)).rows);
      const [row] = await anon(`select p.*,
          coalesce((select json_agg(json_build_object('sort_order', pt.sort_order, 'skill', json_build_object('name', s.name)))
                    from public.project_technologies pt join public.skills s on s.id = pt.skill_id where pt.project_id = p.id), '[]') project_technologies,
          coalesce((select json_agg(json_build_object('kind', i.kind, 'storage_path', i.storage_path, 'alt_text', i.alt_text, 'sort_order', i.sort_order))
                    from public.project_images i where i.project_id = p.id), '[]') project_images
        from public.projects p where p.slug = $1`, [pm[1]]);
      if (row) {
        const [profile] = await anon('select * from public.profiles');
        const origin = `http://${req.headers.host}`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(renderProjectPage({ siteUrl: origin, supabaseUrl: origin, profile, project: normalizeProject(row) }));
      }
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end(await readFile(path.join(ROOT, '404.html')));
    }
    if (p.endsWith('/')) p += 'index.html';
    if (p === '/js/config.js') {
      const origin = `http://${req.headers.host}`;
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(`export const CONFIG = Object.freeze({ supabaseUrl: '${origin}', supabaseKey: '${ANON_KEY}', siteUrl: '${origin}', turnstileSiteKey: '' });
export function isConfigured() { return true; }\n`);
    }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || /\/(node_modules|tests|database|supabase)\//.test(p)) return send(res, 404, { message: 'Not found' });
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error();
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(await readFile(path.join(ROOT, '404.html')));
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const body = raw.toString();
    try {
      if (url.pathname.startsWith('/rest/v1/')) await handleRest(req, res, url, body);
      else if (url.pathname.startsWith('/auth/v1/')) await handleAuth(req, res, url, body);
      else if (url.pathname.startsWith('/storage/v1/')) await handleStorage(req, res, url, raw);
      else if (url.pathname.startsWith('/functions/v1/')) await handleFunctions(req, res, url, body);
      else if (url.pathname === '/__test/cron') send(res, 200, (await db.query('select private.process_scheduled_content() r')).rows[0].r);
      else if (url.pathname === '/__test/expire') { expireAllSessions(); send(res, 200, { ok: true }); }
      else if (url.pathname === '/__test/seed-analytics') {
        // QA fixture only: synthetic events spread over 30 days so charts can be inspected locally.
        await db.query(`insert into public.analytics_events (event_type, path, section, project_slug, referrer_host, device, visitor_hash, created_at)
          select e.t, '/', e.sec, e.slug, e.ref, e.dev, md5(g::text || e.t)::text, now() - (random() * interval '30 days')
          from generate_series(1, 900) g,
          lateral (select (array['page_view','page_view','page_view','section_view','project_view','resume_download'])[1 + (g % 6)] t,
                          (array['about','skills','projects','experience','contact'])[1 + (g % 5)] sec,
                          (array['document-qa-chatbot','skin-lesion-classification','manufacturing-erp-system','yolov8-smoke-cigarette-detection'])[1 + (g % 4)] slug,
                          (array[null,'linkedin.com','github.com','google.com',null])[1 + (g % 5)] ref,
                          (array['desktop','mobile','desktop','tablet'])[1 + (g % 4)] dev) e`);
        await db.query(`update public.analytics_events set section = null where event_type <> 'section_view'`);
        await db.query(`update public.analytics_events set project_slug = null where event_type <> 'project_view'`);
        send(res, 200, { ok: true });
      }
      else await handleStatic(req, res, url);
      if (!url.pathname.match(/\.(js|css|svg|png)$/)) log.push(`${req.method} ${url.pathname}${url.search} → ${res.statusCode}`);
    } catch (e) {
      const err = pgError(e);
      log.push(`${req.method} ${url.pathname}${url.search} → ${err.status} ${err.message}`);
      if (!res.headersSent) send(res, err.status || 500, err.pg || { message: err.message });
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, db, files, log, url: `http://localhost:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8787);
  const s = await startServer({ port });
  console.log(`Local test server: ${s.url}\n  Public site: ${s.url}/\n  Admin:       ${s.url}/admin/  (${ADMIN.email} / ${ADMIN.password})`);
  if (process.env.VERBOSE) setInterval(() => { while (s.log.length) console.log(s.log.shift()); }, 500);
}
