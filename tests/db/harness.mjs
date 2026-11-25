// Loads the real migration files into PGlite (WASM PostgreSQL) on top of a Supabase shim.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFile(path.join(root, p), 'utf8');

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';

export async function createDb({ seed = true } = {}) {
  const db = new PGlite();
  await db.exec(await read('tests/db/supabase-shim.sql'));
  const strip = (sql) => sql.replace(/create extension if not exists (pgcrypto|pg_cron);/gi, '');
  for (const f of ['database/schema.sql', 'database/functions.sql', 'database/rls-policies.sql',
                   'database/storage.sql', 'database/cron.sql']) {
    try { await db.exec(strip(await read(f))); }
    catch (e) { throw new Error(`${f}: ${e.message}`); }
  }
  if (seed) await db.exec(await read('database/seed.sql'));
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN_ID}', 'admin@example.com'), ('${USER_ID}', 'user@example.com');
    insert into public.admin_users (user_id, email) values ('${ADMIN_ID}', 'admin@example.com');`);
  return db;
}

/** Run fn as a given API role. who: 'anon' | 'user' | 'admin' | 'service' */
export async function as(db, who, fn) {
  const role = { anon: 'anon', user: 'authenticated', admin: 'authenticated', service: 'service_role' }[who];
  const sub = who === 'admin' ? ADMIN_ID : who === 'user' ? USER_ID : '';
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

export async function rows(db, who, sql, params) {
  return as(db, who, async (tx) => (await tx.query(sql, params)).rows);
}
