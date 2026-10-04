// ── Lead intelligence pipeline ──────────────────────────────────────
//   Search → Entity → Evidence → Signal → Decision-maker → Qualification
//          → Reason-to-contact → Verified address → (human) → Sequence
//
// discover() turns one search into prospect rows. processBatch() then moves
// prospects one stage at a time, saving after every stage, so a serverless
// timeout or a provider outage costs one stage of one prospect, never the run.
// A stage that throws is retried on the next run, up to MAX_ATTEMPTS.
import { getIcp } from './icp.js';
import { searchOrganic } from './serp.js';
import { resolveEntities, pickOfficialDomain } from './resolve.js';
import { crawlSite } from './crawl.js';
import { enrichProspect, findSignals } from './enrich.js';
import { ruleScore } from './score.js';
import { llmEnabled, qualify, personalize } from './llm.js';
import { verifyEmail } from './verify.js';
import * as store from './store.js';

export const MAX_ATTEMPTS = 4;
const MAX_PAGES = 3;

// ── Discovery ───────────────────────────────────────────────────────
export async function discover({ tenant, query = '', preset = '', pages = 1 }) {
  const icp = getIcp(tenant);
  const q = query || icp.presets[preset];
  if (!q) throw new Error(`give a query, or a preset: ${Object.keys(icp.presets).join(', ')}`);

  const hits = [];
  for (let page = 0; page < Math.min(Math.max(1, pages), MAX_PAGES); page++) {
    const r = await searchOrganic(q, { ...icp.serp, page });
    hits.push(...r);
    if (r.length < 10) break;
  }

  const exclude = [...icp.excludeDomains, ...(await store.knownLeadDomains(tenant))];
  // Name-only candidates (from LinkedIn hits) get a placeholder domain until
  // the crawl stage looks their website up.
  const candidates = resolveEntities(hits, { exclude }).map((c) =>
    c.domain ? c : { ...c, domain: `name:${c.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}` }
  );
  const inserted = await store.insertProspects(tenant, candidates, q);
  return { query: q, hits: hits.length, candidates: candidates.length, inserted };
}

// ── Contact choice ──────────────────────────────────────────────────
// Preference order for who to email: the LLM's pick, then named people whose
// title fits the ICP, then any named person, then role mailboxes.
export function rankContacts(contacts, icp, llmIndex = -1) {
  const withEmail = contacts.map((c, i) => ({ ...c, _i: i })).filter((c) => c.email);
  const rank = (c) => {
    if (c._i === llmIndex) return 0;
    const titled = c.title && icp.titles.some((t) => c.title.toLowerCase().includes(t));
    if (!c.generic && titled) return 1;
    if (!c.generic && c.name) return 2;
    if (!c.generic) return 3;
    return 4;
  };
  return withEmail.sort((a, b) => rank(a) - rank(b) || (b.confidence ?? 0) - (a.confidence ?? 0)).map(({ _i, ...c }) => c);
}

