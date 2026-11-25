// Repository hygiene: generated files are current and the shipped config holds no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');

test('supabase/migrations matches database/*.sql (run npm run build:migration)', async () => {
  const migration = await read('supabase/migrations/20261119000000_portfolio_cms.sql');
  for (const f of ['schema.sql', 'functions.sql', 'rls-policies.sql', 'storage.sql', 'cron.sql']) {
    assert.ok(migration.includes(await read(`database/${f}`)), `${f} is out of date in the migration`);
  }
});

test('public config contains only a publishable key placeholder or publishable key', async () => {
  const cfg = await read('js/config.js');
  const key = /supabaseKey:\s*'([^']*)'/.exec(cfg)[1];
  assert.ok(key.startsWith('YOUR_') || key.startsWith('sb_publishable_') || key.startsWith('eyJ'));
  assert.doesNotMatch(cfg, /sb_secret_[A-Za-z0-9]/);
});

test('robots.txt keeps the dashboard out of search engines', async () => {
  assert.match(await read('robots.txt'), /Disallow: \/admin\//);
});
