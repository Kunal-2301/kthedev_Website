# Admin guide

Dashboard: `https://<your-site>/admin/` — works on MacBook, iPad and iPhone (the sidebar becomes a slide-in menu
and tables become cards on small screens).

**Golden rule:** nothing reaches visitors until it is *published*. Drafts, unpublished profile/settings edits and
scheduled content are visible only to you (in **Preview**).

---

## Adding a new project (the 2-minute workflow)

1. **Projects → New project** (or *Quick actions → Add new project*).
2. **Overview** — name (the slug fills itself in), category, short description, status (Completed / In progress / Live & maintained / Planned), *Featured* toggle.
3. **Details** — description, problem, solution, architecture, implementation (Markdown: **bold**, lists, `code`, links, headings — use *Preview* in each editor), key features and challenges (one per line), and optional **metrics** (only real, measured results).
4. **Technologies** — type to search your skills; press ↓/Enter to add. If a technology is new, choose **Create “…”**, pick a category and level — it is added to your Skills too. Order with the arrows (the first five show on cards).
5. **Media** — cover image, then drop screenshots and architecture diagrams. Large images are resized and converted to WebP in your browser before upload. **Every image needs alt text.** Reorder with the arrows.
6. **Links** — GitHub, live demo, docs, related resources (all must be `https://`).
7. **SEO** — optional title/description with a live search-result preview.
8. **Preview** (saves first) → check desktop / tablet / mobile.
9. **Publish now.** It is live immediately — no GitHub deployment.

Shortcuts and safety nets: **⌘S / Ctrl+S** saves · leaving with unsaved changes asks first · unsaved work is
backed up in this browser and offered for restore if something goes wrong · if the project was changed in another
tab, the save is refused (no silent overwrite) and you can reload.

### Publishing options (Publishing tab)
| Status | Meaning |
|---|---|
| Draft | Private. |
| Published | Live. While live, the main button reads **Update live project**. |
| Scheduled | Goes live at *Publish at* (your local time). Handled by the database every minute — the dashboard can be closed. |
| Archived | Hidden but kept. |

*Unpublish at* (optional) returns a project to draft automatically. **Schedule an update** (live projects): edit the
project, then schedule those edits for a future time instead of saving; the live page is untouched until then.
See everything queued in **Scheduled**.

### Ordering, featuring, deleting
In **Projects**, use the arrows to order, the star to feature, *Unpublish/Publish*, *Archive*, and the trash icon to
delete. Deleted items can be restored: **Activity logs → Version history → History → Restore** (they come back as drafts).

## Skills
- **Quick add**: name + category + level → *Add skill* (Enter works). Live on the site immediately.
- Change a level from the dropdown, hide/show with the switch, reorder with the arrows, **Edit** for description and icon.
- **Categories** tab: create, rename, reorder or hide categories. A category that still contains skills cannot be deleted.
- Levels: **Experienced** (used in real projects/work) · **Familiar** (working knowledge) · **Currently exploring** (learning). No percentages, by design.

## Experience, Education, Certifications, Navigation
Same pattern everywhere: **Add …** opens a side panel; *Edit*, *Publish/Hide*, *History* and *Delete* on each row;
arrows to reorder. Certifications accept an image or PDF and a verification link. Navigation has tabs for the header
menu, footer links and social icons; links must be `https://` or `mailto:` (no scripts or markup can be entered).

## Profile & Website settings
The **Handle** (e.g. `kthedev`) is the big hero title and the `> kthedev` logo; the **Tagline** is typed out in amber under
your designation. Edits are saved as a **draft** first: *Save draft* → *Preview* → **Publish**. A banner shows when an unpublished draft
exists; *Discard draft* throws it away. Website settings also control the social sharing image, favicon, and which
**sections are public** (hidden sections disappear from the page and the menu).

## Resume
Upload several PDFs (e.g. AI Engineer, Backend, GenAI, General). For each: **Preview**, download, **Set as public**,
**Replace file** (old file kept for history), rename/describe, activate/deactivate, delete. The site’s *Download
resume* buttons always serve the current public resume through a short-lived secure link (the file itself is in a
private bucket) and count downloads. *Upload history* lists every upload/replacement.

## Messages
Inbox / Unread / Archived / All, search, open to read (marks as read), mark unread, archive, delete, **Reply** opens
your mail app. The sidebar badge and bell show unread messages. Spam (honeypot, too-fast bots, link stuffing) and
floods (5 per hour per sender) are stopped on the server before reaching the inbox.

## Analytics
Page views, visits, average daily visitors, project views, resume downloads, contact messages, a daily trend
(hover or use ← → on the chart; *View as table* for exact numbers), popular projects, most-viewed sections, referral
sources and devices — for 7/30/90 days, 12 months or a custom range. Privacy: no cookies, no IP addresses, visitor
IDs rotate daily (so “unique visitors” are per day), Do-Not-Track/GPC respected, events kept 13 months. Can be turned
off in **Website settings → Privacy**.

## Notifications, activity & history
- **Bell**: new messages, scheduled publish successes/failures, failed uploads, unauthorized sign-in attempts.
- **Activity logs**: append-only record of every create/update/publish/delete, resume upload, settings change and sign-in/out, with who and when.
- **History** (on any row or editor): every significant change saves the previous version first; view a version field-by-field and **Restore** (confirmation required; the current version is preserved too).

## Signing out
Sidebar → **Log out** ends the session on all devices.

## AI portfolio assistant
Turn it on in **Website settings → AI portfolio assistant** (needs the setup in SETUP.md §9). Visitors open
`> ask kthedev` and get short answers built only from your **published** content, each with links to its sources. It
declines off-topic requests and prompt-injection attempts, never invents facts, and is rate-limited. Questions are not
stored — **Analytics** shows only how many were asked. Better content = better answers: complete case studies, accurate
skill levels and real metrics make the assistant more useful.

## Project URLs and link previews
Each published project has a shareable page at `/projects/<slug>/` (the slug from the project editor), with its own
preview card on LinkedIn, X and Slack — use the cover image for the best-looking preview. Changing a slug changes the URL,
so avoid renaming slugs after you've shared a link.