// ── Stages ──────────────────────────────────────────────────────────
// Each takes the prospect, mutates it, and sets the next stage.
const STAGES = {
  async discovered(p, icp) {
    if (p.domain.startsWith('name:')) {
      const hits = await searchOrganic(`"${p.company}"`, icp.serp);
      const domain = pickOfficialDomain(p.company, hits, { exclude: icp.excludeDomains });
      if (!domain) return reject(p, 'no official website found');
      if (await store.domainTaken(p.tenant, domain, p.id)) return reject(p, `duplicate of ${domain}`);
      p.domain = domain;
    }
    const site = await crawlSite(p.domain);
    if (!site.ok) {
      if (/robots/.test(site.reason)) return reject(p, site.reason);
      throw new Error(site.reason); // unreachable may be transient: retry
    }
    p.site = site;
    if (!p.company) p.company = site.title.split(/\s[|–—-]\s/)[0].slice(0, 120);
    p.stage = 'crawled';
  },

  async crawled(p, icp) {
    const { firmographics, contacts, errors } = await enrichProspect(p);
    p.firmographics = firmographics;
    p.contacts = contacts;
    try {
      p.signals = await findSignals(p, icp);
    } catch (err) {
      errors.push(`signals: ${String(err.message || err).slice(0, 120)}`);
      p.signals = [];
    }
    p.error = errors.join(' · ');
    p.stage = 'enriched';
  },

  async enriched(p, icp) {
    const rule = ruleScore(p, icp);
    const qualification = { rule, model: null, llm: null };
    let score = rule.score;
    let pass = score >= icp.minScore;

    if (llmEnabled() && rule.score > 0) {
      const v = await qualify(p, icp, rule);
      qualification.llm = v;
      qualification.model = process.env.INTEL_MODEL || 'claude-opus-5-5';
      score = Math.max(0, Math.min(100, v.fit_score));
      pass = v.is_target && score >= icp.minScore;
      p.confidence = v.confidence;
      if (v.company_name) p.company = v.company_name;
      p.firmographics = {
        ...p.firmographics,
        industry: p.firmographics.industry || v.industry,
        country: p.firmographics.country || v.country,
        size_estimate: v.size_estimate,
      };
    }

    p.qualification = qualification;
    p.fit_score = score;
    if (!pass) return reject(p, `below ICP threshold (${score} < ${icp.minScore})${qualification.llm && !qualification.llm.is_target ? ', not a target' : ''}`, false);
    p.stage = 'qualified';
  },

  async qualified(p, icp) {
    const llmIndex = p.qualification.llm ? p.qualification.llm.best_contact_index : -1;
    const ranked = rankContacts(p.contacts, icp, llmIndex).slice(0, 3);
    if (ranked.length === 0) { p.stage = 'no_contact'; p.error = 'no email address found'; return; }

    // First address that isn't provably bad. Verifier calls cost credits, so
    // stop at the first usable one.
    let chosen = null;
    const tried = [];
    for (const c of ranked) {
      const v = await verifyEmail(c.email);
      tried.push({ email: c.email, ...v });
      if (v.status !== 'invalid') { chosen = { ...c, verification: v }; break; }
    }
    if (!chosen) { p.stage = 'no_contact'; p.error = `all addresses invalid: ${tried.map((t) => `${t.email} (${t.reason})`).join(', ')}`; return; }

    p.contact = chosen;
    p.email_status = chosen.verification.status;
    if (llmEnabled()) p.personalization = { ...(await personalize(p, icp, chosen)), model: process.env.INTEL_MODEL || 'claude-opus-5-5' };
    // Only a verifier-confirmed mailbox is `ready`; everything else needs a
    // human to accept the deliverability risk at promotion.
    p.stage = p.email_status === 'valid' ? 'ready' : 'review';
  },
};

function reject(p, reason, overwriteError = true) {
  p.stage = 'rejected';
  p.error = overwriteError || !p.error ? reason : `${reason} · ${p.error}`;
}

// ── Batch runner ────────────────────────────────────────────────────
export async function processBatch({ tenant, limit = 10, budgetMs = 45_000 }) {
  const icp = getIcp(tenant);
  const started = Date.now();
  const claimed = await store.claimProspects(tenant, limit, MAX_ATTEMPTS);
  const results = [];

  for (const p of claimed) {
    const from = p.stage;
    // Walk this prospect forward until it leaves the active stages or the
    // budget runs out; whatever is left resumes on the next run.
    while (store.ACTIVE_STAGES.includes(p.stage) && Date.now() - started < budgetMs) {
      const stage = p.stage;
      try {
        await STAGES[stage](p, icp);
        p.attempts = 0;
      } catch (err) {
        p.error = `${stage}: ${String(err.message || err).slice(0, 300)}`;
        if (p.attempts >= MAX_ATTEMPTS) p.stage = 'failed';
        p.locked_until = null;
        await store.saveProspect(p);
        break;
      }
      p.locked_until = null;
      await store.saveProspect(p);
    }
    results.push({ id: p.id, domain: p.domain, from, to: p.stage, fit_score: p.fit_score, error: p.error || undefined });
    if (Date.now() - started >= budgetMs) break;
  }

  return { tenant, claimed: claimed.length, processed: results.length, results, ms: Date.now() - started };
}
