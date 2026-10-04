// Run: npm test   (node's built-in runner; no network, no database)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TENANT ||= 'fahcel'; // lib/db.js throws at import without it; it never connects here

const { registrableDomain, resolveEntities, pickOfficialDomain } = await import('../lib/intel/resolve.js');
const { robotsAllows, htmlToText, extractEmails, pageMeta, isGeneric, crawlSite } = await import('../lib/intel/crawl.js');
const { ruleScore } = await import('../lib/intel/score.js');
const { rankContacts } = await import('../lib/intel/pipeline.js');
const { getIcp } = await import('../lib/intel/icp.js');
const { getSequence, renderStep } = await import('../lib/sequences.js');
const { verifyEmail } = await import('../lib/intel/verify.js');

const icp = getIcp('fahcel');

test('registrableDomain strips subdomains and keeps two-part suffixes', () => {
  assert.equal(registrableDomain('https://www.shop.example.nl/a?b=1'), 'example.nl');
  assert.equal(registrableDomain('example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('https://a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('not a url'), '');
});

test('getIcp refuses unknown tenants instead of defaulting', () => {
  assert.throws(() => getIcp('kavel'), /no ICP/);
  assert.throws(() => getIcp(''), /no ICP/);
});

test('resolveEntities drops directories, dedupes domains, parses LinkedIn people', () => {
  const hits = [
    { title: 'Acme Pharma | Home', link: 'https://www.acmepharma.nl/' },
    { title: 'Acme Pharma - Contact', link: 'https://acmepharma.nl/contact' },
    { title: 'Vacatures Acme', link: 'https://nl.indeed.com/q-acme' },
    { title: 'Testo NL', link: 'https://www.testo.com/nl-NL/' },
    { title: 'Jane Doe - QA Manager - Coldline BV | LinkedIn', link: 'https://nl.linkedin.com/in/janedoe' },
    { title: 'Coldline BV | LinkedIn', link: 'https://www.linkedin.com/company/coldline' },
  ];
  const out = resolveEntities(hits, { exclude: icp.excludeDomains });
  const acme = out.find((c) => c.domain === 'acmepharma.nl');
  assert.ok(acme);
  assert.equal(acme.company, 'Acme Pharma');
  assert.equal(acme.hits.length, 2);
  assert.ok(!out.some((c) => c.domain.includes('indeed') || c.domain === 'testo.com'));
  const coldline = out.find((c) => c.company === 'Coldline BV');
  assert.equal(coldline.domain, '');
  assert.deepEqual(coldline.people.map((p) => p.title), ['QA Manager']);
});

test('pickOfficialDomain needs a shared word, not just the top result', () => {
  const hits = [
    { title: 'Coldline on LinkedIn', link: 'https://linkedin.com/company/coldline' },
    { title: 'Best logistics blog', link: 'https://randomblog.nl/post' },
    { title: 'Coldline — GDP logistics', link: 'https://www.coldline-logistics.nl/' },
  ];
  assert.equal(pickOfficialDomain('Coldline BV', hits), 'coldline-logistics.nl');
  assert.equal(pickOfficialDomain('Unrelated Name', hits.slice(1, 2)), '');
});

test('robotsAllows only blocks a blanket disallow for *', () => {
  assert.equal(robotsAllows(''), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /admin'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /'), false);
  assert.equal(robotsAllows('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow:'), true);
});

test('crawl helpers: text, meta, on-domain emails only', () => {
  const html = `<html lang="nl"><head><title>Acme &amp; Co | Home</title>
    <meta name="description" content="GDP groothandel"><style>.x{}</style><script>var a="x@acme.nl"</script></head>
    <body><p>Bel ons</p><a href="mailto:jan.jansen@acme.nl">mail</a> info@acme.nl agency@webbureau.nl logo@2x.png
    sales%40acme.nl</body></html>`;
  assert.deepEqual(pageMeta(html), { title: 'Acme & Co | Home', description: 'GDP groothandel', lang: 'nl' });
  const text = htmlToText(html);
  assert.ok(text.includes('Bel ons') && !text.includes('.x{}'));
  const emails = extractEmails(html, 'acme.nl');
  assert.ok(emails.includes('jan.jansen@acme.nl') && emails.includes('info@acme.nl') && emails.includes('sales@acme.nl'));
  assert.ok(!emails.some((e) => e.includes('webbureau') || e.endsWith('.png')));
  assert.equal(isGeneric('info@acme.nl'), true);
  assert.equal(isGeneric('jan.jansen@acme.nl'), false);
});

test('crawlSite respects robots and collects pages (stubbed fetch)', async () => {
  const real = globalThis.fetch;
  const page = (body, url) => ({ ok: true, url, headers: new Map([['content-type', 'text/html']]), text: async () => body });
  try {
    globalThis.fetch = async (url) => {
      if (url.endsWith('/robots.txt')) return { ok: true, text: async () => 'User-agent: *\nDisallow: /' };
      return page('<title>x</title>', url);
    };
    assert.deepEqual(await crawlSite('blocked.nl'), { ok: false, reason: 'robots.txt disallows crawling' });

    globalThis.fetch = async (url) => {
      if (url.endsWith('/robots.txt')) return { ok: false, text: async () => '' };
      if (url === 'https://acme.nl') return page('<title>Acme</title><p>Cold chain</p>', 'https://acme.nl/');
      if (url === 'https://acme.nl/contact') return page('<p>piet@acme.nl</p>', url);
      return { ok: false, headers: new Map(), text: async () => '' };
    };
    const site = await crawlSite('acme.nl');
    assert.equal(site.ok, true);
    assert.equal(site.title, 'Acme');
    assert.deepEqual(site.emails, ['piet@acme.nl']);
    assert.equal(site.pages.length, 2);
  } finally {
    globalThis.fetch = real;
  }
});

test('ruleScore rewards fit and zeroes negatives', () => {
  const good = ruleScore({
    domain: 'acme.nl', company: 'Acme',
    site: { text: 'GDP pharmaceutical wholesale, temperature-controlled 2-8 distribution' },
    contacts: [{ title: 'QA Manager', email: 'a@acme.nl' }],
    signals: [{ title: 'Acme opens new warehouse' }],
  }, icp);
  assert.ok(good.score >= 90, JSON.stringify(good));
  assert.equal(ruleScore({ domain: 'acme.nl', site: { text: 'vacatures cold chain' } }, icp).score, 0);
  assert.equal(ruleScore({ domain: 'testo.com', site: { text: 'cold chain' } }, icp).score, 0);
});

test('rankContacts: LLM pick, then titled people, then role mailboxes', () => {
  const contacts = [
    { email: 'info@acme.nl', generic: true },
    { name: 'Piet', title: 'Sales', email: 'piet@acme.nl', generic: false },
    { name: 'Jan', title: 'Head of Quality', email: 'jan@acme.nl', generic: false, confidence: 0.9 },
    { name: 'No Email', title: 'QA Manager', email: '' },
  ];
  assert.deepEqual(rankContacts(contacts, icp).map((c) => c.email), ['jan@acme.nl', 'piet@acme.nl', 'info@acme.nl']);
  assert.equal(rankContacts(contacts, icp, 1)[0].email, 'piet@acme.nl');
});

test('signal sequence leads with the opener, falls back to founding copy', () => {
  const signal = getSequence('fahcel-signal');
  const founding = getSequence('fahcel-founding');
  assert.ok(signal && getSequence('drfry-signal'));
  assert.equal(signal.steps.length, founding.steps.length);

  const lead = { email: 'jan@acme.nl', name: 'Jan Smit', org: 'Acme' };
  const plain = renderStep(signal, 0, lead, 'https://x');
  assert.deepEqual(plain, renderStep(founding, 0, lead, 'https://x'));

  const withIntel = renderStep(signal, 0, { ...lead, intel: { subject: 'Your new Tilburg DC', opener: 'Saw you opened a GDP site in Tilburg.' } }, 'https://x');
  assert.equal(withIntel.subject, 'Your new Tilburg DC');
  assert.ok(withIntel.text.startsWith('Hi Jan,\n\nSaw you opened a GDP site in Tilburg.\n\n'));
  assert.ok(withIntel.text.includes('/api/unsubscribe?t='));
});

test('verifyEmail rejects bad syntax without any network call', async () => {
  assert.equal((await verifyEmail('not-an-email')).status, 'invalid');
  assert.equal((await verifyEmail('')).status, 'invalid');
});
