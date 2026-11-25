// GET /functions/v1/resume[?id=<uuid>]
// Redirects to a short-lived signed URL for the default (or a specific active) resume
// and records a download event. Resume files live in a PRIVATE bucket.
import { isBot, safeFileName } from '../_shared/logic.js';
import { cors, json, serviceClient, dailyVisitorHash, rateLimited, ipHash } from '../_shared/http.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'GET') return json(req, { error: 'Method not allowed' }, 405);

  try {
    const db = serviceClient();
    if (await rateLimited(db, `resume:${await ipHash(req)}`, 60, 3600)) {
      return json(req, { error: 'Too many requests. Please try again later.' }, 429);
    }

    const id = new URL(req.url).searchParams.get('id');
    let query = db.from('resumes').select('id, title, storage_path').eq('is_active', true);
    query = id && UUID_RE.test(id) ? query.eq('id', id) : query.eq('is_default', true);
    const { data: resume, error } = await query.maybeSingle();
    if (error) throw error;
    if (!resume) return json(req, { error: 'No resume is currently published.' }, 404);

    const { data: signed, error: signErr } = await db.storage
      .from('resumes')
      .createSignedUrl(resume.storage_path, 120, { download: safeFileName(`Kunal-Gupta-${resume.title}`) });
    if (signErr || !signed) throw signErr ?? new Error('Signing failed');

    const ua = req.headers.get('user-agent') ?? '';
    if (!isBot(ua) && req.headers.get('dnt') !== '1' && req.headers.get('sec-gpc') !== '1') {
      await db.from('analytics_events').insert({
        event_type: 'resume_download', path: '/resume', device: 'unknown', visitor_hash: await dailyVisitorHash(req),
      });
    }

    return new Response(null, {
      status: 302,
      headers: { ...cors(req), Location: signed.signedUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (e) {
    console.error(e);
    return json(req, { error: 'Resume is temporarily unavailable.' }, 500);
  }
});
