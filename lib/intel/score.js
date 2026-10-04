// ── Rule-based ICP score ────────────────────────────────────────────
// Deterministic, free, explainable. It is the whole verdict when no LLM is
// configured, and a hint the LLM sees otherwise. 0–100:
//   industry keywords in site/firmographics  up to 40
//   geography (TLD, country, or geo words)   20
//   a contact whose title matches the ICP    25
//   at least one signal (news hit)           15
// Any negative keyword or excluded domain → 0.
import { hostMatches } from './resolve.js';

export function ruleScore(prospect, icp) {
  const site = prospect.site || {};
  const firmo = prospect.firmographics || {};
  const hay = [site.title, site.description, site.text, firmo.industry, firmo.description, prospect.company]
    .filter(Boolean).join(' ').toLowerCase();
  const reasons = [];

  if (hostMatches(prospect.domain, icp.excludeDomains)) return { score: 0, reasons: ['excluded domain'] };
  const neg = icp.negativeKeywords.find((k) => hay.includes(k));
  if (neg) return { score: 0, reasons: [`negative keyword: ${neg}`] };

  const hits = icp.keywords.filter((k) => hay.includes(k));
  const kw = Math.min(40, hits.length * 8);
  if (hits.length) reasons.push(`keywords: ${hits.slice(0, 6).join(', ')}`);

  const tld = prospect.domain.split('.').pop();
  const geo = icp.tlds.includes(tld)
    || (firmo.country && icp.countries.some((c) => firmo.country.toUpperCase().includes(c)))
    || icp.geoWords.some((w) => hay.includes(w));
  if (geo) reasons.push('in target geography');

  const titled = (prospect.contacts || []).find((c) => c.title && icp.titles.some((t) => c.title.toLowerCase().includes(t)));
  if (titled) reasons.push(`contact: ${titled.title}`);

  const signal = (prospect.signals || []).length > 0;
  if (signal) reasons.push(`${prospect.signals.length} news hit(s)`);

  return { score: kw + (geo ? 20 : 0) + (titled ? 25 : 0) + (signal ? 15 : 0), reasons };
}
