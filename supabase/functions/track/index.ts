// POST /functions/v1/track — privacy-conscious analytics beacon.
// Stores: event type, path, section/project slug, referrer HOST, device class,
// and a daily-rotating anonymous hash. No IP, no cookies, no user agent string.
import { validateEvent, isBot, deviceFromUA, referrerHost } from '../_shared/logic.js';
import { cors, json, originAllowed, serviceClient, dailyVisitorHash, rateLimited, readJson, HttpError, allowedOrigins } from '../_shared/http.ts';

let enabledCache: { value: boolean; at: number } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  if (!originAllowed(req)) return json(req, { error: 'Origin not allowed' }, 403);

  try {
    const ua = req.headers.get('user-agent') ?? '';
    if (isBot(ua) || req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1') {
      return new Response(null, { status: 204, headers: cors(req) });
    }
    const body = (await readJson(req, 4000)) as Record<string, unknown>;
    const event = validateEvent(body);
    if (!event) return json(req, { error: 'Invalid event' }, 400);

    const db = serviceClient();
    if (!enabledCache || Date.now() - enabledCache.at > 60_000) {
      const { data } = await db.from('site_settings').select('analytics_enabled').eq('id', 1).maybeSingle();
      enabledCache = { value: data?.analytics_enabled !== false, at: Date.now() };
    }
    if (!enabledCache.value) return new Response(null, { status: 204, headers: cors(req) });

    const visitor = await dailyVisitorHash(req);
    if (await rateLimited(db, `track:${visitor}`, 300, 3600)) return new Response(null, { status: 204, headers: cors(req) });

    const siteHosts = allowedOrigins().map((o) => { try { return new URL(o).hostname; } catch { return ''; } }).filter(Boolean);
    let device = deviceFromUA(ua);
    if (device === 'desktop' && body.touch === true && /Macintosh/.test(ua)) device = 'tablet'; // iPadOS desktop UA

    const { error } = await db.from('analytics_events').insert({
      ...event,
      referrer_host: event.event_type === 'page_view' ? referrerHost(body.referrer as string, siteHosts) : null,
      device,
      visitor_hash: visitor,
    });
    if (error) console.error('track insert failed', error.message);
    return new Response(null, { status: 204, headers: cors(req) });
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    console.error(e);
    return new Response(null, { status: 204, headers: cors(req) });
  }
});
