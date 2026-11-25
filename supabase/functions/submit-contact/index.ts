// POST /functions/v1/submit-contact
// Public endpoint: validates, filters spam, rate-limits and stores a contact message.
// Visitors never get write access to the database — only this function (service role) does.
import { validateContact } from '../_shared/logic.js';
import { cors, json, originAllowed, serviceClient, ipHash, rateLimited, readJson, HttpError, clientIp } from '../_shared/http.ts';

async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // optional layer; honeypot + timing + rate limit still apply
  if (typeof token !== 'string' || !token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = await res.json().catch(() => ({}));
  return out.success === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  if (!originAllowed(req)) return json(req, { error: 'Origin not allowed' }, 403);

  try {
    const body = (await readJson(req)) as Record<string, unknown>;
    const { ok, errors, value, spam } = validateContact(body);
    if (!ok) return json(req, { error: 'Please correct the highlighted fields.', fields: errors }, 422);

    const db = serviceClient();
    const hash = await ipHash(req);
    if (await rateLimited(db, `contact:${hash}`, 5, 3600)) {
      return json(req, { error: 'Too many messages. Please try again later or email me directly.' }, 429);
    }

    // Bots get a success response so they don't adapt; nothing is stored.
    if (spam) return json(req, { ok: true });

    if (!(await verifyTurnstile(body.turnstile_token, clientIp(req)))) {
      return json(req, { error: 'Spam check failed. Please try again.' }, 400);
    }

    const { error } = await db.from('contact_messages').insert({ ...value, ip_hash: hash });
    if (error) {
      console.error('insert failed', error.message);
      return json(req, { error: 'Could not send your message. Please try again shortly.' }, 500);
    }
    await db.from('analytics_events').insert({ event_type: 'contact_submit', path: '/' });
    return json(req, { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    console.error(e);
    return json(req, { error: 'Unexpected error. Please try again.' }, 500);
  }
});
