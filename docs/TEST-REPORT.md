# Test report

**Date:** 2026-11-19 · **Machine:** macOS 26.7.1 (MacBook), Node 24.11.1 · **Result:** 75 / 75 automated tests passed,
static checks passed, manual browser QA in Chrome completed (bugs found and fixed are listed below).

> **Honesty notes.** No Supabase project existed during testing, so tests ran against (a) the real migration SQL in
> **PGlite** 0.5.17 (PostgreSQL 18.7 compiled to WebAssembly; Supabase currently runs PostgreSQL 15/17) with a small shim for Supabase's `auth.uid()`, roles, storage
> tables and pg_cron, and (b) a **local Supabase-compatible HTTP server** (`tests/e2e/server.mjs`) that implements the
> PostgREST/GoTrue/Storage/Functions endpoints this project uses, on top of that same database. The real
> `supabase-js` 2.119.2 client and the real UI were used. Real Supabase services, the Deno Edge runtime and pg_cron
> scheduling *timing* were **not** exercised. No physical iPhone/iPad, Safari, Firefox or Edge testing was done —
> mobile was checked with Chrome at 500 px and in the admin preview's 390 px / 820 px frames.

## How to reproduce
```bash
npm install
npm test          # all suites
npm run check     # static security checks
npm run dev       # manual QA at http://localhost:8787 (admin@example.com / correct-horse-battery — local only)
```

## Automated results

| Suite | Tests | Pass | What it exercises |
|---|---:|---:|---|
| `tests/db/rls.test.mjs` | 28 | 28 | RLS for anon / signed-in non-admin / admin, constraints, versions & restore, audit log, scheduler, analytics, rate limit, storage policies |
| `tests/e2e/cms.test.mjs` | 22 | 22 | supabase-js → HTTP → PostgREST/Auth/Storage/Functions emulator → real SQL; the required admin scenarios |
| `tests/unit/logic.test.mjs` | 7 | 7 | Contact/analytics validation, spam signals, device/referrer parsing, safe file names |
| `tests/unit/markdown-and-dom.test.mjs` | 15 | 15 | Markdown rendering + 10 XSS payloads through vendored marked + DOMPurify (jsdom), safe URLs, `h()` text-only insertion |
| `tests/unit/repo.test.mjs` | 3 | 3 | Generated migration up to date, no secret key in config, `/admin/` disallowed in robots.txt |
| **Total** | **75** | **75** | |

`npm run check`: 40 frontend files — syntax OK, no secret or service-role keys, no inline styles/scripts/handlers
(strict-CSP compatible), no `innerHTML`/`eval`.

## Required admin test cases

| # | Case | Result | Evidence |
|---|---|---|---|
| 1 | Unauthorized users cannot access admin functions | ✅ Pass | e2e #1 and “non-admin account…”; db “anon cannot modify…”, “signed-in non-admin…”. Browser: signing in with a valid non-admin account shows “This account is not authorized to access the dashboard.” and signs it out. |
| 2 | Valid administrator can log in | ✅ Pass | e2e #2; browser login |
| 3 | Invalid credentials rejected | ✅ Pass | e2e #3; browser shows “Incorrect email or password.” |
| 4 | Session survives page refresh | ✅ Pass | Browser: full reload of `/admin/#/projects/new` stayed signed in |
| 5 | Logout invalidates the session | ✅ Pass | e2e #5 (old token → 401); browser logout returns to sign-in |
| 6 | Create a project | ✅ Pass | e2e #6; browser: full editor flow |
| 7 | Edit a project | ✅ Pass | e2e #7 |
| 8 | Save as draft | ✅ Pass | e2e #6/8; browser “Draft saved. Not visible to visitors.” + anon API returns 0 rows |
| 9 | Publish | ✅ Pass | e2e #9; browser “Publish now” → anon API returns the project |
| 10 | Unpublish | ✅ Pass | e2e #10; db test |
| 11 | Delete (and restore) | ✅ Pass | e2e #11; db “deleted project can be restored” |
| 12 | Upload and remove images | ✅ Pass | e2e #12 (SVG, oversize, anon upload rejected); browser: PNG → WebP, alt text required |
| 13 | Add and edit skills | ✅ Pass | e2e #13; browser quick-add + inline level change reflected publicly |
| 14 | Add experience | ✅ Pass | e2e #14; browser drawer incl. date validation and discard prompt |
| 15 | Add certifications | ✅ Pass | e2e #15 (PDF) |
| 16 | Update profile | ✅ Pass | e2e #16; browser draft → publish, public value changed only after publish |
| 17 | Replace the resume | ✅ Pass | e2e #17; browser upload + fake-PDF rejection; public “Download resume” appeared |
| 18 | Receive contact submissions | ✅ Pass | e2e #18; browser form: validation, focus, success message |
| 19 | Filter and manage messages | ✅ Pass | e2e #19 (search, archive, counts) |
| 20 | Verify RLS permissions | ✅ Pass | 28 db tests + e2e #20 |
| 21 | Mobile admin usability | ⚠️ Partial | Chrome at 500 px: sidebar drawer, card tables, no horizontal overflow. **Not tested on a physical iPhone/iPad or iOS Safari.** |
| 22 | Published changes appear on the public site | ✅ Pass | e2e #22; browser: new project, skill, availability line and resume button all appeared with no deploy |

