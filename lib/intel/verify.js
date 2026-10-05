// ── Email verification ──────────────────────────────────────────────
// Sending to bad addresses burns the sending domain's reputation for every
// brand on this Resend account, so nothing is "ready" without a verdict.
//
//   valid      → a verifier confirmed the mailbox
//   risky      → catch-all / unknown / webmail: deliverable maybe, human call
//   unverified → domain accepts mail (MX ok) but no verifier is configured
//   invalid    → syntax, no MX, or the verifier rejected it
//
// HUNTER_API_KEY enables real mailbox verification; without it we stop at MX.
import { promises as dns } from 'node:dns';
import { getJson } from './http.js';

const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function hasMx(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.length > 0;
  } catch { return false; }
}

const HUNTER_MAP = { valid: 'valid', accept_all: 'risky', unknown: 'risky', webmail: 'risky', invalid: 'invalid', disposable: 'invalid' };

export async function verifyEmail(email) {
  if (!email || !SYNTAX.test(email)) return { status: 'invalid', reason: 'syntax' };
  const domain = email.split('@')[1];
  if (!(await hasMx(domain))) return { status: 'invalid', reason: 'no MX record' };

  const key = process.env.HUNTER_API_KEY;
  if (!key) return { status: 'unverified', reason: 'MX ok; no verifier configured' };

  try {
    const params = new URLSearchParams({ email, api_key: key });
    const data = await getJson('Hunter verify', `https://api.hunter.io/v2/email-verifier?${params}`, { timeoutMs: 20_000 });
    const raw = (data.data && data.data.status) || 'unknown';
    return { status: HUNTER_MAP[raw] || 'risky', reason: `hunter: ${raw}`, score: data.data && data.data.score };
  } catch (err) {
    // Verifier outage: don't call it valid, don't throw the prospect away either.
    return { status: 'unverified', reason: `verifier error: ${String(err.message || err).slice(0, 120)}` };
  }
}
