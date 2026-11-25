# Setup & deployment

Time: ~20 minutes. You need a GitHub account and a free Supabase account.
Values in `<angle brackets>` are yours to fill in.

---

## 1. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**. Pick a region close to your visitors (e.g. Mumbai `ap-south-1`).
2. When it is ready, open **Project Settings → API Keys** (or **Connect**) and copy:
   - **Project URL** — `https://<ref>.supabase.co`
   - **Publishable key** — starts with `sb_publishable_` (older projects: the `anon` key, a JWT).
   - ⚠️ Never copy the **secret / service_role** key into this repository. Edge Functions receive it automatically.

## 2. Initialize the database

**Option A — SQL Editor (simplest).** Dashboard → **Database → Extensions**: enable **pg_cron**
(Integrations → Cron on newer dashboards). Then **SQL Editor**, and run each file's full contents, **in this order**:

| # | File | Creates |
|---|---|---|
| 1 | `database/schema.sql` | tables, domains, indexes, constraints |
| 2 | `database/functions.sql` | triggers (versions, audit log), RPCs, scheduler, analytics |
| 3 | `database/rls-policies.sql` | Row Level Security policies + privilege hardening |
| 4 | `database/storage.sql` | `media`, `certificates` (public) and `resumes` (private) buckets with size/MIME limits |
| 5 | `database/cron.sql` | every-minute scheduling job + analytics retention |
| 6 | `database/seed.sql` | your initial content (from the resume) |

**Option B — Supabase CLI.**
```bash
npm run build:migration                       # regenerates supabase/migrations + supabase/seed.sql
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push                          # applies the migration
psql "<connection string from Dashboard → Connect>" -f supabase/seed.sql   # or paste seed.sql into the SQL editor
```

Verify: **Table Editor** shows `projects` with 4 rows; **Database → Cron Jobs** lists `process-scheduled-content`.

## 3. Authentication

1. **Authentication → Sign In / Providers → Email**: keep Email enabled and **turn OFF “Allow new users to sign up”**.
   (Even if sign-up were left on, a new account has no admin rights — authorization is the `admin_users` table —
   but there is no reason to allow it.)
2. **Authentication → URL Configuration**
   - Site URL: `https://<your-username>.github.io`
   - Redirect URLs: add `https://<your-username>.github.io/admin/` (and `http://localhost:8787/admin/` for local tests).
3. Recommended: **Auth → Sessions/JWT**: keep access-token expiry at 1 hour or lower. Enable leaked-password protection if your plan offers it.

## 4. Create the first administrator (secure, one-time)

1. **Authentication → Users → Add user → Create new user**: your email + a strong password (12+ characters),
   tick **Auto Confirm User**.
2. **SQL Editor**:
   ```sql
   insert into public.admin_users (user_id, email)
   select id, email from auth.users where email = '<you@example.com>';
   ```
That row is the *only* thing that grants dashboard access. It cannot be created through the API — only by the
project owner in SQL. To revoke access: `delete from public.admin_users where email = '…';`

## 5. Edge Functions (contact form, analytics, resume downloads)

```bash
npx supabase functions deploy submit-contact --no-verify-jwt
npx supabase functions deploy track          --no-verify-jwt
npx supabase functions deploy resume         --no-verify-jwt
npx supabase functions deploy ask            --no-verify-jwt   # optional: AI portfolio assistant

npx supabase secrets set \
  ALLOWED_ORIGINS="https://<your-username>.github.io" \
  ANALYTICS_SALT="$(openssl rand -hex 32)"
# optional spam challenge (Cloudflare Turnstile):
# npx supabase secrets set TURNSTILE_SECRET_KEY="<secret>"   and put the SITE key in js/config.js
```

`--no-verify-jwt` is correct here: these are public endpoints with their own validation, origin checks and rate
limits, and the new publishable keys are not JWTs. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by Supabase automatically — do not set them yourself.

| Secret | Required | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | yes | Comma-separated origins allowed to call the functions (your Pages URL / custom domain) |
| `ANALYTICS_SALT` | yes | Secret salt for anonymous daily visitor hashes and IP hashes (never store raw IPs) |
| `TURNSTILE_SECRET_KEY` | no | Enables Cloudflare Turnstile verification on the contact form |
| `ANTHROPIC_API_KEY` | for the assistant | Claude API key used only by the `ask` function. Create one at console.anthropic.com; set a monthly spend limit there too. |
| `ASSISTANT_MODEL` | no | Model for the assistant (default `claude-opus-5-5`). |
| `SUPABASE_PUBLIC_KEY` | only if needed | The `ask` function reads published content with the public key Supabase injects as `SUPABASE_ANON_KEY`. If your project has legacy keys disabled, set this to your publishable key. |
| `ASSISTANT_HOURLY_LIMIT` / `ASSISTANT_VISITOR_DAILY_LIMIT` / `ASSISTANT_DAILY_LIMIT` | no | Questions per visitor per hour (10) / per visitor per day (30) / for the whole site per day (300). |

## 6. Configure the frontend

Edit **`js/config.js`** (safe to commit — it only holds public values):

```js
supabaseUrl: 'https://<ref>.supabase.co',
supabaseKey: 'sb_publishable_…',
siteUrl: 'https://<your-username>.github.io',
turnstileSiteKey: '',   // optional
```