### Additional scenarios
| Scenario | Result |
|---|---|
| Database errors (unique slug, invalid URL, bad dates, oversize lists) → friendly messages | ✅ |
| Network / backend failure → error state with Retry; contact form keeps the typed message | ✅ (code paths; offline not physically simulated) |
| Invalid uploads (SVG, oversize, renamed non-PDF, anon upload) | ✅ |
| Duplicate entries (slug, skill name case-insensitive) | ✅ |
| Empty required fields | ✅ |
| Expired session → clear re-login message, local backup of unsaved project edits | ✅ |
| Unauthorized API calls (anon/non-admin RPCs, writes, private functions) | ✅ |
| Stale editor save (optimistic concurrency) | ✅ |
| Scheduled publish / auto-unpublish / scheduled update / failing update → notifications | ✅ (job invoked directly; real pg_cron timing not tested) |
| Analytics aggregates and charts | ✅ (fixture data for chart rendering only) |

## Manual browser QA (Chrome, macOS)
Public: hero, about, skills search/filters (live-region announcements), projects filter, case-study page with SEO
title/canonical/Open Graph/JSON-LD, experience, education & certifications, contact, footer, dark mode, mobile menu,
390 px layout (no horizontal overflow). Admin: every page loads without console errors; overview, projects list and
editor (tabs, validation, tech picker with inline skill creation, gallery upload, preview in 3 device sizes, publish),
skills, experience drawer, profile draft/publish, resume upload, analytics chart (tooltip, keyboard), expired-session
handling, mobile sidebar, logout.

### Bugs found during QA and fixed
1. Stray “0”/“00” rendered under experience entries (`array.length && …` rendering `0`) — fixed in 7 places.
2. Admin form inputs stretched to unequal heights in grid rows — fixed (`align-content/align-items: start`).
3. Character counters showed `0/120` for pre-filled values — fixed (counters resync on programmatic set).
4. Hidden editor tab sections left a stray divider; stale error dots on tabs — fixed.
5. Project cards without a cover duplicated title and category — replaced with an index/tech-stack cover.
6. Analytics y-axis had non-integer ticks (e.g. 19 from 18.75) — integer “nice” scale.
7. Preview banner overlapped the sticky header on narrow screens — banner no longer sticky.
8. Preview device frame mis-centered when scaled — fixed.
9. Skill cards stretched to equal heights; 3-column project grid orphaned the 4th card — fixed (start alignment, 2-column grid).
10. Breadcrumb arrow wrapped onto its own line; certification placeholder icon oversized — fixed.
11. New skills created from the project editor defaulted to “Experienced” — now default to “Currently exploring” to avoid overclaiming.
12. (Earlier, from DB tests) admins' direct status updates failed on a CHECK constraint calling a private validator — fixed with a scoped grant.

## Not tested — do these after going live
- [ ] Real Supabase project: run SETUP.md, then repeat cases 1–22 on the deployed site.
- [ ] Edge Functions in Deno (`supabase functions serve` or deployed): contact, track, resume.
- [ ] pg_cron actually firing on schedule (create a project scheduled 2 minutes ahead).
- [ ] Password-reset email round trip.
- [ ] Safari (macOS), iOS Safari on iPhone and iPad, Firefox, Edge, Windows.
- [ ] Lighthouse / axe accessibility audit on the deployed URL.

## Addendum — design port (2026-11-25)

The public site was restyled to match the `kthedev-portfolio` reference (dark terminal design). The reference was run
locally and compared section by section in Chrome against the new pages.

- Re-run after the port: **75 / 75 tests pass**, `npm run check` passes (48 files).
- Chrome, desktop 1440 px: hero (grid, scanlines, code fragments, typed designation + tagline, blinking cursor), about,
  projects, stack window (search + level flags), experience, education & certifications, contact (`contact.sh` + form
  submission succeeded), footer, case-study page, 404 — all render from CMS data, no console errors, fonts load locally.
