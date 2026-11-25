// Shared HTTP / Supabase helpers for Edge Functions (Deno runtime).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';

/** Service-role client. The key exists only in the Edge runtime — never in the browser. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Edge Function is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function allowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = allowedOrigins();
  const allow = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Reject browser requests from origins not in ALLOWED_ORIGINS (when configured). */
export function originAllowed(req: Request): boolean {
  const allowed = allowedOrigins();
  if (allowed.length === 0) return true;
  const origin = req.headers.get('origin');
  return !origin || allowed.includes(origin);
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function clientIp(req: Request): string {
  return (req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0] ??
    'unknown').trim();
}

export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Salted IP hash — the raw IP is never stored. */
export async function ipHash(req: Request): Promise<string> {
  const salt = Deno.env.get('ANALYTICS_SALT') ?? 'change-me';
  return (await sha256(`${salt}:ip:${clientIp(req)}`)).slice(0, 32);
}

/**
 * Anonymous visitor id that rotates every UTC day: hash(secret salt + date + IP + UA).
 * No cookies or client storage; cannot be linked across days or reversed to an IP.
 */
export async function dailyVisitorHash(req: Request): Promise<string> {
  const salt = Deno.env.get('ANALYTICS_SALT') ?? 'change-me';
  const day = new Date().toISOString().slice(0, 10);
  return (await sha256(`${salt}:${day}:${clientIp(req)}:${req.headers.get('user-agent') ?? ''}`)).slice(0, 32);
}

export async function rateLimited(db: SupabaseClient, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await db.rpc('hit_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) { console.error('rate limit error', error.message); return false; } // fail open, other defenses remain
  return data === false;
}

export async function readJson(req: Request, maxBytes = 20_000): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'Request too large');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request too large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
