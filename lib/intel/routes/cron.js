// ── Intel scheduler ─────────────────────────────────────────────────
// Daily (vercel.json). Advances already-discovered prospects for each tenant
// listed in INTEL_TENANTS (comma-separated, e.g. `fahcel,drfry`). It never
// discovers on its own (that spends search credits on a query someone should
// choose) and never promotes or enrolls (that's a human decision).
//
// INTEL_TENANTS is explicit on purpose: unset means do nothing, not "guess".
// Protected by CRON_SECRET, same as api/cron/tick.js.
import { processBatch } from '../pipeline.js';
import { ICP } from '../icp.js';


function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret set → allow (dev only; set one in prod)
  const auth = req.headers.authorization || '';
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return auth === `Bearer ${secret}` || url.searchParams.get('key') === secret;
}

export default async function handler(req, res) {
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }

  const tenants = (process.env.INTEL_TENANTS || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tenants.length === 0) { res.status(200).json({ skipped: 'INTEL_TENANTS is not set' }); return; }

  const runs = [];
  // Split the function's budget across tenants so the last one isn't starved.
  const budgetMs = Math.floor(48_000 / tenants.length);
  for (const tenant of tenants) {
    if (!ICP[tenant]) { runs.push({ tenant, error: 'no ICP for tenant' }); continue; }
    try {
      runs.push(await processBatch({ tenant, limit: 15, budgetMs }));
    } catch (err) {
      runs.push({ tenant, error: String((err && err.message) || err) });
    }
  }
  res.status(200).json({ runs });
}
