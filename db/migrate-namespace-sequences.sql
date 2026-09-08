-- ── Migration: namespace sequence ids by brand ─────────────────────
-- Run ONCE in the Supabase SQL editor, at cutover, AFTER deploying the code
-- that renames `founding-outreach` → `<brand>-founding` in lib/sequences.js.
--
-- Existing enrollments still carry sequence_id = 'founding-outreach'. Once the
-- code no longer defines that id, getSequence() returns null and the cron
-- PAUSES those enrollments. This re-tags each in-flight enrollment to its
-- brand's new id so active sequences keep running.
--
-- Order matters: deploy the code first (so new enrollments already use the new
-- ids), then run this to fix the rows enrolled under the old id.

-- STEP 0 — review what will change (run this first, eyeball the counts):
select l.tenant, e.sequence_id, count(*)
from enrollments e
join leads l on l.email = e.email
where e.sequence_id = 'founding-outreach'
group by l.tenant, e.sequence_id
order by l.tenant;

-- STEP 1 — re-tag Dr. Fry's founding enrollments:
update enrollments e
set sequence_id = 'drfry-founding'
from leads l
where l.email = e.email
  and l.tenant = 'drfry'
  and e.sequence_id = 'founding-outreach';

-- STEP 1 — re-tag FahCel's founding enrollments:
update enrollments e
set sequence_id = 'fahcel-founding'
from leads l
where l.email = e.email
  and l.tenant = 'fahcel'
  and e.sequence_id = 'founding-outreach';

-- FahCel's inbound playbook nurture: rename 'playbook-nurture' → 'fahcel-playbook'.
update enrollments e
set sequence_id = 'fahcel-playbook'
from leads l
where l.email = e.email
  and l.tenant = 'fahcel'
  and e.sequence_id = 'playbook-nurture';

-- STEP 2 — verify nothing is left on an old id (expect zero rows):
select e.sequence_id, count(*)
from enrollments e
where e.sequence_id in ('founding-outreach', 'playbook-nurture')
group by e.sequence_id;
