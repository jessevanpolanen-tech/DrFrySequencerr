// ── /api/intel/:action, one function for the whole intel layer ─────
// The Hobby plan caps a deployment at 12 serverless functions, and the
// sequencer already uses 10. A deploy over the cap fails outright for every
// brand on this shared project. So every intel route is one dynamic function,
// and its handlers live in lib/intel/routes/. Add new intel routes to ROUTES,
// never as new files under api/.
//
//   /api/intel/discover   POST search → prospects · GET presets
//   /api/intel/process    POST advance a batch
//   /api/intel/prospects  GET list · PATCH reject/requeue
//   /api/intel/promote    POST prospects → leads (→ sequence)
//   /api/intel/cron       daily (vercel.json), CRON_SECRET-protected
import discover from '../../lib/intel/routes/discover.js';
import processRoute from '../../lib/intel/routes/process.js';
import prospects from '../../lib/intel/routes/prospects.js';
import promote from '../../lib/intel/routes/promote.js';
import cron from '../../lib/intel/routes/cron.js';

export const config = { runtime: 'nodejs' };

const ROUTES = { discover, process: processRoute, prospects, promote, cron };

export default async function handler(req, res) {
  const action = (req.query?.action || '').toString();
  const route = Object.hasOwn(ROUTES, action) ? ROUTES[action] : null;
  if (!route) { res.status(404).json({ error: `unknown intel route "${action}"`, routes: Object.keys(ROUTES) }); return; }
  return route(req, res);
}