- Chrome, 500 px: mobile menu works, no horizontal overflow.
- Fixed during this pass: the finished typing line kept its cursor (`[hidden]` overridden by `.cur { display }`); a lint
  false positive on the decorative `model.eval()` text; project cards now use the project slug as the terminal-style title.
- Not re-tested after the port: iOS Safari / physical devices, Safari, Firefox, Edge (same as before).

## Addendum — AI assistant and per-project SEO pages (2026-11-25)

- **Automated: 90 / 90 tests pass**; `npm run check` passes (51 files).
  - `tests/unit/assistant.test.mjs` (7): input validation, corpus contains only published content (a draft project and
    draft education are excluded), retrieval on the real seed data (8 recruiter-style questions rank the right document
    first), request shape (citations enabled, guardrail text, no prefill, effort/fallbacks), citation → source mapping,
    refusal and truncation handling.
  - `tests/e2e/features.test.mjs` (8): assistant off by default; enabled by the admin; answers cite published content and
    never draft content; validation and per-visitor rate limit; usage counted without question text; static page metadata
    and pre-rendered text; HTML-escaping of injected titles/descriptions; unpublished slug → 404 fallback; `build-seo`
    generates the sitemap and one page per published project.
- **Browser (Chrome, macOS):** assistant panel opens with focus in the input, suggestion → answer with source links;
  `/projects/document-qa-chatbot/` loads assets from the nested path, has the right title/canonical and hydrates into
  the full design; phone layout checked in a 390 px frame (full-width bottom sheet, no horizontal overflow — this also
  fixed a pre-existing 1.6 px overflow from long project slugs).
- **Not tested:** the real Claude API call (no API key was used, so no cost was incurred; locally the assistant runs in a
  clearly labelled offline mode with the same retrieval), the Deno runtime, and LinkedIn/X preview rendering of the
  deployed pages (use LinkedIn Post Inspector after deploying).

## Addendum — full error check (2026-11-25)

**Tools run:** full test suite, `npm run check`, ESLint (undefined/unused names, unreachable code, etc.) across all
JS, `deno check` (TypeScript) on all four Edge Functions, `npm ci --dry-run` (lockfile), and axe-core 4.14 (WCAG 2.0/2.1/2.2
A + AA) in Chrome on the public home page, a static project page with the assistant open, the admin login, all 14 admin
pages, every project-editor tab, an editor drawer and the notifications panel.

**Errors found and fixed**
| Area | Problem | Fix |
|---|---|---|
| Edge Functions | `ask` failed TypeScript checks (7 errors: untyped JS defaults inferred as `never[]`; `fallbacks` widened to `string`) | JSDoc types in `_shared/assistant.js`; all four functions type-check |
| Database security | `ip_hash` was readable by admins — a column-level REVOKE doesn't override a table grant, so SECURITY.md was wrong | Column-list grant without `ip_hash`; test added |
| Public site | Footer ignored the CMS “Footer links” | Footer uses footer links (falls back to header menu); seed has About/Projects/Skills/Contact |
| Public site | Assistant toggle only applied on the first render (stale cache); window listeners duplicated on re-render | Re-evaluated every render; listeners scoped with an AbortController |
| Public site (a11y) | Logo / project-card accessible names didn't contain visible text; footer note contrast 3.71:1 | Fixed; now 5.6:1 |
| Admin (a11y) | Small text at 3.42:1 contrast; 28×20 px reorder buttons (< 24×24, WCAG 2.2); tabs referencing non-existent panels; unlabelled file inputs; name/visible-text mismatches (featured toggle, drop zones) | `--subtle` darkened (≥ 4.65:1 light, ≥ 4.99:1 dark); 28×24 targets; fixed ARIA and labels |
| Admin | Save button label reverted to “Save” after publishing | Labels refreshed after the busy state |
| Config/docs | Local auth redirect used the wrong port; `SUPABASE_PUBLIC_KEY` fallback undocumented | Fixed |
| Lint | 5 unused imports/variables, 1 class referenced before definition | Cleaned up |

**Result:** 90 / 90 tests, `npm run check`, ESLint and `deno check` all pass; axe reports **0 violations** on every
page and state listed above (the 94 contrast warnings in an earlier scan were fade-in animation artifacts).
Automated accessibility tools catch roughly a third to a half of real issues — a manual screen-reader pass
(VoiceOver on Mac/iPhone) is still recommended.