Also update the static fallback URLs (`og:url`, `canonical`, `og:image`) in `index.html` and the `Sitemap:` line
in `robots.txt` if your URL differs from `https://kunal-2301.github.io`.

`npm run check` fails if a secret or service-role key ever ends up in a public file.

## 7. Deploy to GitHub Pages

1. Create the repository **`<your-username>.github.io`** (serves at the root URL; recommended) and push this folder.
   A project repository (`/<repo>/`) also works because all page links are relative; only `404.html` assumes the root.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Optional: **Settings → Variables → Actions → New variable** `SITE_URL` = your public URL (used for the sitemap).
4. Push to `main`. The **Deploy to GitHub Pages** workflow publishes only the public files
   (`index.html`, `project.html`, `404.html`, `admin/`, `css/`, `js/`, `assets/`, `robots.txt`) plus a freshly
   generated `sitemap.xml`. The **CI** workflow runs the checks and all tests.

Content edits made in `/admin` never need a deployment. The Pages workflow also runs daily to refresh the
sitemap — which also keeps a free-tier Supabase project active (free projects pause after a week without activity).

## 8. First login

Open `https://<your-username>.github.io/admin/`, sign in, and:
1. **Resume** → upload your PDF → *Use as the public “Download resume” file*.
2. **Skills** → review the seeded experience levels.
3. **Profile** → add a photo and an availability line if you like → **Publish**.

---

## Environment summary

| Where | Value | Secret? |
|---|---|---|
| `js/config.js` | Supabase URL, publishable key, site URL, Turnstile site key | No (public by design; protected by RLS) |
| Supabase function secrets | `ALLOWED_ORIGINS`, `ANALYTICS_SALT`, `TURNSTILE_SECRET_KEY` | Yes — never in the repo |
| Supabase (automatic) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` inside Edge Functions | Yes — never in the repo |
| GitHub variable (optional) | `SITE_URL` | No |

No `.env` file is needed for the site. `.gitignore` excludes `.env*` in case you create one for the CLI.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site shows “Site not configured” | `js/config.js` still has placeholders, or the key is a secret key (rejected on purpose). |
| Site shows “Content could not be loaded” | Check the browser console. Usually the URL/key is wrong, the SQL wasn’t run, or the project is paused (Dashboard → Restore). |
| Login works but “This account is not authorized” | The user has no row in `public.admin_users` — run step 4. |
| “Your session has expired” often | Normal after the access-token lifetime if the tab slept; sign in again. Unsaved project edits are kept in the browser and offered for restore. |
| Password-reset link says invalid | Open the link in the **same browser** you requested it from (PKCE flow), and make sure `/admin/` is in Redirect URLs. |
| Contact form: “Origin not allowed” | Add your exact site origin to `ALLOWED_ORIGINS` (scheme + host, no trailing slash). |
| Contact form / resume / analytics return 401 | Functions were deployed without `--no-verify-jwt`; redeploy with the flag. |
| Upload fails “type not allowed” / “too large” | Bucket limits: images ≤ 5 MB (PNG/JPG/WebP/AVIF/GIF — SVG is blocked on purpose), certificates ≤ 10 MB incl. PDF, resumes PDF ≤ 10 MB. |
| Scheduled project didn’t publish | Database → Cron Jobs → check `process-scheduled-content` exists and runs (`select * from cron.job_run_details order by start_time desc limit 10;`). The **Run scheduler now** button in *Scheduled* runs it manually. Visibility is also time-based in RLS, so due content is shown even if the job is late. |
| Analytics shows nothing | Expected until the `track` function is deployed and real visitors arrive. Visits from localhost, Do-Not-Track or Global-Privacy-Control browsers are never counted. |
| New project doesn’t appear for a returning visitor immediately | The site paints from a local cache first and refreshes in the background; the new content appears within the same page load. |

## 9. Optional: AI portfolio assistant

1. Deploy the function and add the key (§5): `npx supabase functions deploy ask --no-verify-jwt` and
   `npx supabase secrets set ANTHROPIC_API_KEY="sk-ant-…"`. Also set a monthly spend limit in the Anthropic Console.
2. **Admin → Website settings → AI portfolio assistant → Show the “ask” assistant** → Publish.
3. Open the site: the `> ask kthedev` button appears bottom-right.

Cost: answers are short (≤ ~120 words), use low effort, and send only the ~5 most relevant portfolio documents, so a
question costs roughly 2–4 US cents on the default model (`claude-opus-5-5`: about 4–5k input tokens at $4/M plus
~0.5k output tokens at $20/M). With the default cap of 300 questions/day site-wide, the worst case is about $10/day,
so set `ASSISTANT_DAILY_LIMIT` to what you're comfortable with (e.g. 50 ≈ $1.50/day) and a monthly limit in the Console.
The function reads content with the public key, so only **published** content can ever be used in answers.

## 10. Per-project SEO pages

Nothing to configure: every deploy (and the daily scheduled run) generates `/projects/<slug>/index.html` for each
published project, with its own title, description, canonical URL, preview image (the cover image, or the site OG image)
and the case-study text pre-rendered for crawlers. Project cards link to these URLs, and they are listed in `sitemap.xml`.

A project published *after* the last deploy still works immediately: GitHub Pages serves `404.html`, which forwards
`/projects/<slug>/` to the dynamic page. To refresh previews/sitemap right away, run **Actions → Deploy to GitHub Pages →
Run workflow**.
