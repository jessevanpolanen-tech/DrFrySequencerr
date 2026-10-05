// ── Website crawler ─────────────────────────────────────────────────
// Verifies the domain is a live company site and collects the evidence the
// later stages reason over: title, meta description, visible text, and email
// addresses published ON THAT DOMAIN. A handful of pages, never a spider.
//
// Honours a blanket `Disallow: /` in robots.txt. Text is capped so one huge
// page can't blow the LLM budget downstream.
import { USER_AGENT } from './http.js';

const PAGE_TIMEOUT = 8_000;
const MAX_TEXT = 9_000;
// Contact/about pages, English and Dutch/German, where people and emails live.
const SUBPAGES = ['/contact', '/about', '/about-us', '/over-ons', '/team', '/kontakt'];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain' },
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT),
  });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (!/text\/(html|plain)/i.test(type)) return null;
  return { url: res.url, body: (await res.text()).slice(0, 600_000) };
}

// True unless robots.txt disallows everything for `*`. Deliberately coarse:
// path-level rules would need a real parser, and we only fetch a few pages.
export function robotsAllows(robotsTxt) {
  if (!robotsTxt) return true;
  let applies = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, field, value] = m;
    if (/^user-agent$/i.test(field)) applies = value.trim() === '*';
    else if (applies && /^disallow$/i.test(field) && value.trim() === '/') return false;
  }
  return true;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function htmlToText(html) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function pageMeta(html) {
  const pick = (re) => { const m = html.match(re); return m ? decode(m[1]).trim() : ''; };
  return {
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i).slice(0, 200),
    description: (pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)).slice(0, 400),
    lang: pick(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i).toLowerCase(),
  };
}

// Emails on `domain` (or its subdomains) only. An address on another domain is
// usually the web agency or a parent company, not someone to contact here.
export function extractEmails(html, domain) {
  const found = new Set();
  const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const m of decode(html.replace(/%40/g, '@')).matchAll(re)) {
    const e = m[0].toLowerCase().replace(/^mailto:/, '').replace(/\.$/, '');
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(e)) continue;
    const host = e.split('@')[1];
    if (host === domain || host.endsWith(`.${domain}`)) found.add(e);
  }
  return [...found].slice(0, 20);
}

// Role mailboxes. Fine as a last resort, never preferred over a named person.
export const GENERIC_LOCALS = /^(info|contact|sales|verkoop|office|kantoor|hello|hallo|welcome|mail|admin|support|service|klantenservice|receptie|reception|post|enquiries|inquiries|marketing|communication|communicatie|press|pers|hr|jobs|vacatures|werken|careers|privacy|noreply|no-reply|webmaster|finance|factuur|invoice|boekhouding)$/;
export const isGeneric = (email) => GENERIC_LOCALS.test(email.split('@')[0]);

export async function crawlSite(domain) {
  const base = `https://${domain}`;
  const robots = await fetch(`${base}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(PAGE_TIMEOUT) })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  if (!robotsAllows(robots)) return { ok: false, reason: 'robots.txt disallows crawling' };

  const home = await fetchText(base).catch(() => null) || await fetchText(`https://www.${domain}`).catch(() => null);
  if (!home) return { ok: false, reason: 'homepage unreachable' };

  const meta = pageMeta(home.body);
  const pages = [{ url: home.url, text: htmlToText(home.body) }];
  const emails = new Set(extractEmails(home.body, domain));

  // Sub-pages in parallel; any one failing is fine.
  const origin = new URL(home.url).origin;
  const subs = await Promise.all(SUBPAGES.map((p) => fetchText(origin + p).catch(() => null)));
  const seen = new Set([home.url]);
  for (const sub of subs) {
    if (!sub || seen.has(sub.url)) continue;
    seen.add(sub.url);
    pages.push({ url: sub.url, text: htmlToText(sub.body) });
    for (const e of extractEmails(sub.body, domain)) emails.add(e);
  }

  // Share the text budget across pages so contact pages aren't starved.
  const per = Math.floor(MAX_TEXT / pages.length);
  const text = pages.map((p) => `[${p.url}]\n${p.text.slice(0, per)}`).join('\n\n');

  return { ok: true, ...meta, finalUrl: home.url, pages: pages.map((p) => p.url), emails: [...emails], text };
}
