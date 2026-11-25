# Security model

The dashboard can change a public website, so authorization lives **in the database**, not in the browser.
Hiding the admin UI is a convenience; every request is independently checked by PostgreSQL.

## Trust boundaries

| Actor | Credential | Can do |
|---|---|---|
| Visitor | publishable key (public) | Read **published** rows only. No writes anywhere. Call 3 Edge Functions. |
| Signed-in non-admin | user JWT | Same as a visitor. Any attempt to open the dashboard is logged and denied. |
| Administrator | user JWT + row in `admin_users` | Full CMS CRUD through RLS policies and checked RPCs. |
| Edge Functions | service role (server-side only) | Insert contact messages / analytics events; sign resume URLs. |
| Project owner | Supabase dashboard / SQL | Create or remove administrators. |

## Database (RLS)
- RLS is enabled on **every** table in `public`; the default is deny.
- `public.is_admin()` checks `admin_users` for `auth.uid()`. Write policies on content tables are `using (is_admin()) with check (is_admin())`.
- Public reads use `is_publicly_visible(status, publish_at, unpublish_at)`, so scheduled or expired content is hidden **by time**, even if the cron job is late. Child rows (images, technologies) inherit the parent project’s visibility.
- Unpublished profile/settings edits live in `content_drafts` (admin-only), never in public rows.
- `contact_messages` has **no insert policy** — only the Edge Function (service role) can insert. `ip_hash` is not even selectable by `authenticated`.
- `content_versions` and `admin_activity_logs` are append-only: admins can read them, but inserts happen only in SECURITY DEFINER triggers, and update/delete privileges are revoked.
- Every SECURITY DEFINER function pins `search_path = ''` and starts with `require_admin()` where appropriate. Internal functions live in the `private` schema, which the Data API does not expose, with `EXECUTE` revoked from `anon`/`authenticated`.
- Validation in SQL: `https_url`, `safe_link` (https/mailto only), `email_address`, `slug_text` and `storage_path` (no traversal) domains, length and cardinality checks, JSON shape checks for links/metrics, date-order constraints, one public default resume.
- Optimistic concurrency (`revision`) prevents silent overwrites from stale tabs.

## Authentication
- Supabase Auth, email + password; public sign-up disabled; the first admin is created by the owner (docs/SETUP.md §4).
- Passwords are never stored or handled by this code. supabase-js keeps the session token in `localStorage` (standard for SPAs); the public site uses a separate client that never sends it.
- Logout uses `signOut({ scope: 'global' })`, which revokes refresh tokens on all devices. An already-issued access token remains valid until it expires (≤ 1 hour by default) — keep that lifetime short.
- Password recovery uses the PKCE flow; the reset response never reveals whether an account exists.
- Brute-force protection: Supabase Auth's built-in rate limits.

## Files
- Buckets enforce size and MIME allow-lists server-side. **SVG is not allowed** (it can carry script).
- Storage write/list policies require `is_admin()` and a safe object name.
- The browser also checks magic bytes (a renamed file cannot pass as a PDF or image), generates random file names (user file names are never used as paths), and re-encodes images.
- Resumes sit in a **private** bucket; the public button gets a 120-second signed URL from the `resume` function.

## Frontend
- CMS text is inserted with `textContent` through a small `h()` helper; `href`/`src` pass through `safeUrl()` (https/mailto/tel/relative only). `npm run check` fails on any `innerHTML`, `insertAdjacentHTML`, `document.write` or `eval`.
- Markdown → `marked` → **DOMPurify** with a strict tag/attribute allow-list (no raw HTML, `style`, `iframe`, `svg`, `form`, `javascript:` or `data:` URLs). Covered by XSS unit tests.
- Strict Content Security Policy on every page: `script-src 'self'` (plus Cloudflare Turnstile only if enabled), `style-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. All libraries and fonts are self-hosted (no third-party CDN or Google Fonts requests at runtime).
- Clickjacking: GitHub Pages cannot send `frame-ancestors`, so the dashboard refuses to run inside a frame. `robots.txt` and a `noindex` meta keep `/admin/` out of search engines.

## Edge Functions
- Origin allow-list (`ALLOWED_ORIGINS`), body size limits, strict input validation (shared with unit tests).
- Contact: honeypot, minimum fill time, link-stuffing check, optional Turnstile, **5 messages/hour per hashed IP**. Bots receive a fake success so they don't adapt.
- Analytics: whitelisted fields only, bot and DNT/GPC filtering, daily-rotating salted visitor hash, 300 events/hour cap.

## AI assistant (`ask` function)
- **No private data in scope:** the corpus is loaded with the *public* key, so RLS limits it to exactly what visitors can
  already see (drafts, messages, analytics and admin data are unreachable). Covered by unit and E2E tests.
- **Prompt injection:** documents and visitor text are passed as data; the system prompt tells the model to ignore
  instructions inside them, stay on the portfolio topic, never reveal the prompt and never add facts the documents don't
  state. The model has **no tools** — it can only return text — so an injection cannot trigger actions.
- **Output handling:** answers are rendered with `textContent` (never HTML); source links are site-relative URLs passed
  through `safeUrl()`.
- **Abuse & cost:** off by default; origin allow-list; 400-character questions; at most 3 previous turns; per-visitor
  hourly and daily limits plus a site-wide daily cap; short answers at low effort; a 30-second timeout.
- **Privacy:** question text is never stored or logged; only an anonymous `assistant_question` count is recorded.
- The `ANTHROPIC_API_KEY` exists only as a Supabase function secret.

## Static project pages
Generated at deploy time from public data only. Every CMS value is HTML-escaped (tested with script/attribute-injection
payloads), slugs are validated before being used as directory names, and pages carry the same strict CSP.

## Known limitations
- Failed sign-in attempts are recorded in Supabase **Auth logs**, not in the dashboard activity log (an unauthenticated request cannot be attributed safely).
- No MFA in the dashboard UI yet. Supabase Auth supports TOTP MFA; adding an `aal2` requirement to `is_admin()` would be the next hardening step.
- Removed images and replaced resumes are kept in Storage so that version history can restore them; there is no automatic cleanup.
