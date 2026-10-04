// ── Entity resolver ─────────────────────────────────────────────────
// A search result is not a company. This turns raw organic hits into one
// candidate per registrable domain: directories, social networks, job boards
// and news sites are dropped (they'd "resolve" to the wrong company), and a
// LinkedIn company/person hit becomes a name-only candidate that still needs
// its website looked up.

// Hosts whose pages are ABOUT other companies. Matching is by suffix, so
// `nl.linkedin.com` is covered by `linkedin.com`.
export const NON_COMPANY_HOSTS = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com',
  'wikipedia.org', 'wikidata.org', 'google.com', 'goo.gl', 'apple.com', 'amazon.com', 'bol.com',
  'indeed.com', 'indeed.nl', 'glassdoor.com', 'glassdoor.nl', 'nationalevacaturebank.nl', 'werkzoeken.nl', 'monsterboard.nl',
  'kvk.nl', 'opencorporates.com', 'companyinfo.nl', 'drimble.nl', 'bedrijvenpagina.nl', 'oozo.nl', 'telefoonboek.nl', 'detelefoongids.nl',
  'crunchbase.com', 'zoominfo.com', 'apollo.io', 'rocketreach.co', 'dnb.com', 'bloomberg.com', 'reuters.com',
  'yelp.com', 'tripadvisor.com', 'tripadvisor.nl', 'thuisbezorgd.nl', 'ubereats.com', 'trustpilot.com',
  'europages.com', 'europages.nl', 'kompass.com', 'yumpu.com', 'issuu.com', 'scribd.com', 'medium.com', 'reddit.com',
  'nu.nl', 'nos.nl', 'telegraaf.nl', 'ad.nl', 'fd.nl', 'rtlnieuws.nl', 'logistiek.nl', 'pharmaceutical-technology.com',
  'europa.eu', 'rijksoverheid.nl', 'igj.nl', 'government.nl',
];

// Second-level public suffixes we meet in practice. Not the full PSL — enough
// that `example.co.uk` resolves to `example.co.uk`, not `co.uk`.
const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'co.jp', 'com.tr', 'com.pl']);

export function hostOf(url) {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/\.$/, '');
  } catch { return ''; }
}

// `https://www.shop.example.nl/x` → `example.nl`
export function registrableDomain(urlOrHost) {
  const host = hostOf(urlOrHost);
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return '';
  const parts = host.split('.');
  if (parts.length < 2) return '';
  const lastTwo = parts.slice(-2).join('.');
  const n = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return parts.slice(-n).join('.');
}

export function hostMatches(domain, list) {
  return list.some((h) => domain === h || domain.endsWith(`.${h}`));
}

// Best-effort company name from a result title: "Acme Pharma | Home" → "Acme Pharma".
export function companyFromTitle(title) {
  const head = (title || '').split(/\s[|–—·:-]\s|\s\|\s/)[0] || '';
  return head.replace(/\b(home|homepage|welkom|welcome)\b/gi, '').trim().slice(0, 120);
}

// "Jane Doe - QA Manager - Example Pharma | LinkedIn" → { name, title, company }
function parseLinkedIn(hit) {
  const t = (hit.title || '').replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  if (/linkedin\.com\/company\//i.test(hit.link)) return { company: t.split(/\s[-–]\s/)[0].trim() };
  if (/linkedin\.com\/in\//i.test(hit.link)) {
    const [name = '', title = '', company = ''] = t.split(/\s[-–]\s/).map((s) => s.trim());
    if (company) return { company, person: { name, title, source: 'linkedin-serp', url: hit.link } };
  }
  return null;
}

// Organic hits → candidates, deduped by domain (or by company name for
// name-only LinkedIn candidates). `exclude` is the ICP's excludeDomains plus
// anything already known.
export function resolveEntities(hits, { exclude = [] } = {}) {
  const byKey = new Map();
  for (const hit of hits) {
    const domain = registrableDomain(hit.link);
    if (!domain) continue;

    if (hostMatches(domain, ['linkedin.com'])) {
      const li = parseLinkedIn(hit);
      if (!li || !li.company) continue;
      const k = `name:${li.company.toLowerCase()}`;
      const c = byKey.get(k) || { domain: '', company: li.company, hits: [], people: [] };
      c.hits.push(hit);
      if (li.person) c.people.push(li.person);
      byKey.set(k, c);
      continue;
    }

    if (hostMatches(domain, NON_COMPANY_HOSTS) || hostMatches(domain, exclude)) continue;
    const c = byKey.get(domain) || { domain, company: companyFromTitle(hit.title), hits: [], people: [] };
    c.hits.push(hit);
    byKey.set(domain, c);
  }
  return [...byKey.values()];
}

// Pick the official site for a name-only candidate from a "<company>" search.
export function pickOfficialDomain(company, hits, { exclude = [] } = {}) {
  const words = company.toLowerCase().replace(/\b(b\.?v\.?|n\.?v\.?|gmbh|ltd|inc|bv|nv|group|groep)\b/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  for (const hit of hits) {
    const domain = registrableDomain(hit.link);
    if (!domain || hostMatches(domain, NON_COMPANY_HOSTS) || hostMatches(domain, exclude)) continue;
    // The domain or the result title must share a real word with the name,
    // otherwise the top result is just whatever ranked, not their website.
    const hay = `${domain} ${hit.title}`.toLowerCase();
    if (words.length === 0 || words.some((w) => hay.includes(w))) return domain;
  }
  return '';
}
