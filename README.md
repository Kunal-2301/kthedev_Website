# Kunal Gupta — AI Engineer Portfolio + Admin CMS

A static portfolio site (GitHub Pages) with a **private, fully functional admin CMS** backed by Supabase
(PostgreSQL, Auth, Storage, Edge Functions). Every piece of content — projects, skills, experience,
education, certifications, profile, navigation, settings and resumes — is managed in `/admin` and appears
on the public site **without editing code or redeploying**.

```
 PUBLIC                                           ADMIN (/admin)
 ──────                                           ─────────────
 GitHub Pages ─► static HTML/CSS/JS               Supabase Auth (email + password, no public sign-up)
      │                                                 │
      ▼  publishable key (safe to expose)               ▼  user JWT
 Supabase API ──► PostgreSQL + RLS ◄──────────── authorized CRUD (is_admin() enforced IN THE DATABASE)
      │            • anon reads PUBLISHED rows only     • drafts, versions, audit log, scheduling (pg_cron)
      │            • no anon writes, anywhere           • Storage: size/MIME-limited buckets, admin-only writes
      ▼
 Edge Functions (service role stays server-side): submit-contact · track (cookieless analytics) · resume
```

## Highlights

| Area | What you get |
|---|---|
| **Public site** | Dark “terminal” design (neon-green on near-black, JetBrains Mono + Inter, grid/scanline hero with typed text, `// section` titles, terminal-window cards). Hero, about, project cards + case studies, `stack` window with grep-style search and level filters, experience, education & certifications, `contact.sh` + validated contact form, SEO meta + Open Graph + JSON-LD, sitemap, reduced-motion support |
| **Project CMS** | Tabbed editor (Overview, Details, Technologies, Media, Links, SEO, Publishing), Markdown with live preview, relational tech picker with inline skill creation, drag-and-drop gallery with alt text and ordering, metrics, draft / publish / schedule / unpublish, local backup of unsaved work, conflict detection |
| **Everything else** | Skills & categories, experience, education, certifications (image/PDF), navigation & social links, profile and site settings (draft → preview → publish), multiple resumes with a public default, contact inbox, notifications |
| **AI assistant** | Optional “ask kthedev” chat: retrieval over published content (BM25) + Claude with citations, guardrails, rate limits and a daily cap; questions never stored |
| **SEO** | Static `/projects/<slug>/` page per project generated at deploy (title, description, canonical, OG/Twitter cards, JSON-LD, pre-rendered text) + sitemap; `404.html` forwards brand-new projects |
| **Advanced** | Desktop/tablet/mobile **live preview** of drafts · **version history** with restore for all content · **scheduled publishing & updates** via pg_cron (works with the dashboard closed) · **privacy-conscious analytics** (no cookies, no IPs) · **audit log** of every change and sign-in |
| **Security** | Row Level Security on every table, admin allow-list table, SECURITY DEFINER functions that check authorization, URL/email/slug/path domains in SQL, sanitized Markdown, no `innerHTML` with CMS data, strict CSP, magic-byte file validation, rate-limited/spam-filtered contact form, clickjacking guard |

## Repository layout

```
index.html, project.html, 404.html   public pages (content rendered from Supabase)
admin/index.html                     dashboard entry
css/  site.css (public design system) · tokens.css + admin.css (dashboard)
js/   config.js (publishable settings) · core/ (supabase, dom, markdown, content API, icons)
      public/ (home, project, contact, analytics) · admin/ (app shell, api, ui kit, history, pages/*)
      vendor/ (supabase-js 2.119.2, marked 18.2.1, DOMPurify — vendored, no CDN)
database/   schema.sql · functions.sql · rls-policies.sql · storage.sql · cron.sql · seed.sql
supabase/   functions/{submit-contact,track,resume,ask,_shared} · config.toml · migrations/ (generated) · seed.sql
scripts/    check.mjs · build-migration.mjs · build-seo.mjs · assets/ (OG image sources)
assets/     favicon, OG image, self-hosted fonts (Inter, JetBrains Mono — SIL OFL 1.1)
tests/      db/ (RLS + behaviour, real Postgres in PGlite) · e2e/ (local Supabase-compatible server + supabase-js)
            unit/ (validation, XSS sanitization, repo hygiene)
docs/       QUICKSTART.md · SETUP.md · ADMIN-GUIDE.md · SECURITY.md · TEST-REPORT.md
```

## Quick start (local, no Supabase account needed)

```bash
npm install
npm run dev          # http://localhost:8787  — real SQL + RLS in PGlite behind Supabase-compatible APIs
                     # admin: http://localhost:8787/admin/  (admin@example.com / correct-horse-battery — local test only)
npm test             # 90 tests: database/RLS, end-to-end CMS + assistant + SEO pages, unit + XSS
npm run check        # static security checks for the deployable files
```

The local server is a development/test tool only; production uses Supabase.

## Going live

Fastest path: **[docs/QUICKSTART.md](docs/QUICKSTART.md)** (minimum setup). Full guide: **[docs/SETUP.md](docs/SETUP.md)** — about 20 minutes: create a Supabase project, run the SQL, create your
admin account, deploy three Edge Functions, put the project URL + publishable key in `js/config.js`, and enable
GitHub Pages (GitHub Actions source).

The public design is a port of the `kthedev-portfolio` reference (React/Tailwind/Motion) to plain CSS + JS, so it still
needs no build step and runs under a strict Content Security Policy.

Then read **[docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md)** for day-to-day use, **[docs/SECURITY.md](docs/SECURITY.md)**
for the security model, and **[docs/TEST-REPORT.md](docs/TEST-REPORT.md)** for what was tested (and what was not).

## Content sources

Initial content in `database/seed.sql` comes from the resume and the project brief only. Unknown links are
left empty, metrics are only those stated on the resume, and skill levels are deliberately conservative —
review them in **Admin → Skills**. Future projects (Advanced RAG, MCP server, …) are not seeded; add them
when they exist.
