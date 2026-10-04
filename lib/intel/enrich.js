// ── Enrichment waterfall ────────────────────────────────────────────
// Each provider is optional and keyed by env. They run in order and each only
// fills what's still missing, so adding a paid provider later is one function
// in PROVIDERS, not a rewrite. With no keys at all, the crawl still yields
// firmographic hints and published emails.
//
//   APOLLO_API_KEY  → company firmographics (size, industry, country, tech)
//   HUNTER_API_KEY  → named people with work emails and job titles
//   (always)        → emails published on the company's own site
//
// Output contact shape: { name, title, email, source, confidence, generic }
import { getJson } from './http.js';
import { isGeneric } from './crawl.js';
import { searchNews } from './serp.js';

async function apolloOrg(domain) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null;
  const data = await getJson('Apollo', `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    headers: { 'x-api-key': key, 'Cache-Control': 'no-cache' },
  });
  const o = data.organization;
  if (!o) return null;
  return {
    firmographics: {
      name: o.name || '',
      employees: o.estimated_num_employees ?? null,
      industry: o.industry || '',
      country: o.country || '',
      city: o.city || '',
      description: (o.short_description || '').slice(0, 500),
      technologies: (o.technology_names || []).slice(0, 25),
      linkedin: o.linkedin_url || '',
      source: 'apollo',
    },
  };
}

async function hunterPeople(domain) {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ domain, limit: '10', api_key: key });
  const data = await getJson('Hunter', `https://api.hunter.io/v2/domain-search?${params}`);
  const d = data.data || {};
  return {
    firmographics: { name: d.organization || '', country: d.country || '', industry: d.industry || '', source: 'hunter' },
    contacts: (d.emails || []).filter((e) => e.value).map((e) => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(' '),
      title: e.position || '',
      email: e.value.toLowerCase(),
      source: 'hunter',
      confidence: typeof e.confidence === 'number' ? e.confidence / 100 : null,
      generic: e.type === 'generic' || isGeneric(e.value),
    })),
  };
}

function siteEmails(prospect) {
  return {
    contacts: (prospect.site.emails || []).map((email) => ({
      name: '', title: '', email, source: 'website', confidence: 0.5, generic: isGeneric(email),
    })),
  };
}

const PROVIDERS = [apolloOrg, hunterPeople];

// Merge firmographics without letting a later, thinner provider blank out an
// earlier field.
function mergeFirmo(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (k === 'source') continue;
    if (out[k] == null || out[k] === '' || (Array.isArray(out[k]) && out[k].length === 0)) out[k] = v;
  }
  out.sources = [...new Set([...(a.sources || []), b && b.source].filter(Boolean))];
  return out;
}

export async function enrichProspect(prospect) {
  let firmographics = { ...prospect.firmographics };
  const contacts = [];
  const errors = [];

  for (const provider of PROVIDERS) {
    try {
      const r = await provider(prospect.domain);
      if (!r) continue;
      if (r.firmographics) firmographics = mergeFirmo(firmographics, r.firmographics);
      if (r.contacts) contacts.push(...r.contacts);
    } catch (err) {
      // One provider down must not stall the prospect; note it and move on.
      errors.push(String(err.message || err).slice(0, 160));
    }
  }
  contacts.push(...siteEmails(prospect).contacts);
  // People seen in discovery (a LinkedIn hit) have no email yet, but their
  // name/title still steers which address we pick.
  for (const p of prospect.discovery.people || []) contacts.push({ ...p, email: '', confidence: null, generic: false });

  // Dedupe by email (keep the richest record); keep email-less people by name.
  const byKey = new Map();
  for (const c of contacts) {
    const k = c.email || `name:${(c.name || '').toLowerCase()}`;
    const prev = byKey.get(k);
    if (!prev || (!prev.title && c.title) || (!prev.name && c.name)) byKey.set(k, { ...prev, ...c });
  }

  return { firmographics, contacts: [...byKey.values()].slice(0, 25), errors };
}

// ── Signal engine (evidence for "why now") ──────────────────────────
// Recent news about the company, filtered by the ICP's trigger terms. The LLM
// later decides which, if any, is a real reason to reach out. Off when
// INTEL_SIGNALS=off (it costs one SerpApi credit per prospect).
export async function findSignals(prospect, icp) {
  if ((process.env.INTEL_SIGNALS || '').toLowerCase() === 'off') return [];
  const name = prospect.company || prospect.firmographics.name || prospect.domain;
  const q = `"${name.replace(/"/g, '')}" ${icp.signalTerms}`;
  return searchNews(q, { gl: icp.serp.gl, hl: icp.serp.hl, limit: 6 });
}
