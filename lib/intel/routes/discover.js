// ── Discover prospects ──────────────────────────────────────────────
// POST /api/intel/discover  { tenant, query? | preset?, pages?, process? }
//
// Runs one Google search through SerpApi (1 credit per page, max 3 pages),
// resolves the hits to companies, and stores new ones as `discovered`
// prospects. Pass process:true to also push a first batch through the
// pipeline in the same call. Requires INTEL_SECRET (see lib/intel/http-guard.js).
//
// GET /api/intel/discover?tenant=…  → this tenant's presets.
import { discover, processBatch } from '../pipeline.js';
import { getIcp } from '../icp.js';
import { cors, guard, body, tenantOf, fail } from '../http-guard.js';


export default async function handler(req, res) {
  cors(res, 'GET, POST');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const tenant = tenantOf(req);
      res.status(200).json({ tenant, presets: getIcp(tenant).presets });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'GET or POST' }); return; }

    const b = body(req);
    const tenant = tenantOf(req, b);
    const found = await discover({ tenant, query: b.query || '', preset: b.preset || '', pages: Number(b.pages) || 1 });
    const processed = b.process ? await processBatch({ tenant, limit: 5, budgetMs: 35_000 }) : null;
    res.status(200).json({ ok: true, tenant, ...found, processed });
  } catch (err) {
    fail(res, err);
  }
}
