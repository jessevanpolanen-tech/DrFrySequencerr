// Small fetch wrapper for the intel pipeline: a hard timeout on every call (a
// slow third party must not eat the function's whole time budget) and a JSON
// error that names the provider. Never logs query strings — they carry API keys.

export const USER_AGENT = 'Mozilla/5.0 (compatible; SequencerIntelBot/1.0)';

export async function getJson(provider, url, { headers = {}, timeoutMs = 10_000 } = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  const txt = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch { throw new Error(`${provider}: non-JSON response`); }
}
