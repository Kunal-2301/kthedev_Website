// Static safety checks for the deployable frontend (run in CI: npm run check).
//  • every JS module parses
//  • no secret / service-role keys anywhere in public files
//  • HTML pages declare a CSP and contain no inline styles, inline scripts or on* handlers
//  • frontend code never assigns innerHTML / uses eval
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = ['index.html', 'project.html', 'resume.html', '404.html', 'admin', 'js', 'css', 'assets', 'robots.txt', 'sitemap.xml'];
const problems = [];

async function walk(p) {
  const full = path.join(root, p);
  try {
    const entries = await readdir(full, { withFileTypes: true });
    return (await Promise.all(entries.map((e) => walk(path.join(p, e.name))))).flat();
  } catch { return [p]; }
}
const files = (await Promise.all(PUBLIC.map(walk))).flat();
const own = files.filter((f) => !f.includes('vendor/'));

for (const f of own.filter((x) => x.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); }
  catch (e) { problems.push(`${f}: syntax error\n${e.stderr}`); }
}

for (const f of files.filter((x) => /\.(js|html|css|json|txt|xml|svg)$/.test(x))) {
  const src = await readFile(path.join(root, f), 'utf8');
  if (/sb_secret_[A-Za-z0-9]/.test(src)) problems.push(`${f}: contains a Supabase SECRET key`);
  if (/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/.test(src)) {
    const payloads = src.match(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})/g) || [];
    for (const jwt of payloads) {
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (claims.role === 'service_role') problems.push(`${f}: contains a SERVICE ROLE JWT`);
    }
  }
}

for (const f of own.filter((x) => x.endsWith('.html'))) {
  const src = await readFile(path.join(root, f), 'utf8');
  if (f !== '404.html' && !/http-equiv="Content-Security-Policy"/.test(src)) problems.push(`${f}: missing CSP meta tag`);
  if (/\sstyle="/.test(src)) problems.push(`${f}: inline style attribute (blocked by CSP)`);
  if (/\son[a-z]+="/i.test(src)) problems.push(`${f}: inline event handler`);
  for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim()) problems.push(`${f}: inline <script> (blocked by CSP)`);
  }
}

for (const f of own.filter((x) => x.endsWith('.js'))) {
  const src = await readFile(path.join(root, f), 'utf8');
  if (/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/.test(src)) problems.push(`${f}: raw HTML injection API used`);
  if (/(?<![.\w$])eval\(|new Function\(/.test(src)) problems.push(`${f}: eval/new Function`);
}

const cfg = await readFile(path.join(root, 'js/config.js'), 'utf8');
const key = /supabaseKey:\s*'([^']*)'/.exec(cfg)?.[1] || '';
if (key && !key.startsWith('YOUR_') && !/^sb_publishable_|^eyJ/.test(key)) problems.push('js/config.js: supabaseKey is not a publishable/anon key');

if (problems.length) {
  console.error(`✖ ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`✔ ${own.length} frontend files checked: syntax OK, no secrets, strict-CSP compatible, no raw HTML injection.`);
