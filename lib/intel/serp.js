// ── Discovery layer: SerpApi ────────────────────────────────────────
// Google organic results find candidate companies; Google News finds the
// "why now" evidence for one company. Requires SERPAPI_KEY. Every call is one
// SerpApi credit, so callers bound how many they make.
import { getJson } from './http.js';

const ENDPOINT = 'https://serpapi.com/search.json';

function key() {
  const k = process.env.SERPAPI_KEY;
  if (!k) throw new Error('SERPAPI_KEY is not set');
  return k;
}

// One page of Google organic results → [{ title, link, snippet, position }].
// Google stopped honouring num>10, so deeper discovery pages with `start`.
export async function searchOrganic(q, { gl = 'nl', hl = 'en', page = 0 } = {}) {
  const params = new URLSearchParams({ engine: 'google', q, gl, hl, start: String(page * 10), api_key: key() });
  const data = await getJson('SerpApi', `${ENDPOINT}?${params}`, { timeoutMs: 20_000 });
  return (data.organic_results || []).map((r) => ({
    title: r.title || '',
    link: r.link || '',
    snippet: r.snippet || '',
    position: r.position || null,
  }));
}

// Recent news mentioning a company → [{ title, link, source, date, snippet }].
export async function searchNews(q, { gl = 'nl', hl = 'en', limit = 6 } = {}) {
  const params = new URLSearchParams({ engine: 'google_news', q, gl, hl, api_key: key() });
  const data = await getJson('SerpApi', `${ENDPOINT}?${params}`, { timeoutMs: 20_000 });
  return (data.news_results || []).slice(0, limit).map((r) => ({
    title: r.title || '',
    link: r.link || '',
    source: (r.source && r.source.name) || '',
    date: r.date || '',
    snippet: r.snippet || '',
  }));
}
