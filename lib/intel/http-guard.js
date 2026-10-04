// Request plumbing shared by the /api/intel/* routes.
//
// Unlike /api/leads, these routes spend money (SerpApi, enrichment and LLM
// credits) and return scraped contact data, so they are never open: they need
// INTEL_SECRET as a Bearer token or `?key=`. With INTEL_SECRET unset they
// refuse outright rather than run unauthenticated.
//
// The tenant is REQUIRED and never defaulted from env: the brand being
// prospected for is always an explicit choice.
import { ICP } from './icp.js';

export function cors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', `${methods}, OPTIONS`);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function guard(req, res) {
  const secret = process.env.INTEL_SECRET;
  if (!secret) { res.status(503).json({ error: 'INTEL_SECRET is not set on this deployment' }); return false; }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${secret}` && req.query?.key !== secret) { res.status(401).json({ error: 'unauthorized' }); return false; }
  return true;
}

export function body(req) {
  return typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
}

export function tenantOf(req, b = {}) {
  const t = (b.tenant || req.query?.tenant || '').toString().trim().toLowerCase();
  if (!t) throw Object.assign(new Error(`tenant is required (${Object.keys(ICP).join(' | ')})`), { status: 400 });
  if (!ICP[t]) throw Object.assign(new Error(`no ICP for tenant "${t}"`), { status: 400 });
  return t;
}

export function fail(res, err) {
  res.status(err.status || 500).json({ error: String((err && err.message) || err) });
}
