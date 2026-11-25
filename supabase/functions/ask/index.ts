// POST /functions/v1/ask — "Ask my portfolio" assistant.
//
// • Answers ONLY from published portfolio content: the corpus is read with the
//   public (anon/publishable) key, so Row Level Security guarantees drafts,
//   messages and private data can never reach the model or the visitor.
// • Retrieval: BM25 over CMS documents → Claude with citation-enabled documents.
// • Cost controls: off by default (site_settings.assistant_enabled), per-visitor
//   hourly/daily limits, a global daily cap, short answers, low effort.
// • Privacy: question text is never stored; only an anonymous count is recorded.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { validateQuestion, buildCorpus, selectContext, buildRequest, extractAnswer } from '../_shared/assistant.js';
import { cors, json, originAllowed, serviceClient, ipHash, dailyVisitorHash, rateLimited, readJson, HttpError } from '../_shared/http.ts';

const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-opus-5-5';
const PER_HOUR = Number(Deno.env.get('ASSISTANT_HOURLY_LIMIT') ?? 10);
const PER_DAY = Number(Deno.env.get('ASSISTANT_VISITOR_DAILY_LIMIT') ?? 30);
const GLOBAL_DAY = Number(Deno.env.get('ASSISTANT_DAILY_LIMIT') ?? 300);

type Corpus = { at: number; enabled: boolean; profile: Record<string, unknown>; docs: ReturnType<typeof buildCorpus> };
let cache: Corpus | null = null;

/** Published content only — read through RLS with the public key. */
async function loadCorpus(): Promise<Corpus> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const publicKey = Deno.env.get('SUPABASE_PUBLIC_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');
  if (!publicKey) throw new Error('SUPABASE_ANON_KEY (or SUPABASE_PUBLIC_KEY) is not available to the function');
  const pub = createClient(Deno.env.get('SUPABASE_URL')!, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [profile, settings, cats, skills, projects, experience, education, certifications] = await Promise.all([
    pub.from('profiles').select('*').eq('id', 1).maybeSingle(),
    pub.from('site_settings').select('assistant_enabled').eq('id', 1).maybeSingle(),
    pub.from('skill_categories').select('id, name, is_visible').order('sort_order'),
    pub.from('skills').select('name, category_id, level, is_visible').order('sort_order'),
    pub.from('projects').select('slug, title, category, project_status, short_description, description_md, problem_md, solution_md, ' +
      'architecture_md, implementation_md, key_features, challenges, metrics, github_url, demo_url, ' +
      'project_technologies(sort_order, skill:skills(name))').order('sort_order'),
    pub.from('experience').select('*').order('sort_order'),
    pub.from('education').select('*').order('sort_order'),
    pub.from('certifications').select('name, issuer, issue_date, verify_url').order('sort_order'),
  ]);
  for (const r of [profile, settings, cats, skills, projects, experience, education, certifications]) if (r.error) throw r.error;

  const docs = buildCorpus({
    profile: profile.data ?? {},
    categories: (cats.data ?? []).filter((c) => c.is_visible),
    skills: (skills.data ?? []).filter((s) => s.is_visible),
    projects: (projects.data ?? []).map((p: Record<string, any>) => ({
      ...p,
      technologies: (p.project_technologies ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((t: any) => t.skill?.name).filter(Boolean),
    })),
    experience: experience.data ?? [],
    education: education.data ?? [],
    certifications: certifications.data ?? [],
  });
  cache = { at: Date.now(), enabled: settings.data?.assistant_enabled === true, profile: profile.data ?? {}, docs };
  return cache;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  if (!originAllowed(req)) return json(req, { error: 'Origin not allowed' }, 403);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  try {
    const corpus = await loadCorpus();
    if (!corpus.enabled || !apiKey) return json(req, { error: 'The assistant is currently unavailable.' }, 503);

    const v = validateQuestion(await readJson(req, 12_000));
    if (!v.ok) return json(req, { error: v.error }, 422);

    const db = serviceClient();
    const who = await ipHash(req);
    if (await rateLimited(db, `ask:h:${who}`, PER_HOUR, 3600) || await rateLimited(db, `ask:d:${who}`, PER_DAY, 86400)) {
      return json(req, { error: 'You have reached the question limit for now. Please try again later, or use the contact form.' }, 429);
    }
    if (await rateLimited(db, 'ask:global', GLOBAL_DAY, 86400)) {
      return json(req, { error: 'The assistant has reached its daily limit. Please use the contact form instead.' }, 429);
    }

    const docs = selectContext(corpus.docs, v.question, v.history);
    const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const response = await client.beta.messages.create(
      buildRequest({ model: MODEL, profile: corpus.profile, question: v.question, history: v.history, docs }),
    );
    const out = extractAnswer(response, docs);

    await db.from('analytics_events').insert({ event_type: 'assistant_question', path: '/', visitor_hash: await dailyVisitorHash(req) });

    if (out.refused || !out.answer) {
      const name = String(corpus.profile.full_name ?? 'the owner');
      return json(req, { answer: `I can't help with that. Ask me about ${name}'s projects, skills or experience.`, sources: [] });
    }
    return json(req, { answer: out.truncated ? `${out.answer} …` : out.answer, sources: out.sources });
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    if (e instanceof Anthropic.RateLimitError) return json(req, { error: 'The assistant is busy. Please try again in a minute.' }, 503);
    if (e instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic authentication failed — check the ANTHROPIC_API_KEY secret');
      return json(req, { error: 'The assistant is currently unavailable.' }, 503);
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${e.status}: ${e.message}`);
      return json(req, { error: 'The assistant could not answer right now. Please try again.' }, 502);
    }
    console.error(e);
    return json(req, { error: 'Unexpected error. Please try again.' }, 500);
  }
});
