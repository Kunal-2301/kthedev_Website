# Quick start: the minimum setup

This gets the site live with **only what a recruiter needs**: your content, the contact form and the resume download.
It takes about 15 minutes. The full guide with every option is [SETUP.md](SETUP.md).

You can skip these. They are off by default and can be added later:

- **AI assistant** (needs a paid Claude API key)
- **Analytics** (visitor stats)
- **Cloudflare Turnstile** (spam challenge; the contact form already has a honeypot and rate limits)

---

## Checklist

**1. Supabase project** ([SETUP §1](SETUP.md#1-create-the-supabase-project))
- [ ] Create a free project at supabase.com.
- [ ] Copy the **Project URL** and the **publishable key** (`sb_publishable_…`). Never copy the secret / service_role key.

**2. Database** ([SETUP §2](SETUP.md#2-initialize-the-database))
- [ ] Enable the **pg_cron** extension.
- [ ] In the SQL Editor, run these files in order: `schema.sql`, `functions.sql`, `rls-policies.sql`, `storage.sql`, `cron.sql`, `seed.sql` (all in `database/`).

**3. Login** ([SETUP §3–4](SETUP.md#3-authentication))
- [ ] Authentication → Email: turn **off** "Allow new users to sign up".
- [ ] URL Configuration: Site URL `https://<your-username>.github.io`, redirect URL `https://<your-username>.github.io/admin/`.
- [ ] Add yourself as a user (Auto Confirm), then run the one-line `insert into public.admin_users …` from SETUP §4.

**4. Two Edge Functions** (contact form and resume download)
```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase functions deploy submit-contact --no-verify-jwt
npx supabase functions deploy resume         --no-verify-jwt
npx supabase secrets set ALLOWED_ORIGINS="https://<your-username>.github.io" ANALYTICS_SALT="$(openssl rand -hex 32)"
```
(`ANALYTICS_SALT` is needed even without analytics. It anonymises visitors for the contact form's rate limit.)

**5. Frontend**
- [ ] In `js/config.js`, paste your Project URL and publishable key.

**6. Publish on GitHub Pages** ([SETUP §7](SETUP.md#7-deploy-to-github-pages))
- [ ] Push this folder to a repository named `<your-username>.github.io`.
- [ ] Go to Settings → Pages → Source: **GitHub Actions**.

**7. First login:** open `/admin/` on your site.
- [ ] **Resume** → upload your PDF and set it as the public download.
- [ ] **Projects** → add a cover image and 2–3 screenshots to each project.
- [ ] **Profile** → add a photo → **Publish**.

**8. Smoke test**
- [ ] The home page loads with your content.
- [ ] Send yourself a message through the contact form. It should appear under **Messages** in the admin.
- [ ] "Download resume" downloads your PDF. `/resume.html` shows the printable version.
- [ ] Paste your URL into LinkedIn's post composer and check that the preview card appears.

---

## Turning on an extra later

| Extra | How |
|---|---|
| Analytics | `npx supabase functions deploy track --no-verify-jwt`, then Admin → Website settings → Analytics → on. |
| AI assistant | See [SETUP §9](SETUP.md#9-optional-ai-portfolio-assistant). |
| Turnstile | See the Turnstile lines in [SETUP §5](SETUP.md#5-edge-functions-contact-form-analytics-resume-downloads). |
